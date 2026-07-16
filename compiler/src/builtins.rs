use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    schema_version: u8,
    compiler_version: &'static str,
    builtins: Vec<Builtin>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Builtin {
    specifier: &'static str,
    status: &'static str,
    targets: &'static [&'static str],
    permissions: &'static [&'static str],
    limits: Limits,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Limits {
    path_bytes: Option<usize>,
    value_bytes: Option<usize>,
    mailbox_messages: Option<usize>,
    query_rows: Option<usize>,
}

pub fn json() -> Result<String, String> {
    serde_json::to_string_pretty(&manifest())
        .map_err(|error| format!("could not serialize built-in manifest: {error}"))
}

fn manifest() -> Manifest {
    const TARGETS: &[&str] = &["aarch64-apple-darwin", "aarch64-unknown-linux-gnu"];
    Manifest {
        schema_version: 1,
        compiler_version: env!("CARGO_PKG_VERSION"),
        builtins: vec![
            Builtin {
                specifier: "tinytsx:serve",
                status: "native",
                targets: TARGETS,
                permissions: &[],
                limits: empty_limits(),
            },
            Builtin {
                specifier: "tinytsx:env",
                status: "native",
                targets: TARGETS,
                permissions: &["allow-env"],
                limits: Limits {
                    value_bytes: Some(4_096),
                    ..empty_limits()
                },
            },
            Builtin {
                specifier: "tinytsx:fs",
                status: "native",
                targets: TARGETS,
                permissions: &["allow-read"],
                limits: Limits {
                    path_bytes: Some(4_096),
                    value_bytes: Some(1_048_576),
                    ..empty_limits()
                },
            },
            Builtin {
                specifier: "tinytsx:sqlite",
                status: "declared",
                targets: TARGETS,
                permissions: &["allow-read", "allow-write"],
                limits: Limits {
                    path_bytes: Some(4_096),
                    value_bytes: Some(1_048_576),
                    query_rows: Some(1_024),
                    ..empty_limits()
                },
            },
            Builtin {
                specifier: "tinytsx:actors",
                status: "declared",
                targets: TARGETS,
                permissions: &[],
                limits: Limits {
                    mailbox_messages: Some(64),
                    value_bytes: Some(65_536),
                    ..empty_limits()
                },
            },
        ],
    }
}

const fn empty_limits() -> Limits {
    Limits {
        path_bytes: None,
        value_bytes: None,
        mailbox_messages: None,
        query_rows: None,
    }
}

#[cfg(test)]
mod tests {
    use super::manifest;

    #[test]
    fn manifest_has_all_protected_builtin_specifiers() {
        assert_eq!(
            manifest()
                .builtins
                .iter()
                .map(|builtin| builtin.specifier)
                .collect::<Vec<_>>(),
            [
                "tinytsx:serve",
                "tinytsx:env",
                "tinytsx:fs",
                "tinytsx:sqlite",
                "tinytsx:actors",
            ]
        );
        assert_eq!(manifest().builtins[1].status, "native");
        assert_eq!(manifest().builtins[2].status, "native");
    }
}
