use serde::{Deserialize, Serialize};

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
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub modules: usize,
    pub components: usize,
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
        Ok(())
    }
}
