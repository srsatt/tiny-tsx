//! Optional, bounded WebAssembly execution for TinyTSX application workers.
//!
//! The default crate has no backend dependency. Enable `interpreter` to use the
//! pinned Wasmi backend. The first profile accepts no imports or WASI and calls
//! one typed `i32 -> i32` export under explicit module, memory, and fuel limits.

use std::{error::Error as StdError, fmt};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub max_module_bytes: usize,
    pub max_memory_bytes: usize,
    pub fuel: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_module_bytes: 64 * 1024,
            max_memory_bytes: 1024 * 1024,
            fuel: 100_000,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    BackendDisabled,
    InvalidLimits,
    ModuleTooLarge { actual: usize, limit: usize },
    ImportsNotAllowed,
    Runtime(String),
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BackendDisabled => formatter.write_str("the WebAssembly interpreter is disabled"),
            Self::InvalidLimits => formatter.write_str("WebAssembly limits must be nonzero"),
            Self::ModuleTooLarge { actual, limit } => {
                write!(
                    formatter,
                    "WebAssembly module is {actual} bytes; limit is {limit}"
                )
            }
            Self::ImportsNotAllowed => {
                formatter.write_str("WebAssembly imports and WASI are not allowed")
            }
            Self::Runtime(message) => formatter.write_str(message),
        }
    }
}

impl StdError for Error {}

#[cfg(not(feature = "interpreter"))]
pub fn invoke_i32(
    _module: &[u8],
    _export: &str,
    _argument: i32,
    limits: Limits,
) -> Result<i32, Error> {
    validate_limits(limits)?;
    Err(Error::BackendDisabled)
}

#[cfg(feature = "interpreter")]
pub fn invoke_i32(bytes: &[u8], export: &str, argument: i32, limits: Limits) -> Result<i32, Error> {
    use wasmi::{Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

    validate_limits(limits)?;
    if bytes.len() > limits.max_module_bytes {
        return Err(Error::ModuleTooLarge {
            actual: bytes.len(),
            limit: limits.max_module_bytes,
        });
    }

    let mut config = Config::default();
    config
        .consume_fuel(true)
        .wasm_memory64(false)
        .wasm_multi_memory(false)
        .wasm_reference_types(false)
        .wasm_tail_call(false)
        .wasm_custom_page_sizes(false);
    let engine = Engine::new(&config);
    let module = Module::new(&engine, bytes).map_err(runtime_error)?;
    if module.imports().next().is_some() {
        return Err(Error::ImportsNotAllowed);
    }

    struct State {
        limits: StoreLimits,
    }
    let store_limits = StoreLimitsBuilder::new()
        .memory_size(limits.max_memory_bytes)
        .instances(1)
        .memories(1)
        .tables(0)
        .table_elements(0)
        .build();
    let mut store = Store::new(
        &engine,
        State {
            limits: store_limits,
        },
    );
    store.limiter(|state| &mut state.limits);
    store.set_fuel(limits.fuel).map_err(runtime_error)?;

    let instance = Linker::<State>::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .map_err(runtime_error)?;
    let function = instance
        .get_typed_func::<i32, i32>(&store, export)
        .map_err(runtime_error)?;
    function.call(&mut store, argument).map_err(runtime_error)
}

fn validate_limits(limits: Limits) -> Result<(), Error> {
    if limits.max_module_bytes == 0 || limits.max_memory_bytes == 0 || limits.fuel == 0 {
        return Err(Error::InvalidLimits);
    }
    Ok(())
}

#[cfg(feature = "interpreter")]
fn runtime_error(error: impl fmt::Display) -> Error {
    Error::Runtime(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{Error, Limits, invoke_i32};

    // Pinned no-import fixture equivalent to:
    // (module (memory (export "memory") 1 2)
    //   (func (export "add_one") (param i32) (result i32)
    //     local.get 0 i32.const 1 i32.add))
    const ADD_ONE_WITH_MEMORY: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01,
        0x7f, 0x03, 0x02, 0x01, 0x00, 0x05, 0x04, 0x01, 0x01, 0x01, 0x02, 0x07, 0x14, 0x02, 0x07,
        0x61, 0x64, 0x64, 0x5f, 0x6f, 0x6e, 0x65, 0x00, 0x00, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72,
        0x79, 0x02, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x41, 0x01, 0x6a, 0x0b,
    ];
    #[cfg(feature = "interpreter")]
    const IMPORTS_HOST_FUNCTION: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x02,
        0x0c, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x04, 0x68, 0x6f, 0x73, 0x74, 0x00, 0x00,
    ];
    #[cfg(feature = "interpreter")]
    const LOOPS_FOREVER: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01,
        0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x0b, 0x01, 0x07, 0x61, 0x64, 0x64, 0x5f, 0x6f, 0x6e,
        0x65, 0x00, 0x00, 0x0a, 0x0b, 0x01, 0x09, 0x00, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x20, 0x00,
        0x0b,
    ];

    #[cfg(not(feature = "interpreter"))]
    #[test]
    fn default_profile_has_no_interpreter() {
        assert_eq!(
            invoke_i32(ADD_ONE_WITH_MEMORY, "add_one", 41, Limits::default()),
            Err(Error::BackendDisabled),
        );
    }

    #[cfg(feature = "interpreter")]
    #[test]
    fn executes_the_pinned_no_wasi_fixture() {
        assert_eq!(
            invoke_i32(ADD_ONE_WITH_MEMORY, "add_one", 41, Limits::default()),
            Ok(42),
        );
    }

    #[cfg(feature = "interpreter")]
    #[test]
    fn enforces_the_linear_memory_limit_at_instantiation() {
        let limits = Limits {
            max_memory_bytes: 65_535,
            ..Limits::default()
        };

        assert!(matches!(
            invoke_i32(ADD_ONE_WITH_MEMORY, "add_one", 41, limits),
            Err(Error::Runtime(_)),
        ));
    }

    #[cfg(feature = "interpreter")]
    #[test]
    fn rejects_every_import_including_wasi() {
        assert_eq!(
            invoke_i32(IMPORTS_HOST_FUNCTION, "add_one", 41, Limits::default()),
            Err(Error::ImportsNotAllowed),
        );
    }

    #[cfg(feature = "interpreter")]
    #[test]
    fn stops_an_infinite_loop_at_the_fuel_limit() {
        let limits = Limits {
            fuel: 100,
            ..Limits::default()
        };

        assert!(matches!(
            invoke_i32(LOOPS_FOREVER, "add_one", 41, limits),
            Err(Error::Runtime(_)),
        ));
    }

    #[cfg(feature = "interpreter")]
    #[test]
    fn rejects_a_module_larger_than_the_profile_limit() {
        let limits = Limits {
            max_module_bytes: ADD_ONE_WITH_MEMORY.len() - 1,
            ..Limits::default()
        };

        assert_eq!(
            invoke_i32(ADD_ONE_WITH_MEMORY, "add_one", 41, limits),
            Err(Error::ModuleTooLarge {
                actual: ADD_ONE_WITH_MEMORY.len(),
                limit: ADD_ONE_WITH_MEMORY.len() - 1,
            }),
        );
    }

    #[test]
    fn rejects_zero_limits_before_selecting_a_backend() {
        let limits = Limits {
            fuel: 0,
            ..Limits::default()
        };

        assert_eq!(
            invoke_i32(ADD_ONE_WITH_MEMORY, "add_one", 41, limits),
            Err(Error::InvalidLimits),
        );
    }
}
