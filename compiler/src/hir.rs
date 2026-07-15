use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub version: u32,
    pub target: String,
    pub entry: String,
    pub modules: Vec<Module>,
    #[serde(default)]
    pub functions: Vec<Function>,
    pub components: Vec<Component>,
    pub handlers: Vec<Handler>,
    pub static_strings: Vec<StaticString>,
    #[serde(default)]
    pub constants: Vec<Constant>,
    pub statistics: Statistics,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Module {
    pub path: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Component {
    pub id: usize,
    pub name: String,
    pub span: SourceSpan,
    pub html: Vec<HtmlOp>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HtmlOp {
    WriteStatic { string: usize, span: SourceSpan },
    CallComponent { component: usize, span: SourceSpan },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Handler {
    pub method: String,
    #[serde(default = "root_path")]
    pub path: String,
    #[serde(default)]
    pub headers: Vec<StaticHeader>,
    pub response: HandlerResponse,
    pub span: SourceSpan,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StaticHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HandlerResponse {
    Html {
        component: usize,
    },
    Text {
        value: ValueExpression,
        #[serde(default = "ok_status")]
        status: u16,
        #[serde(default)]
        #[serde(rename = "contentType")]
        content_type: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Function {
    pub id: usize,
    pub module: String,
    pub name: String,
    pub parameters: Vec<FunctionParameter>,
    pub result: String,
    pub body: ValueExpression,
    pub span: SourceSpan,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct FunctionParameter {
    pub name: String,
    #[serde(rename = "type")]
    pub value_type: String,
    pub span: SourceSpan,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ValueExpression {
    StringLiteral {
        string: usize,
        span: SourceSpan,
    },
    Constant {
        constant: usize,
        span: SourceSpan,
    },
    Parameter {
        parameter: usize,
        span: SourceSpan,
    },
    DirectCall {
        function: usize,
        arguments: Vec<ValueExpression>,
        span: SourceSpan,
    },
    Concat {
        values: Vec<ValueExpression>,
        span: SourceSpan,
    },
    RouteParameter {
        name: String,
        segment: usize,
        span: SourceSpan,
    },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StaticString {
    pub id: usize,
    pub value: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Constant {
    pub id: usize,
    pub module: String,
    pub name: String,
    pub span: SourceSpan,
    pub value: ConstantValue,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConstantValue {
    Undefined,
    Null,
    Boolean { value: bool },
    Number { value: f64 },
    Bigint { value: String },
    String { value: String },
    Array { items: Vec<ConstantValue> },
    Record { fields: Vec<ConstantField> },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ConstantField {
    pub name: String,
    pub value: ConstantValue,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub modules: usize,
    #[serde(default)]
    pub functions: usize,
    pub components: usize,
    #[serde(default)]
    pub constants: usize,
    pub static_html_bytes: usize,
    pub dynamic_html_expressions: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpan {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

impl Program {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 2 {
            return Err(format!(
                "unsupported HIR version {}; expected 2",
                self.version
            ));
        }
        if self.target != "aarch64-apple-darwin" {
            return Err(format!("unsupported HIR target `{}`", self.target));
        }
        if self.handlers.is_empty()
            || self
                .handlers
                .iter()
                .any(|handler| !matches!(handler.method.as_str(), "GET" | "POST"))
        {
            return Err(
                "HIR must contain at least one GET/POST handler and no other methods".to_owned(),
            );
        }
        let mut handler_paths = HashSet::new();
        for handler in &self.handlers {
            if !handler.path.starts_with('/') || handler.path.contains('?') {
                return Err("GET handler path must be an absolute path without a query".to_owned());
            }
            validate_route_pattern(&handler.path)?;
            if !handler_paths.insert((handler.method.as_str(), handler.path.as_str())) {
                return Err(format!(
                    "duplicate {} handler path `{}`",
                    handler.method, handler.path
                ));
            }
            let mut header_names = HashSet::new();
            for header in &handler.headers {
                let normalized = header.name.to_ascii_lowercase();
                if !valid_header_name(header.name.as_bytes())
                    || header
                        .value
                        .bytes()
                        .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
                    || !header_names.insert(normalized)
                {
                    return Err("GET handler contains invalid or duplicate headers".to_owned());
                }
            }
            match &handler.response {
                HandlerResponse::Html { component } if *component >= self.components.len() => {
                    return Err("GET handler references a missing component".to_owned());
                }
                HandlerResponse::Text {
                    value,
                    status,
                    content_type,
                } => {
                    if !(100..=599).contains(status) {
                        return Err("handler response has an invalid HTTP status".to_owned());
                    }
                    if content_type.as_deref().is_some_and(|value| {
                        !matches!(
                            value,
                            "text/plain; charset=UTF-8"
                                | "text/plain;charset=UTF-8"
                                | "application/json"
                        )
                    }) {
                        return Err("GET text response has an unsupported content type".to_owned());
                    }
                    self.validate_handler_expression(value, &handler.path)?;
                }
                _ => {}
            }
        }
        for (index, component) in self.components.iter().enumerate() {
            if component.id != index {
                return Err(format!("component id {} is not canonical", component.id));
            }
            for op in &component.html {
                match op {
                    HtmlOp::WriteStatic { string, .. } if *string >= self.static_strings.len() => {
                        return Err(format!(
                            "component {} references a missing string",
                            component.name
                        ));
                    }
                    HtmlOp::CallComponent { component, .. }
                        if *component >= self.components.len() =>
                    {
                        return Err(format!("component {} calls a missing component", component));
                    }
                    _ => {}
                }
            }
        }
        for (index, string) in self.static_strings.iter().enumerate() {
            if string.id != index {
                return Err(format!("static string id {} is not canonical", string.id));
            }
        }
        if self.statistics.functions != self.functions.len() {
            return Err("HIR function statistic does not match the function table".to_owned());
        }
        for (index, function) in self.functions.iter().enumerate() {
            if function.id != index {
                return Err(format!("function id {} is not canonical", function.id));
            }
            if function.parameters.len() > 4 || function.result != "string" {
                return Err(format!(
                    "function {} must have at most four string parameters and return string",
                    function.name
                ));
            }
            let mut parameter_names = HashSet::new();
            for parameter in &function.parameters {
                if parameter.value_type != "string" || !parameter_names.insert(&parameter.name) {
                    return Err(format!(
                        "function {} has invalid or duplicate parameters",
                        function.name
                    ));
                }
            }
            self.validate_expression(&function.body, function.parameters.len())?;
        }
        if self.statistics.constants != self.constants.len() {
            return Err("HIR constant statistic does not match the constant pool".to_owned());
        }
        let modules: HashSet<&str> = self
            .modules
            .iter()
            .map(|module| module.path.as_str())
            .collect();
        for (index, constant) in self.constants.iter().enumerate() {
            if constant.id != index {
                return Err(format!("constant id {} is not canonical", constant.id));
            }
            if !modules.contains(constant.module.as_str()) {
                return Err(format!(
                    "constant {} references a missing module",
                    constant.name
                ));
            }
            validate_constant_value(&constant.value, 0)?;
        }
        for function in &self.functions {
            if !modules.contains(function.module.as_str()) {
                return Err(format!(
                    "function {} references a missing module",
                    function.name
                ));
            }
        }
        self.validate_function_cycles()?;
        Ok(())
    }

    fn validate_expression(
        &self,
        expression: &ValueExpression,
        parameter_count: usize,
    ) -> Result<(), String> {
        match expression {
            ValueExpression::StringLiteral { string, .. } => {
                if *string >= self.static_strings.len() {
                    return Err("expression references a missing static string".to_owned());
                }
            }
            ValueExpression::Constant { constant, .. } => {
                let Some(constant) = self.constants.get(*constant) else {
                    return Err("expression references a missing constant".to_owned());
                };
                if !matches!(constant.value, ConstantValue::String { .. }) {
                    return Err("string expression references a non-string constant".to_owned());
                }
            }
            ValueExpression::Parameter { parameter, .. } => {
                if *parameter >= parameter_count {
                    return Err("expression references a missing parameter".to_owned());
                }
            }
            ValueExpression::DirectCall {
                function,
                arguments,
                ..
            } => {
                if *function >= self.functions.len() {
                    return Err("expression calls a missing function".to_owned());
                }
                if arguments.len() != self.functions[*function].parameters.len() {
                    return Err("direct call argument count does not match its function".to_owned());
                }
                for argument in arguments {
                    self.validate_expression(argument, parameter_count)?;
                }
            }
            ValueExpression::Concat { .. } | ValueExpression::RouteParameter { .. } => {
                return Err(
                    "request-time expressions are only valid in handler responses".to_owned(),
                );
            }
        }
        Ok(())
    }

    fn validate_handler_expression(
        &self,
        expression: &ValueExpression,
        route_pattern: &str,
    ) -> Result<(), String> {
        match expression {
            ValueExpression::Concat { values, .. } => {
                if values.is_empty() {
                    return Err("handler concatenation must not be empty".to_owned());
                }
                for value in values {
                    self.validate_handler_expression(value, route_pattern)?;
                }
                Ok(())
            }
            ValueExpression::RouteParameter { name, segment, .. } => {
                let segments: Vec<&str> = route_pattern
                    .split('/')
                    .filter(|part| !part.is_empty())
                    .collect();
                if segments.get(*segment).copied() != Some(&format!(":{name}")) {
                    return Err(format!(
                        "route parameter `{name}` does not match segment {segment} of `{route_pattern}`"
                    ));
                }
                Ok(())
            }
            _ => self.validate_expression(expression, 0),
        }
    }

    fn validate_function_cycles(&self) -> Result<(), String> {
        let mut state = vec![0_u8; self.functions.len()];
        for function in &self.functions {
            self.visit_function(function.id, &mut state)?;
        }
        Ok(())
    }

    fn visit_function(&self, id: usize, state: &mut [u8]) -> Result<(), String> {
        match state[id] {
            1 => return Err("recursive function graph is not supported".to_owned()),
            2 => return Ok(()),
            _ => state[id] = 1,
        }
        self.visit_expression_functions(&self.functions[id].body, state)?;
        state[id] = 2;
        Ok(())
    }

    fn visit_expression_functions(
        &self,
        expression: &ValueExpression,
        state: &mut [u8],
    ) -> Result<(), String> {
        match expression {
            ValueExpression::DirectCall {
                function,
                arguments,
                ..
            } => {
                self.visit_function(*function, state)?;
                for argument in arguments {
                    self.visit_expression_functions(argument, state)?;
                }
            }
            ValueExpression::Concat { values, .. } => {
                for value in values {
                    self.visit_expression_functions(value, state)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

fn validate_route_pattern(pattern: &str) -> Result<(), String> {
    let segments: Vec<&str> = pattern.split('/').filter(|part| !part.is_empty()).collect();
    for (index, segment) in segments.iter().enumerate() {
        if *segment == "*" {
            if index + 1 != segments.len() {
                return Err("route wildcard must be the final segment".to_owned());
            }
            continue;
        }
        if let Some(name) = segment.strip_prefix(':') {
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            {
                return Err(format!("unsupported route parameter segment `{segment}`"));
            }
        } else if segment.contains([':', '*', '{', '}']) {
            return Err(format!("unsupported dynamic route segment `{segment}`"));
        }
    }
    Ok(())
}

fn root_path() -> String {
    "/".to_owned()
}

fn ok_status() -> u16 {
    200
}

fn valid_header_name(name: &[u8]) -> bool {
    !name.is_empty()
        && name.iter().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

fn validate_constant_value(value: &ConstantValue, depth: usize) -> Result<(), String> {
    if depth > 128 {
        return Err("constant value nesting exceeds 128 levels".to_owned());
    }
    match value {
        ConstantValue::Number { value } if !value.is_finite() => {
            Err("constant number must be finite".to_owned())
        }
        ConstantValue::Bigint { value } if !is_canonical_bigint(value) => {
            Err("constant bigint must use canonical decimal notation".to_owned())
        }
        ConstantValue::Array { items } => {
            for item in items {
                validate_constant_value(item, depth + 1)?;
            }
            Ok(())
        }
        ConstantValue::Record { fields } => {
            let mut names = HashSet::new();
            for field in fields {
                if !names.insert(field.name.as_str()) {
                    return Err(format!("duplicate constant record field `{}`", field.name));
                }
                validate_constant_value(&field.value, depth + 1)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn is_canonical_bigint(value: &str) -> bool {
    if value == "0" {
        return true;
    }
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty()
        && !digits.starts_with('0')
        && digits.bytes().all(|byte| byte.is_ascii_digit())
}
