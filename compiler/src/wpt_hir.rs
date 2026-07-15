use serde::{Deserialize, Serialize};

use crate::hir::SourceSpan;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WptProgram {
    pub version: u32,
    pub target: String,
    pub entry: String,
    pub tests: Vec<WptTest>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WptTest {
    pub name: String,
    pub slots: usize,
    pub operations: Vec<WptOperation>,
    pub span: SourceSpan,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind")]
pub enum WptOperation {
    #[serde(rename = "urlSearchParamsConstruct")]
    Construct {
        slot: usize,
        input: String,
        span: SourceSpan,
    },
    #[serde(rename = "urlSearchParamsAppend")]
    Append {
        slot: usize,
        name: String,
        value: String,
        span: SourceSpan,
    },
    #[serde(rename = "urlSearchParamsDelete")]
    Delete {
        slot: usize,
        name: String,
        #[serde(default)]
        value: Option<String>,
        span: SourceSpan,
    },
    #[serde(rename = "urlSearchParamsAssertConstructed")]
    AssertConstructed {
        slot: usize,
        #[serde(default)]
        message: Option<String>,
        span: SourceSpan,
    },
    #[serde(rename = "urlSearchParamsAssertGet")]
    AssertGet {
        slot: usize,
        name: String,
        expected: Option<String>,
        #[serde(default)]
        message: Option<String>,
        span: SourceSpan,
    },
    #[serde(rename = "urlSearchParamsAssertHas")]
    AssertHas {
        slot: usize,
        name: String,
        #[serde(default)]
        value: Option<String>,
        expected: bool,
        #[serde(default)]
        message: Option<String>,
        span: SourceSpan,
    },
}

impl WptOperation {
    fn slot(&self) -> usize {
        match self {
            Self::Construct { slot, .. }
            | Self::Append { slot, .. }
            | Self::Delete { slot, .. }
            | Self::AssertConstructed { slot, .. }
            | Self::AssertGet { slot, .. }
            | Self::AssertHas { slot, .. } => *slot,
        }
    }

    fn is_assertion(&self) -> bool {
        matches!(
            self,
            Self::AssertConstructed { .. } | Self::AssertGet { .. } | Self::AssertHas { .. }
        )
    }
}

impl WptProgram {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 2 {
            return Err(format!("unsupported WPT HIR version {}", self.version));
        }
        if self.target != "aarch64-apple-darwin" {
            return Err(format!("unsupported WPT target `{}`", self.target));
        }
        if self.entry.is_empty() {
            return Err("WPT entry must not be empty".to_owned());
        }
        if self.tests.is_empty() {
            return Err("WPT program must contain a test".to_owned());
        }
        for test in &self.tests {
            if test.name.is_empty() {
                return Err("WPT test name must not be empty".to_owned());
            }
            if test.slots == 0 {
                return Err(format!("WPT test `{}` must declare a slot", test.name));
            }
            if test.operations.is_empty() || !test.operations.iter().any(WptOperation::is_assertion)
            {
                return Err(format!(
                    "WPT test `{}` must contain an assertion",
                    test.name
                ));
            }
            let mut constructed = vec![false; test.slots];
            for operation in &test.operations {
                let slot = operation.slot();
                if slot >= test.slots {
                    return Err(format!(
                        "WPT test `{}` operation references slot {slot}, but only {} slot(s) exist",
                        test.name, test.slots
                    ));
                }
                if matches!(operation, WptOperation::Construct { .. }) {
                    constructed[slot] = true;
                } else if !constructed[slot] {
                    return Err(format!(
                        "WPT test `{}` uses slot {slot} before construction",
                        test.name
                    ));
                }
            }
        }
        Ok(())
    }
}
