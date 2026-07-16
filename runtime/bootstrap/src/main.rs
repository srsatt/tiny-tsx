mod abi;
mod application;
mod environment;
mod filesystem;
mod http;

fn main() {
    match environment::initialize() {
        Ok(count) if count > 0 => println!("Environment snapshot: {count} variable(s)"),
        Ok(_) => {}
        Err(error) => {
            eprintln!("TinyTSX environment error: {error}");
            std::process::exit(1);
        }
    }
    match filesystem::initialize() {
        Ok(count) if count > 0 => println!("Filesystem read roots: {count}"),
        Ok(_) => {}
        Err(error) => {
            eprintln!("TinyTSX filesystem error: {error}");
            std::process::exit(1);
        }
    }
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
    if let Err(error) = http::serve() {
        eprintln!("TinyTSX runtime error: {error}");
        std::process::exit(1);
    }
}
