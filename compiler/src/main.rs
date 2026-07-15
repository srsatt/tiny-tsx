mod build;
mod cli;
mod codegen;
mod frontend;
mod hir;
mod test262_build;
mod test262_codegen;
mod test262_hir;

fn main() {
    if let Err(error) = cli::run(std::env::args_os().skip(1)) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
