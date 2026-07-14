mod abi;
mod http;

fn main() {
    if let Err(error) = http::serve() {
        eprintln!("TinyTSX runtime error: {error}");
        std::process::exit(1);
    }
}
