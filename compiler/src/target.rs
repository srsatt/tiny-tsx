use std::{fmt, str::FromStr};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Target {
    MacosArm64,
    LinuxArm64,
    MacosX86_64,
    LinuxX86_64,
}

impl Target {
    pub(crate) const fn default_for_host() -> Self {
        if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
            Self::LinuxArm64
        } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            Self::LinuxX86_64
        } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
            Self::MacosX86_64
        } else {
            Self::MacosArm64
        }
    }

    pub(crate) const fn triple(self) -> &'static str {
        match self {
            Self::MacosArm64 => "aarch64-apple-darwin",
            Self::LinuxArm64 => "aarch64-unknown-linux-gnu",
            Self::MacosX86_64 => "x86_64-apple-darwin",
            Self::LinuxX86_64 => "x86_64-unknown-linux-gnu",
        }
    }

    pub(crate) const fn is_aarch64(self) -> bool {
        matches!(self, Self::MacosArm64 | Self::LinuxArm64)
    }

    pub(crate) fn can_link_from(self, host: Self) -> bool {
        self == host || matches!((host, self), (Self::MacosArm64, Self::MacosX86_64))
    }

    pub(crate) fn host() -> Result<Self, String> {
        if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            Ok(Self::MacosArm64)
        } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
            Ok(Self::LinuxArm64)
        } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
            Ok(Self::MacosX86_64)
        } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            Ok(Self::LinuxX86_64)
        } else {
            Err(format!(
                "unsupported build host `{}-{}`; supported native targets are {}, {}, {}, and {}",
                std::env::consts::ARCH,
                std::env::consts::OS,
                Self::MacosArm64,
                Self::LinuxArm64,
                Self::MacosX86_64,
                Self::LinuxX86_64,
            ))
        }
    }

    pub(crate) fn ensure_native(self) -> Result<(), String> {
        let host = Self::host()?;
        if self.can_link_from(host) {
            Ok(())
        } else {
            Err(format!(
                "target `{self}` cannot be linked on this `{host}` host; use `check --target {self} --emit-asm` to inspect cross-target assembly"
            ))
        }
    }
}

impl fmt::Display for Target {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.triple())
    }
}

impl FromStr for Target {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "aarch64-apple-darwin" | "macos-arm64" => Ok(Self::MacosArm64),
            "aarch64-unknown-linux-gnu" | "linux-arm64" => Ok(Self::LinuxArm64),
            "x86_64-apple-darwin" | "macos-x64" => Ok(Self::MacosX86_64),
            "x86_64-unknown-linux-gnu" | "linux-x64" => Ok(Self::LinuxX86_64),
            _ => Err(format!(
                "unsupported target `{value}`; expected `aarch64-apple-darwin`, `aarch64-unknown-linux-gnu`, `x86_64-apple-darwin`, or `x86_64-unknown-linux-gnu`"
            )),
        }
    }
}

#[cfg(test)]
#[path = "target_tests.rs"]
mod tests;
