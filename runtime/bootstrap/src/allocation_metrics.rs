#[cfg(feature = "allocation-metrics")]
mod enabled {
    use std::{
        alloc::{GlobalAlloc, Layout, System},
        sync::atomic::{AtomicUsize, Ordering},
    };

    struct CountingAllocator;

    static ALLOCATION_CALLS: AtomicUsize = AtomicUsize::new(0);
    static DEALLOCATION_CALLS: AtomicUsize = AtomicUsize::new(0);
    static REALLOCATION_CALLS: AtomicUsize = AtomicUsize::new(0);
    static ALLOCATED_BYTES: AtomicUsize = AtomicUsize::new(0);
    static LIVE_BYTES: AtomicUsize = AtomicUsize::new(0);
    static PEAK_LIVE_BYTES: AtomicUsize = AtomicUsize::new(0);

    #[global_allocator]
    static ALLOCATOR: CountingAllocator = CountingAllocator;

    unsafe impl GlobalAlloc for CountingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            let pointer = unsafe { System.alloc(layout) };
            if !pointer.is_null() {
                ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
                ALLOCATED_BYTES.fetch_add(layout.size(), Ordering::Relaxed);
                increase_live_bytes(layout.size());
            }
            pointer
        }

        unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
            let pointer = unsafe { System.alloc_zeroed(layout) };
            if !pointer.is_null() {
                ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
                ALLOCATED_BYTES.fetch_add(layout.size(), Ordering::Relaxed);
                increase_live_bytes(layout.size());
            }
            pointer
        }

        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            DEALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
            LIVE_BYTES.fetch_sub(layout.size(), Ordering::Relaxed);
            unsafe { System.dealloc(pointer, layout) };
        }

        unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
            let resized = unsafe { System.realloc(pointer, layout, new_size) };
            if !resized.is_null() {
                REALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
                ALLOCATED_BYTES.fetch_add(new_size, Ordering::Relaxed);
                if new_size >= layout.size() {
                    increase_live_bytes(new_size - layout.size());
                } else {
                    LIVE_BYTES.fetch_sub(layout.size() - new_size, Ordering::Relaxed);
                }
            }
            resized
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct Snapshot {
        allocation_calls: usize,
        deallocation_calls: usize,
        reallocation_calls: usize,
        allocated_bytes: usize,
        live_bytes: usize,
        peak_live_bytes: usize,
    }

    pub fn report_if_requested() {
        if std::env::var_os("TINYTSX_INTERNAL_ALLOC_METRICS").as_deref()
            != Some(std::ffi::OsStr::new("1"))
        {
            return;
        }
        let snapshot = snapshot();
        eprintln!(
            "TINYTSX_ALLOC_METRICS {{\"allocationCalls\":{},\"deallocationCalls\":{},\"reallocationCalls\":{},\"allocatedBytes\":{},\"liveBytes\":{},\"peakLiveBytes\":{}}}",
            snapshot.allocation_calls,
            snapshot.deallocation_calls,
            snapshot.reallocation_calls,
            snapshot.allocated_bytes,
            snapshot.live_bytes,
            snapshot.peak_live_bytes,
        );
    }

    fn increase_live_bytes(bytes: usize) {
        let live = LIVE_BYTES.fetch_add(bytes, Ordering::Relaxed) + bytes;
        PEAK_LIVE_BYTES.fetch_max(live, Ordering::Relaxed);
    }

    fn snapshot() -> Snapshot {
        Snapshot {
            allocation_calls: ALLOCATION_CALLS.load(Ordering::Relaxed),
            deallocation_calls: DEALLOCATION_CALLS.load(Ordering::Relaxed),
            reallocation_calls: REALLOCATION_CALLS.load(Ordering::Relaxed),
            allocated_bytes: ALLOCATED_BYTES.load(Ordering::Relaxed),
            live_bytes: LIVE_BYTES.load(Ordering::Relaxed),
            peak_live_bytes: PEAK_LIVE_BYTES.load(Ordering::Relaxed),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn records_owned_allocation_activity() {
            let before = snapshot();
            let value = vec![0_u8; 4_096];
            let during = snapshot();
            assert!(during.allocation_calls > before.allocation_calls);
            assert!(during.allocated_bytes >= before.allocated_bytes + value.len());
            assert!(during.peak_live_bytes >= during.live_bytes);
            drop(value);
            assert!(snapshot().deallocation_calls > before.deallocation_calls);
        }
    }
}

#[cfg(feature = "allocation-metrics")]
pub use enabled::report_if_requested;

#[cfg(not(feature = "allocation-metrics"))]
pub fn report_if_requested() {}
