use std::{
    io,
    sync::atomic::{AtomicBool, Ordering},
};

const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;
const SIGNAL_ERROR: usize = usize::MAX;

static REQUESTED: AtomicBool = AtomicBool::new(false);

unsafe extern "C" {
    fn signal(number: i32, handler: usize) -> usize;
}

pub fn install() -> io::Result<()> {
    for number in [SIGINT, SIGTERM] {
        // SAFETY: `handle` has the C signal-handler ABI, performs only a
        // lock-free atomic store, and remains valid for the process lifetime.
        let previous = unsafe { signal(number, handle as *const () as usize) };
        if previous == SIGNAL_ERROR {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

pub fn requested() -> bool {
    REQUESTED.load(Ordering::Acquire)
}

extern "C" fn handle(_number: i32) {
    REQUESTED.store(true, Ordering::Release);
}
