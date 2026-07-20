use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use crate::{
    codegen::{AssetFile, AssetStore},
    hir,
};

const MAX_FILES: usize = 1_024;
const MAX_FILE_BYTES: usize = 4 * 1_024 * 1_024;
const MAX_TOTAL_BYTES: usize = 16 * 1_024 * 1_024;

pub fn load(
    declarations: &[String],
    stores: &[hir::AssetStore],
) -> Result<Vec<AssetStore>, String> {
    let configured = declarations
        .iter()
        .filter_map(|value| value.split_once('='))
        .collect::<BTreeMap<_, _>>();
    if configured.len() != declarations.len() {
        return Err("invalid embedded asset declaration".to_owned());
    }
    if stores.len() != configured.len() {
        return Err("every declared embedded asset store must be opened exactly once".to_owned());
    }
    stores
        .iter()
        .map(|store| {
            let directory = configured.get(store.name.as_str()).ok_or_else(|| {
                format!("asset store `{}` was not declared with --asset", store.name)
            })?;
            load_store(Path::new(directory), store)
        })
        .collect()
}

fn load_store(directory: &Path, store: &hir::AssetStore) -> Result<AssetStore, String> {
    let metadata = fs::symlink_metadata(directory).map_err(|error| {
        format!(
            "could not inspect asset directory {}: {error}",
            directory.display()
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "asset root {} must be a real directory",
            directory.display()
        ));
    }
    let root = fs::canonicalize(directory).map_err(|error| {
        format!(
            "could not canonicalize asset directory {}: {error}",
            directory.display()
        )
    })?;
    let mut paths = Vec::new();
    collect_files(&root, &root, &mut paths)?;
    paths.sort();
    if paths.is_empty() || paths.len() > MAX_FILES {
        return Err(format!(
            "asset store `{}` must contain 1..={MAX_FILES} files",
            store.name
        ));
    }
    let mut total = 0_usize;
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| "asset escaped its configured root".to_owned())?;
        let relative = relative
            .to_str()
            .ok_or_else(|| format!("asset path {} is not UTF-8", path.display()))?
            .replace('\\', "/");
        if relative.is_empty()
            || relative.len() > 4096
            || relative
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err(format!(
                "asset path `{relative}` is outside the bounded contract"
            ));
        }
        let bytes = fs::read(&path)
            .map_err(|error| format!("could not read asset {}: {error}", path.display()))?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err(format!("asset `{relative}` exceeds {MAX_FILE_BYTES} bytes"));
        }
        total = total
            .checked_add(bytes.len())
            .filter(|total| *total <= MAX_TOTAL_BYTES)
            .ok_or_else(|| {
                format!(
                    "asset store `{}` exceeds {MAX_TOTAL_BYTES} bytes",
                    store.name
                )
            })?;
        files.push(AssetFile {
            path: format!("/{relative}"),
            mime: mime_type(&relative).to_owned(),
            etag: etag(&bytes),
            bytes,
        });
    }
    let index_path = format!("/{}", store.index);
    let index = files
        .iter()
        .position(|file| file.path == index_path)
        .ok_or_else(|| {
            format!(
                "asset store `{}` has no configured index `{}`",
                store.name, store.index
            )
        })?;
    Ok(AssetStore {
        files,
        index,
        spa_fallback: store.spa_fallback,
    })
}

fn collect_files(root: &Path, directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| {
            format!(
                "could not read asset directory {}: {error}",
                directory.display()
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not enumerate asset directory: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("could not inspect asset {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "asset {} must not be a symbolic link",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_files(root, &path, output)?;
        } else if metadata.is_file() {
            if output.len() == MAX_FILES {
                return Err(format!(
                    "asset directory {} exceeds {MAX_FILES} files",
                    root.display()
                ));
            }
            output.push(path);
        } else {
            return Err(format!("asset {} must be a regular file", path.display()));
        }
    }
    Ok(())
}

fn mime_type(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn etag(bytes: &[u8]) -> String {
    let hash = bytes.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    });
    format!("\"{hash:016x}-{:x}\"", bytes.len())
}
