use serde::{Deserialize, Serialize};

use crate::hir::SourceSpan;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Test262Program {
    pub version: u32,
    pub target: String,
    pub entry: String,
    pub assertions: Vec<Test262Assertion>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Test262Assertion {
    SameValueString {
        actual: String,
        expected: String,
        #[serde(default)]
        message: Option<String>,
        span: SourceSpan,
    },
    ForThrowCounter {
        initial: i64,
        threshold: i64,
        thrown: i64,
        #[serde(rename = "catchExpected")]
        catch_expected: i64,
        #[serde(rename = "finalExpected")]
        final_expected: i64,
        span: SourceSpan,
    },
}

impl Test262Program {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 2 {
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
        for assertion in &self.assertions {
            match assertion {
                Test262Assertion::ForThrowCounter {
                    initial, threshold, ..
                } if threshold == &i64::MAX || initial > threshold => {
                    return Err(
                        "Test262 for/throw counter must reach a finite greater-than threshold"
                            .to_owned(),
                    );
                }
                _ => {}
            }
        }
        Ok(())
    }
}
