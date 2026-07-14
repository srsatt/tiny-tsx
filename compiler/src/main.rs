mod cli;
mod codegen;
mod frontend;
mod hir;

fn main() {
    if let Err(error) = cli::run(std::env::args_os().skip(1)) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
