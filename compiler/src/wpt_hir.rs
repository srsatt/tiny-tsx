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
    pub url_slots: usize,
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
    #[serde(rename = "urlSearchParamsAssertStringified")]
    AssertStringified {
        slot: usize,
        expected: String,
        #[serde(default)]
        message: Option<String>,
        span: SourceSpan,
    },
    #[serde(rename = "urlConstruct")]
    UrlConstruct {
        #[serde(rename = "urlSlot")]
        url_slot: usize,
        #[serde(rename = "paramsSlot")]
        params_slot: usize,
        input: String,
        span: SourceSpan,
    },
    #[serde(rename = "urlAssertStringified")]
    UrlAssertStringified {
        #[serde(rename = "urlSlot")]
        url_slot: usize,
        expected: String,
        #[serde(default)]
        message: Option<String>,
        span: SourceSpan,
    },
}

impl WptOperation {
    fn params_slot(&self) -> Option<usize> {
        match self {
            Self::Construct { slot, .. }
            | Self::Append { slot, .. }
            | Self::Delete { slot, .. }
            | Self::AssertConstructed { slot, .. }
            | Self::AssertGet { slot, .. }
            | Self::AssertHas { slot, .. }
            | Self::AssertStringified { slot, .. } => Some(*slot),
            Self::UrlConstruct { params_slot, .. } => Some(*params_slot),
            Self::UrlAssertStringified { .. } => None,
        }
    }

    fn url_slot(&self) -> Option<usize> {
        match self {
            Self::UrlConstruct { url_slot, .. } | Self::UrlAssertStringified { url_slot, .. } => {
                Some(*url_slot)
            }
            _ => None,
        }
    }

    fn is_assertion(&self) -> bool {
        matches!(
            self,
            Self::AssertConstructed { .. }
                | Self::AssertGet { .. }
                | Self::AssertHas { .. }
                | Self::AssertStringified { .. }
                | Self::UrlAssertStringified { .. }
        )
    }
}

impl WptProgram {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 3 {
            return Err(format!("unsupported WPT HIR version {}", self.version));
        }
        if !matches!(
            self.target.as_str(),
            "aarch64-apple-darwin" | "aarch64-unknown-linux-gnu"
        ) {
            return Err(format!("unsupported WPT target `{}`", self.target));
        }
        if self.entry.is_empty() {
            return Err("WPT entry must not be empty".to_owned());
        }
        if self.tests.is_empty() {
            return Err("WPT program must contain a test".to_owned());
        }
        for test in &self.tests {
            validate_test(test)?;
        }
        Ok(())
    }
}

fn validate_test(test: &WptTest) -> Result<(), String> {
    if test.name.is_empty() {
        return Err("WPT test name must not be empty".to_owned());
    }
    if test.slots == 0 {
        return Err(format!(
            "WPT test `{}` must declare a parameter slot",
            test.name
        ));
    }
    if test.operations.is_empty() || !test.operations.iter().any(WptOperation::is_assertion) {
        return Err(format!(
            "WPT test `{}` must contain an assertion",
            test.name
        ));
    }
    let mut params_constructed = vec![false; test.slots];
    let mut urls_constructed = vec![false; test.url_slots];
    for operation in &test.operations {
        if let Some(slot) = operation.params_slot() {
            if slot >= test.slots {
                return Err(format!(
                    "WPT test `{}` references parameter slot {slot}, but only {} slot(s) exist",
                    test.name, test.slots
                ));
            }
            if matches!(
                operation,
                WptOperation::Construct { .. } | WptOperation::UrlConstruct { .. }
            ) {
                params_constructed[slot] = true;
            } else if !params_constructed[slot] {
                return Err(format!(
                    "WPT test `{}` uses parameter slot {slot} before construction",
                    test.name
                ));
            }
        }
        if let Some(slot) = operation.url_slot() {
            if slot >= test.url_slots {
                return Err(format!(
                    "WPT test `{}` references URL slot {slot}, but only {} slot(s) exist",
                    test.name, test.url_slots
                ));
            }
            if matches!(operation, WptOperation::UrlConstruct { .. }) {
                urls_constructed[slot] = true;
            } else if !urls_constructed[slot] {
                return Err(format!(
                    "WPT test `{}` uses URL slot {slot} before construction",
                    test.name
                ));
            }
        }
    }
    Ok(())
}
