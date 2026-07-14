use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub version: u32,
    pub target: String,
    pub entry: String,
    pub modules: Vec<Module>,
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
    pub component: usize,
    pub span: SourceSpan,
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
        if self.version != 1 {
            return Err(format!(
                "unsupported HIR version {}; expected 1",
                self.version
            ));
        }
        if self.target != "aarch64-apple-darwin" {
            return Err(format!("unsupported HIR target `{}`", self.target));
        }
        if self.handlers.len() != 1 || self.handlers[0].method != "GET" {
            return Err("HIR must contain exactly one GET handler".to_owned());
        }
        if self.handlers[0].component >= self.components.len() {
            return Err("GET handler references a missing component".to_owned());
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
        Ok(())
    }
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
