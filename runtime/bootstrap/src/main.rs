mod abi;
mod allocation_metrics;
#[cfg(feature = "application")]
mod application;
mod environment;
#[cfg(feature = "application")]
mod filesystem;
mod http;
mod random;
mod shutdown;

fn main() {
    if let Err(error) = shutdown::install() {
        eprintln!("TinyTSX signal-handler error: {error}");
        std::process::exit(1);
    }
    match environment::initialize() {
        Ok(count) if count > 0 => println!("Environment snapshot: {count} variable(s)"),
        Ok(_) => {}
        Err(error) => {
            eprintln!("TinyTSX environment error: {error}");
            std::process::exit(1);
        }
    }
    #[cfg(feature = "application")]
    {
        match filesystem::initialize() {
            Ok(count) if count > 0 => println!("Filesystem read roots: {count}"),
            Ok(_) => {}
            Err(error) => {
                eprintln!("TinyTSX filesystem error: {error}");
                std::process::exit(1);
            }
        }
    }
    #[cfg(feature = "application")]
    {
        let workers = abi::configured_workers();
        match application::initialize(workers) {
            Ok((logical_workers, provider_transport, filesystem))
                if logical_workers > 0
                    || provider_transport
                    || filesystem
                    || abi::configured_actors() > 0
                    || abi::configured_sqlite_databases() > 0 =>
            {
                println!(
                    "Application workers: {workers}; logical workers: {logical_workers}; actors: {}; SQLite databases: {}; provider transport: {}; filesystem: {}",
                    abi::configured_actors(),
                    abi::configured_sqlite_databases(),
                    if provider_transport {
                        "enabled"
                    } else {
                        "disabled"
                    },
                    if filesystem { "enabled" } else { "disabled" },
                );
            }
            Ok(_) => {}
            Err(error) => {
                eprintln!("TinyTSX application pool error: {error}");
                std::process::exit(1);
            }
        }
    }
    let result = http::serve();
    allocation_metrics::report_if_requested();
    if let Err(error) = result {
        eprintln!("TinyTSX runtime error: {error}");
        std::process::exit(1);
    }
}
