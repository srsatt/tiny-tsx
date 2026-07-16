mod abi;
mod application;
mod environment;
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
    let workers = abi::configured_workers();
    match application::initialize(workers) {
        Ok((logical_workers, provider_transport)) if logical_workers > 0 || provider_transport => {
            println!(
                "Application workers: {workers}; logical workers: {logical_workers}; provider transport: {}",
                if provider_transport {
                    "enabled"
                } else {
                    "disabled"
                },
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
