use serde::{Deserialize, Serialize};

use crate::hir::SourceSpan;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WptProgram {
    pub version: u32,
    pub target: String,
    pub entry: String,
    pub assertions: Vec<WptAssertion>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WptAssertion {
    UrlSearchParamsConstructed {
        query: String,
        #[serde(default)]
        message: Option<String>,
        #[serde(rename = "testName")]
        test_name: String,
        span: SourceSpan,
    },
    UrlSearchParamsGet {
        query: String,
        name: String,
        expected: Option<String>,
        #[serde(default)]
        message: Option<String>,
        #[serde(rename = "testName")]
        test_name: String,
        span: SourceSpan,
    },
    UrlSearchParamsHas {
        query: String,
        name: String,
        expected: bool,
        #[serde(default)]
        message: Option<String>,
        #[serde(rename = "testName")]
        test_name: String,
        span: SourceSpan,
    },
}

impl WptProgram {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!("unsupported WPT HIR version {}", self.version));
        }
        if self.target != "aarch64-apple-darwin" {
            return Err(format!("unsupported WPT target `{}`", self.target));
        }
        if self.entry.is_empty() {
            return Err("WPT entry must not be empty".to_owned());
        }
        if self.assertions.is_empty() {
            return Err("WPT program must contain an assertion".to_owned());
        }
        Ok(())
    }
}
