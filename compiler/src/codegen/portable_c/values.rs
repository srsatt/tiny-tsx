use std::fmt::Write;

use crate::hir::{ConstantValue, NumericOperator, Program, ValueExpression};

pub(super) fn emit(source: &mut String, program: &Program) -> Result<(), String> {
    source.push_str(
        "typedef struct { const tiny_u8 *bytes; tiny_usize length; double number; tiny_u32 boolean; tiny_u32 thrown; } tiny_value;\n\
         extern int memcmp(const void *, const void *, tiny_usize);\n\
         static tiny_value tinytsx_value_string(const tiny_u8 *bytes, tiny_usize length) { tiny_value value = {bytes, length, 0.0, 0, 0}; return value; }\n\
         static tiny_value tinytsx_value_number(double number) { tiny_value value = {(const tiny_u8 *)0, 0, number, 0, 0}; return value; }\n\
         static tiny_value tinytsx_value_boolean(tiny_u32 boolean) { tiny_value value = {(const tiny_u8 *)0, 0, 0.0, boolean, 0}; return value; }\n",
    );
    for (index, constant) in program.constants.iter().enumerate() {
        if let ConstantValue::String { value } = &constant.value {
            emit_bytes(
                source,
                &format!("tinytsx_constant_string_{index}"),
                value.as_bytes(),
            );
        }
    }
    for function in &program.functions {
        writeln!(
            source,
            "static tiny_value tinytsx_function_{}({});",
            function.id,
            parameters(function.parameters.len())
        )
        .unwrap();
    }
    for function in &program.functions {
        writeln!(
            source,
            "static tiny_value tinytsx_function_{}({}) {{",
            function.id,
            parameters(function.parameters.len())
        )
        .unwrap();
        let mut emitter = ValueEmitter {
            source,
            program,
            next_value: 0,
            caught: None,
        };
        let result = emitter.expression(&function.body, "  ")?;
        writeln!(emitter.source, "  return {result};").unwrap();
        emitter.source.push_str("}\n");
    }
    Ok(())
}

pub(super) fn is_scalar(expression: &ValueExpression) -> bool {
    matches!(
        expression,
        ValueExpression::StringLiteral { .. }
            | ValueExpression::NumericLiteral { .. }
            | ValueExpression::BooleanLiteral { .. }
            | ValueExpression::Constant { .. }
            | ValueExpression::DirectCall { .. }
            | ValueExpression::StringEqualConditional { .. }
            | ValueExpression::NumericBinary { .. }
            | ValueExpression::NumericEqualConditional { .. }
            | ValueExpression::BooleanEqualConditional { .. }
            | ValueExpression::NumericForLoop { .. }
            | ValueExpression::ThrowValue { .. }
            | ValueExpression::TryCatch { .. }
            | ValueExpression::CaughtException { .. }
    )
}

pub(super) fn render_handler_expression(
    expression: &ValueExpression,
    program: &Program,
) -> Result<String, String> {
    match expression {
        ValueExpression::StringLiteral { string, .. } => Ok(format!(
            "tinytsx_value_string(tinytsx_string_{string}, {})",
            program.static_strings[*string].value.len()
        )),
        ValueExpression::NumericLiteral { value, .. } => {
            Ok(format!("tinytsx_value_number({})", *value as f64))
        }
        ValueExpression::BooleanLiteral { value, .. } => {
            Ok(format!("tinytsx_value_boolean({})", u32::from(*value)))
        }
        ValueExpression::Constant { constant, .. } => constant_expression(*constant, program),
        ValueExpression::DirectCall {
            function,
            arguments,
            ..
        } => {
            let arguments = arguments
                .iter()
                .map(|argument| render_handler_expression(argument, program))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            Ok(format!("tinytsx_function_{function}({arguments})"))
        }
        ValueExpression::NumericBinary {
            operator,
            left,
            right,
            ..
        } => {
            let left = render_handler_expression(left, program)?;
            let right = render_handler_expression(right, program)?;
            let operator = match operator {
                NumericOperator::Add => '+',
                NumericOperator::Subtract => '-',
            };
            Ok(format!(
                "tinytsx_value_number(({left}).number {operator} ({right}).number)"
            ))
        }
        _ => Err("handler scalar expression requires a generated helper".to_owned()),
    }
}

struct ValueEmitter<'a> {
    source: &'a mut String,
    program: &'a Program,
    next_value: usize,
    caught: Option<String>,
}

