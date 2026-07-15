use serde::{Deserialize, Serialize};

use crate::hir::SourceSpan;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Test262Program {
    pub version: u32,
    pub target: String,
    pub entry: String,
    pub assertions: Vec<SameValueStringAssertion>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SameValueStringAssertion {
    SameValueString {
        actual: String,
        expected: String,
        #[serde(default)]
        message: Option<String>,
        span: SourceSpan,
    },
}

impl Test262Program {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!("unsupported Test262 HIR version {}", self.version));
        }
        if self.target != "aarch64-apple-darwin" {
            return Err(format!("unsupported Test262 target `{}`", self.target));
        }
        if self.entry.is_empty() {
            return Err("Test262 entry must not be empty".to_owned());
        }
        if self.assertions.is_empty() {
            return Err("Test262 program must contain an assertion".to_owned());
        }
        Ok(())
    }
}
