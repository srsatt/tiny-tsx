mod abi;
mod application;
mod http;

fn main() {
    let workers = abi::configured_workers();
    match application::initialize(workers) {
        Ok(application_workers) if application_workers > 0 => {
            println!("Application workers: {workers}; logical workers: {application_workers}");
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
