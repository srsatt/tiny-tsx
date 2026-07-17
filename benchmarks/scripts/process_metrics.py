from __future__ import annotations

import ctypes
import threading
import time
from dataclasses import dataclass
from functools import cache


PROC_PIDTASKINFO = 4
PROC_PIDLISTFDS = 1
RUSAGE_INFO_V4 = 4
NANOSECONDS_PER_SECOND = 1_000_000_000


class ProcTaskInfo(ctypes.Structure):
    _fields_ = [
        ("virtual_size", ctypes.c_uint64),
        ("resident_size", ctypes.c_uint64),
        ("total_user", ctypes.c_uint64),
        ("total_system", ctypes.c_uint64),
        ("threads_user", ctypes.c_uint64),
        ("threads_system", ctypes.c_uint64),
        ("policy", ctypes.c_int32),
        ("faults", ctypes.c_int32),
        ("pageins", ctypes.c_int32),
        ("cow_faults", ctypes.c_int32),
        ("messages_sent", ctypes.c_int32),
        ("messages_received", ctypes.c_int32),
        ("syscalls_mach", ctypes.c_int32),
        ("syscalls_unix", ctypes.c_int32),
        ("context_switches", ctypes.c_int32),
        ("thread_count", ctypes.c_int32),
        ("running_threads", ctypes.c_int32),
        ("priority", ctypes.c_int32),
    ]


class RusageInfoV4(ctypes.Structure):
    _fields_ = [
        ("uuid", ctypes.c_uint8 * 16),
        ("user_time", ctypes.c_uint64),
        ("system_time", ctypes.c_uint64),
        ("package_idle_wakeups", ctypes.c_uint64),
        ("interrupt_wakeups", ctypes.c_uint64),
        ("pageins", ctypes.c_uint64),
        ("wired_size", ctypes.c_uint64),
        ("resident_size", ctypes.c_uint64),
        ("physical_footprint", ctypes.c_uint64),
        ("process_start_absolute_time", ctypes.c_uint64),
        ("process_exit_absolute_time", ctypes.c_uint64),
        ("child_user_time", ctypes.c_uint64),
        ("child_system_time", ctypes.c_uint64),
        ("child_package_idle_wakeups", ctypes.c_uint64),
        ("child_interrupt_wakeups", ctypes.c_uint64),
        ("child_pageins", ctypes.c_uint64),
        ("child_elapsed_absolute_time", ctypes.c_uint64),
        ("disk_bytes_read", ctypes.c_uint64),
        ("disk_bytes_written", ctypes.c_uint64),
        ("cpu_qos_default", ctypes.c_uint64),
        ("cpu_qos_maintenance", ctypes.c_uint64),
        ("cpu_qos_background", ctypes.c_uint64),
        ("cpu_qos_utility", ctypes.c_uint64),
        ("cpu_qos_legacy", ctypes.c_uint64),
        ("cpu_qos_user_initiated", ctypes.c_uint64),
        ("cpu_qos_user_interactive", ctypes.c_uint64),
        ("billed_system_time", ctypes.c_uint64),
        ("serviced_system_time", ctypes.c_uint64),
        ("logical_writes", ctypes.c_uint64),
        ("lifetime_max_physical_footprint", ctypes.c_uint64),
        ("instructions", ctypes.c_uint64),
        ("cycles", ctypes.c_uint64),
        ("billed_energy", ctypes.c_uint64),
        ("serviced_energy", ctypes.c_uint64),
        ("interval_max_physical_footprint", ctypes.c_uint64),
        ("runnable_time", ctypes.c_uint64),
    ]


class MachTimebaseInfo(ctypes.Structure):
    _fields_ = [("numerator", ctypes.c_uint32), ("denominator", ctypes.c_uint32)]


class ProcFdInfo(ctypes.Structure):
    _fields_ = [("file_descriptor", ctypes.c_int32), ("fd_type", ctypes.c_uint32)]


@dataclass(frozen=True)
class Snapshot:
    resident_size: int
    total_user: int
    total_system: int
    faults: int
    pageins: int
    cow_faults: int
    syscalls_mach: int
    syscalls_unix: int
    context_switches: int
    thread_count: int
    disk_bytes_read: int = 0
    disk_bytes_written: int = 0
    instructions: int = 0
    cycles: int = 0
    open_file_descriptors: int = 0


class ProcessSampler:
    def __init__(self, pid: int, interval_seconds: float = 0.02) -> None:
        self.pid = pid
        self.interval_seconds = interval_seconds
        self.started = snapshot(pid)
        self.started_at = time.monotonic()
        self.peak_rss = self.started.resident_size
        self.peak_threads = self.started.thread_count
        self.peak_open_file_descriptors = self.started.open_file_descriptors
        self._stopped = threading.Event()
        self._thread = threading.Thread(target=self._sample, daemon=True)
        self._thread.start()

    def stop(self) -> dict[str, float | int]:
        self._stopped.set()
        self._thread.join()
        ended = snapshot(self.pid)
        elapsed = time.monotonic() - self.started_at
        self.peak_rss = max(self.peak_rss, ended.resident_size)
        self.peak_threads = max(self.peak_threads, ended.thread_count)
        self.peak_open_file_descriptors = max(
            self.peak_open_file_descriptors, ended.open_file_descriptors
        )
        return measurement(
            self.started,
            ended,
            elapsed,
            self.peak_rss,
            peak_threads=self.peak_threads,
            peak_open_file_descriptors=self.peak_open_file_descriptors,
        )

    def _sample(self) -> None:
        while not self._stopped.wait(self.interval_seconds):
            try:
                value = snapshot(self.pid)
                self.peak_rss = max(self.peak_rss, value.resident_size)
                self.peak_threads = max(self.peak_threads, value.thread_count)
                self.peak_open_file_descriptors = max(
                    self.peak_open_file_descriptors, value.open_file_descriptors
                )
            except ProcessLookupError:
                return