impl ValueEmitter<'_> {
    fn expression(&mut self, expression: &ValueExpression, indent: &str) -> Result<String, String> {
        match expression {
            ValueExpression::StringLiteral { string, .. } => self.declare(
                indent,
                &format!(
                    "tinytsx_value_string(tinytsx_string_{string}, {})",
                    self.program.static_strings[*string].value.len()
                ),
            ),
            ValueExpression::NumericLiteral { value, .. } => {
                self.declare(indent, &format!("tinytsx_value_number({})", *value as f64))
            }
            ValueExpression::BooleanLiteral { value, .. } => self.declare(
                indent,
                &format!("tinytsx_value_boolean({})", u32::from(*value)),
            ),
            ValueExpression::Constant { constant, .. } => {
                let expression = constant_expression(*constant, self.program)?;
                self.declare(indent, &expression)
            }
            ValueExpression::Parameter { parameter, .. } => {
                self.declare(indent, &format!("argument_{parameter}"))
            }
            ValueExpression::DirectCall {
                function,
                arguments,
                ..
            } => {
                let arguments = arguments
                    .iter()
                    .map(|argument| self.expression(argument, indent))
                    .collect::<Result<Vec<_>, _>>()?;
                let output = self.new_value();
                writeln!(self.source, "{indent}tiny_value {output};").unwrap();
                for (index, argument) in arguments.iter().enumerate() {
                    let prefix = if index == 0 { "if" } else { "else if" };
                    writeln!(
                        self.source,
                        "{indent}{prefix} ({argument}.thrown) {output} = {argument};"
                    )
                    .unwrap();
                }
                let call = format!("tinytsx_function_{function}({})", arguments.join(", "));
                if arguments.is_empty() {
                    writeln!(self.source, "{indent}{output} = {call};").unwrap();
                } else {
                    writeln!(self.source, "{indent}else {output} = {call};").unwrap();
                }
                Ok(output)
            }
            ValueExpression::StringEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                let left = self.expression(left, indent)?;
                let right = self.expression(right, indent)?;
                self.conditional(
                    indent,
                    &left,
                    &right,
                    &format!(
                        "{left}.length == {right}.length && memcmp({left}.bytes, {right}.bytes, {left}.length) == 0"
                    ),
                    when_equal,
                    when_not_equal,
                )
            }
            ValueExpression::NumericEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                let left = self.expression(left, indent)?;
                let right = self.expression(right, indent)?;
                self.conditional(
                    indent,
                    &left,
                    &right,
                    &format!("{left}.number == {right}.number"),
                    when_equal,
                    when_not_equal,
                )
            }
            ValueExpression::BooleanEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                let left = self.expression(left, indent)?;
                let right = self.expression(right, indent)?;
                self.conditional(
                    indent,
                    &left,
                    &right,
                    &format!("{left}.boolean == {right}.boolean"),
                    when_equal,
                    when_not_equal,
                )
            }
            ValueExpression::NumericBinary {
                operator,
                left,
                right,
                ..
            } => {
                let left = self.expression(left, indent)?;
                let right = self.expression(right, indent)?;
                let output = self.new_value();
                let operator = match operator {
                    NumericOperator::Add => '+',
                    NumericOperator::Subtract => '-',
                };
                writeln!(self.source, "{indent}tiny_value {output};").unwrap();
                writeln!(self.source, "{indent}if ({left}.thrown) {output} = {left};").unwrap();
                writeln!(
                    self.source,
                    "{indent}else if ({right}.thrown) {output} = {right};"
                )
                .unwrap();
                writeln!(self.source, "{indent}else {output} = tinytsx_value_number({left}.number {operator} {right}.number);").unwrap();
                Ok(output)
            }
            ValueExpression::NumericForLoop {
                accumulator_initial,
                index_initial,
                end_exclusive,
                accumulator_step,
                ..
            } => {
                let output = self.new_value();
                writeln!(
                    self.source,
                    "{indent}double accumulator_{} = {};",
                    self.next_value, *accumulator_initial as f64
                )
                .unwrap();
                writeln!(
                    self.source,
                    "{indent}for (tiny_i64 index_{} = {index_initial}; index_{} < {end_exclusive}; ++index_{}) accumulator_{} += {};",
                    self.next_value,
                    self.next_value,
                    self.next_value,
                    self.next_value,
                    *accumulator_step as f64
                )
                .unwrap();
                writeln!(
                    self.source,
                    "{indent}tiny_value {output} = tinytsx_value_number(accumulator_{});",
                    self.next_value
                )
                .unwrap();
                self.next_value += 1;
                Ok(output)
            }
            ValueExpression::ThrowValue { value, .. } => {
                let value = self.expression(value, indent)?;
                writeln!(self.source, "{indent}{value}.thrown = 1;").unwrap();
                Ok(value)
            }
            ValueExpression::TryCatch {
                try_value,
                catch_value,
                ..
            } => {
                let tried = self.expression(try_value, indent)?;
                let output = self.new_value();
                writeln!(self.source, "{indent}tiny_value {output};").unwrap();
                writeln!(self.source, "{indent}if ({tried}.thrown) {{").unwrap();
                let previous = self.caught.replace(tried.clone());
                let caught = self.expression(catch_value, &format!("{indent}  "))?;
                self.caught = previous;
                writeln!(self.source, "{indent}  {output} = {caught};").unwrap();
                writeln!(self.source, "{indent}}} else {output} = {tried};").unwrap();
                Ok(output)
            }
            ValueExpression::CaughtException { .. } => {
                let caught = self
                    .caught
                    .clone()
                    .ok_or_else(|| "caught exception has no portable catch value".to_owned())?;
                let output = self.declare(indent, &caught)?;
                writeln!(self.source, "{indent}{output}.thrown = 0;").unwrap();
                Ok(output)
            }
            _ => Err("request-time expression used in a portable scalar function".to_owned()),
        }
    }

    fn conditional(
        &mut self,
        indent: &str,
        left: &str,
        right: &str,
        condition: &str,
        when_equal: &ValueExpression,
        when_not_equal: &ValueExpression,
    ) -> Result<String, String> {
        let output = self.new_value();
        writeln!(self.source, "{indent}tiny_value {output};").unwrap();
        writeln!(self.source, "{indent}if ({left}.thrown) {output} = {left};").unwrap();
        writeln!(
            self.source,
            "{indent}else if ({right}.thrown) {output} = {right};"
        )
        .unwrap();
        writeln!(self.source, "{indent}else if ({condition}) {{").unwrap();
        let equal = self.expression(when_equal, &format!("{indent}  "))?;
        writeln!(self.source, "{indent}  {output} = {equal};").unwrap();
        writeln!(self.source, "{indent}}} else {{").unwrap();
        let not_equal = self.expression(when_not_equal, &format!("{indent}  "))?;
        writeln!(self.source, "{indent}  {output} = {not_equal};").unwrap();
        writeln!(self.source, "{indent}}}").unwrap();
        Ok(output)
    }

    fn declare(&mut self, indent: &str, expression: &str) -> Result<String, String> {
        let value = self.new_value();
        writeln!(self.source, "{indent}tiny_value {value} = {expression};").unwrap();
        Ok(value)
    }

    fn new_value(&mut self) -> String {
        let value = format!("value_{}", self.next_value);
        self.next_value += 1;
        value
    }
}

fn parameters(count: usize) -> String {
    if count == 0 {
        "void".to_owned()
    } else {
        (0..count)
            .map(|index| format!("tiny_value argument_{index}"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

fn constant_expression(constant: usize, program: &Program) -> Result<String, String> {
    match &program.constants[constant].value {
        ConstantValue::String { value } => Ok(format!(
            "tinytsx_value_string(tinytsx_constant_string_{constant}, {})",
            value.len()
        )),
        ConstantValue::Number { value } => Ok(format!("tinytsx_value_number({value:?})")),
        ConstantValue::Boolean { value } => {
            Ok(format!("tinytsx_value_boolean({})", u32::from(*value)))
        }
        _ => Err("scalar expression references a non-scalar constant".to_owned()),
    }
}

fn emit_bytes(source: &mut String, name: &str, bytes: &[u8]) {
    write!(
        source,
        "static const tiny_u8 {name}[{}] = {{",
        bytes.len().max(1)
    )
    .unwrap();
    if bytes.is_empty() {
        source.push('0');
    } else {
        for (index, byte) in bytes.iter().enumerate() {
            if index != 0 {
                source.push_str(", ");
            }
            write!(source, "{byte}").unwrap();
        }
    }
    source.push_str("};\n");
}
