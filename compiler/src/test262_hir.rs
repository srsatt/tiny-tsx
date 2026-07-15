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
    ArrayUnshiftProgram {
        capacity: usize,
        operations: Vec<ArrayUnshiftOperation>,
        span: SourceSpan,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ArrayUnshiftOperation {
    Unshift {
        values: Vec<i64>,
        span: SourceSpan,
    },
    AssertResult {
        expected: i64,
        span: SourceSpan,
    },
    AssertElement {
        index: usize,
        expected: Option<i64>,
        span: SourceSpan,
    },
    AssertLength {
        expected: i64,
        span: SourceSpan,
    },
}

impl Test262Program {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 3 {
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
                Test262Assertion::ArrayUnshiftProgram {
                    capacity,
                    operations,
                    ..
                } => validate_array_unshift(*capacity, operations)?,
                _ => {}
            }
        }
        Ok(())
    }
}

fn validate_array_unshift(
    capacity: usize,
    operations: &[ArrayUnshiftOperation],
) -> Result<(), String> {
    if capacity == 0 || capacity > 16 {
        return Err("Test262 dense numeric array capacity must be between 1 and 16".to_owned());
    }
    if operations.is_empty() {
        return Err("Test262 dense numeric array program must contain an operation".to_owned());
    }
    let mut length = 0usize;
    let mut has_result = false;
    for operation in operations {
        match operation {
            ArrayUnshiftOperation::Unshift { values, .. } => {
                length = length
                    .checked_add(values.len())
                    .filter(|length| *length <= capacity)
                    .ok_or_else(|| "Test262 dense numeric array capacity exceeded".to_owned())?;
                has_result = true;
            }
            ArrayUnshiftOperation::AssertResult { .. } if !has_result => {
                return Err("Test262 unshift result assertion requires a preceding call".to_owned());
            }
            ArrayUnshiftOperation::AssertElement {
                index,
                expected: Some(_),
                ..
            } if *index >= capacity => {
                return Err("Test262 dense numeric array element exceeds capacity".to_owned());
            }
            _ => {}
        }
    }
    Ok(())
}