def snapshot(pid: int) -> Snapshot:
    task = ProcTaskInfo()
    result = _libproc().proc_pidinfo(
        pid,
        PROC_PIDTASKINFO,
        0,
        ctypes.byref(task),
        ctypes.sizeof(task),
    )
    if result != ctypes.sizeof(task):
        raise ProcessLookupError(pid)
    usage = RusageInfoV4()
    if _libproc().proc_pid_rusage(pid, RUSAGE_INFO_V4, ctypes.byref(usage)) != 0:
        raise ProcessLookupError(pid)
    return Snapshot(
        resident_size=usage.resident_size,
        total_user=usage.user_time,
        total_system=usage.system_time,
        faults=task.faults,
        pageins=task.pageins,
        cow_faults=task.cow_faults,
        syscalls_mach=task.syscalls_mach,
        syscalls_unix=task.syscalls_unix,
        context_switches=task.context_switches,
        thread_count=task.thread_count,
        disk_bytes_read=usage.disk_bytes_read,
        disk_bytes_written=usage.disk_bytes_written,
        instructions=usage.instructions,
        cycles=usage.cycles,
        open_file_descriptors=_open_file_descriptor_count(pid),
    )


def measurement(
    started: Snapshot,
    ended: Snapshot,
    elapsed_seconds: float,
    peak_rss_bytes: int,
    nanoseconds_per_tick: float | None = None,
    peak_threads: int | None = None,
    peak_open_file_descriptors: int | None = None,
) -> dict[str, float | int]:
    scale = _nanoseconds_per_tick() if nanoseconds_per_tick is None else nanoseconds_per_tick
    user_seconds = (
        max(0, ended.total_user - started.total_user) * scale / NANOSECONDS_PER_SECOND
    )
    system_seconds = (
        max(0, ended.total_system - started.total_system) * scale / NANOSECONDS_PER_SECOND
    )
    cpu_seconds = user_seconds + system_seconds
    return {
        "wallSeconds": elapsed_seconds,
        "userCpuSeconds": user_seconds,
        "systemCpuSeconds": system_seconds,
        "cpuSeconds": cpu_seconds,
        "cpuUtilizationPercent": cpu_seconds / elapsed_seconds * 100 if elapsed_seconds else 0,
        "peakRssBytes": peak_rss_bytes,
        "pageFaults": _delta(started.faults, ended.faults),
        "pageIns": _delta(started.pageins, ended.pageins),
        "copyOnWriteFaults": _delta(started.cow_faults, ended.cow_faults),
        "machSyscalls": _delta(started.syscalls_mach, ended.syscalls_mach),
        "unixSyscalls": _delta(started.syscalls_unix, ended.syscalls_unix),
        "contextSwitches": _delta(started.context_switches, ended.context_switches),
        "peakThreads": (
            max(started.thread_count, ended.thread_count)
            if peak_threads is None
            else peak_threads
        ),
        "openFileDescriptorsStart": started.open_file_descriptors,
        "openFileDescriptorsPeak": (
            max(started.open_file_descriptors, ended.open_file_descriptors)
            if peak_open_file_descriptors is None
            else peak_open_file_descriptors
        ),
        "openFileDescriptorsEnd": ended.open_file_descriptors,
        "diskBytesRead": _delta(started.disk_bytes_read, ended.disk_bytes_read),
        "diskBytesWritten": _delta(started.disk_bytes_written, ended.disk_bytes_written),
        "instructions": _delta(started.instructions, ended.instructions),
        "cycles": _delta(started.cycles, ended.cycles),
    }


def _delta(started: int, ended: int) -> int:
    return max(0, ended - started)


def _open_file_descriptor_count(pid: int) -> int:
    required = _libproc().proc_pidinfo(pid, PROC_PIDLISTFDS, 0, None, 0)
    if required <= 0:
        raise ProcessLookupError(pid)
    buffer = (ctypes.c_ubyte * required)()
    used = _libproc().proc_pidinfo(
        pid,
        PROC_PIDLISTFDS,
        0,
        ctypes.byref(buffer),
        required,
    )
    if used < 0:
        raise ProcessLookupError(pid)
    return used // ctypes.sizeof(ProcFdInfo)


@cache
def _nanoseconds_per_tick() -> float:
    value = MachTimebaseInfo()
    library = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    library.mach_timebase_info.argtypes = [ctypes.POINTER(MachTimebaseInfo)]
    library.mach_timebase_info.restype = ctypes.c_int
    if library.mach_timebase_info(ctypes.byref(value)) != 0 or value.denominator == 0:
        raise RuntimeError("mach_timebase_info failed")
    return value.numerator / value.denominator


@cache
def _libproc() -> ctypes.CDLL:
    library = ctypes.CDLL("/usr/lib/libproc.dylib")
    library.proc_pidinfo.argtypes = [
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_uint64,
        ctypes.c_void_p,
        ctypes.c_int,
    ]
    library.proc_pidinfo.restype = ctypes.c_int
    library.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    library.proc_pid_rusage.restype = ctypes.c_int
    return library
