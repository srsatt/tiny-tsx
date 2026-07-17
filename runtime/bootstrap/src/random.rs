use std::{ffi::c_void, io};

const HEX: &[u8; 16] = b"0123456789abcdef";

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn arc4random_buf(buffer: *mut c_void, length: usize);
}

#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn getrandom(buffer: *mut c_void, length: usize, flags: u32) -> isize;
}

pub(crate) fn uuid_v4() -> io::Result<[u8; 36]> {
    let mut random = [0_u8; 16];
    fill_random(&mut random)?;
    random[6] = (random[6] & 0x0f) | 0x40;
    random[8] = (random[8] & 0x3f) | 0x80;

    let mut output = [0_u8; 36];
    let mut cursor = 0;
    for (index, byte) in random.into_iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            output[cursor] = b'-';
            cursor += 1;
        }
        output[cursor] = HEX[(byte >> 4) as usize];
        output[cursor + 1] = HEX[(byte & 0x0f) as usize];
        cursor += 2;
    }
    Ok(output)
}

#[cfg(target_os = "macos")]
fn fill_random(bytes: &mut [u8]) -> io::Result<()> {
    // SAFETY: `bytes` is writable for exactly the supplied length.
    unsafe { arc4random_buf(bytes.as_mut_ptr().cast(), bytes.len()) };
    Ok(())
}

#[cfg(target_os = "linux")]
fn fill_random(bytes: &mut [u8]) -> io::Result<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        // SAFETY: The pointer starts within `bytes` and the remaining length is writable.
        let read = unsafe {
            getrandom(
                bytes.as_mut_ptr().add(offset).cast(),
                bytes.len() - offset,
                0,
            )
        };
        if read > 0 {
            offset += read as usize;
            continue;
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::uuid_v4;

    #[test]
    fn generates_distinct_lowercase_version_four_uuids() {
        let first = uuid_v4().expect("first UUID");
        let second = uuid_v4().expect("second UUID");

        assert_ne!(first, second);
        for uuid in [first, second] {
            assert_eq!(uuid.len(), 36);
            assert_eq!(uuid[14], b'4');
            assert!(matches!(uuid[19], b'8' | b'9' | b'a' | b'b'));
            assert_eq!(&uuid[8..9], b"-");
            assert_eq!(&uuid[13..14], b"-");
            assert_eq!(&uuid[18..19], b"-");
            assert_eq!(&uuid[23..24], b"-");
            assert!(
                uuid.iter()
                    .all(|byte| byte.is_ascii_hexdigit() || *byte == b'-')
            );
        }
    }
}
