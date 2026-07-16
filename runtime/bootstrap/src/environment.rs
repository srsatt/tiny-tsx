use std::{collections::BTreeMap, ffi::OsString, io, sync::OnceLock};

use crate::abi::{configured_environment_variable, configured_environment_variables};

pub const MAX_ENVIRONMENT_VALUE_BYTES: usize = 4096;

pub enum SnapshotValue {
    Present(Vec<u8>),
    Missing,
    InvalidUtf8,
    TooLarge,
}

static SNAPSHOT: OnceLock<BTreeMap<Vec<u8>, SnapshotValue>> = OnceLock::new();

pub fn initialize() -> io::Result<usize> {
    let count = configured_environment_variables();
    let mut snapshot = BTreeMap::new();
    for index in 0..count {
        let name = configured_environment_variable(index)
            .map_err(|status| io::Error::other(format!("environment config status {status}")))?;
        let name_string = String::from_utf8(name.clone())
            .map_err(|_| io::Error::other("generated environment name is not UTF-8"))?;
        let value = snapshot_value(std::env::var_os(name_string));
        snapshot.insert(name, value);
    }
    SNAPSHOT
        .set(snapshot)
        .map_err(|_| io::Error::other("environment snapshot was already initialized"))?;
    Ok(count)
}

pub fn get(name: &[u8]) -> Option<&'static SnapshotValue> {
    SNAPSHOT.get()?.get(name)
}

fn snapshot_value(value: Option<OsString>) -> SnapshotValue {
    let Some(value) = value else {
        return SnapshotValue::Missing;
    };
    let Ok(value) = value.into_string() else {
        return SnapshotValue::InvalidUtf8;
    };
    if value.len() > MAX_ENVIRONMENT_VALUE_BYTES {
        SnapshotValue::TooLarge
    } else {
        SnapshotValue::Present(value.into_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_ENVIRONMENT_VALUE_BYTES, SnapshotValue, snapshot_value};
    use std::ffi::OsString;

    #[test]
    fn classifies_missing_present_and_oversized_values() {
        assert!(matches!(snapshot_value(None), SnapshotValue::Missing));
        assert!(matches!(
            snapshot_value(Some(OsString::from("tiny"))),
            SnapshotValue::Present(value) if value == b"tiny"
        ));
        assert!(matches!(
            snapshot_value(Some(OsString::from("x".repeat(MAX_ENVIRONMENT_VALUE_BYTES + 1)))),
            SnapshotValue::TooLarge
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_non_utf8_values() {
        use std::os::unix::ffi::OsStringExt;

        assert!(matches!(
            snapshot_value(Some(OsString::from_vec(vec![0xff]))),
            SnapshotValue::InvalidUtf8
        ));
    }
}
