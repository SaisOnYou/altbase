//! System memory, the RAMMap way: what Windows' physical memory holds now (`lists`), and its Empty
//! commands (`empty`).
//!
//! - `lists`: total and available from `GlobalMemoryStatusEx`, and the modified, standby and
//!   free page lists from the Memory performance counters (by their English names, so any Windows
//!   language works). No admin rights needed.
//! - `empty`: RAMMap's Empty working sets / modified page list / standby list
//!   (`NtSetSystemInformation(SystemMemoryListInformation)`), which Windows allows only to an
//!   administrator holding SeProfileSingleProcessPrivilege. Altbase itself never runs elevated:
//!   it starts a copy of itself with `--altbase-empty-memory <lists>` through the UAC prompt
//!   (`ShellExecuteExW` "runas"); that copy (`elevated_main`, run before anything else in `main`)
//!   enables the privileges, empties what it was told and exits with a code saying how it went.
//!   It accepts nothing but the fixed list names below.
//!
//! The Win32 calls are declared here directly (C ABI), so this file depends on no crate features.

use std::ffi::c_void;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, Result};

/// The argument the elevated copy recognises; it must be the first.
const ARG: &str = "--altbase-empty-memory";

/// Physical memory now, in MB (RAMMap's Use Counts, summed by list).
#[derive(Serialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MemoryLists {
    pub total_mb: u32,
    /// Neither available nor waiting to be written: what processes and the system hold.
    pub in_use_mb: u32,
    /// Changed pages waiting to be written to disk before they can be reused.
    pub modified_mb: u32,
    /// Cached pages that can be handed out at once (counted as available).
    pub standby_mb: u32,
    /// Free and zeroed pages.
    pub free_mb: u32,
}

/// One of RAMMap's Empty commands.
#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EmptyList {
    /// Every process's working set paged out.
    WorkingSets,
    /// The modified page list written to disk.
    ModifiedList,
    /// The standby list dropped.
    StandbyList,
}

impl EmptyList {
    fn name(self) -> &'static str {
        match self {
            Self::WorkingSets => "workingsets",
            Self::ModifiedList => "modified",
            Self::StandbyList => "standby",
        }
    }

    fn from_name(s: &str) -> Option<Self> {
        [Self::WorkingSets, Self::ModifiedList, Self::StandbyList].into_iter().find(|l| l.name() == s)
    }

    /// SYSTEM_MEMORY_LIST_COMMAND.
    fn command(self) -> u32 {
        match self {
            Self::WorkingSets => 2,  // MemoryEmptyWorkingSets
            Self::ModifiedList => 3, // MemoryFlushModifiedList
            Self::StandbyList => 4,  // MemoryPurgeStandbyList
        }
    }
}

/// The elevated copy's command line after the exe (pure). Working sets first: what they let go
/// lands on the modified and standby lists, which go next, as RAMMap's order suggests.
fn args_for(lists: &[EmptyList]) -> String {
    let mut order: Vec<EmptyList> = [EmptyList::WorkingSets, EmptyList::ModifiedList, EmptyList::StandbyList]
        .into_iter()
        .filter(|l| lists.contains(l))
        .collect();
    order.dedup();
    format!("{ARG} {}", order.iter().map(|l| l.name()).collect::<Vec<_>>().join(","))
}

/// What the elevated copy was asked to empty, from its arguments (pure). None: not that copy.
/// Some(Err): it was, but the list is not one this file wrote.
fn parse_args(args: &[String]) -> Option<std::result::Result<Vec<EmptyList>, ()>> {
    if args.get(1).map(String::as_str) != Some(ARG) {
        return None;
    }
    let lists = match args.get(2) {
        Some(s) if args.len() == 3 => s.split(',').map(EmptyList::from_name).collect::<Option<Vec<_>>>(),
        _ => None,
    };
    Some(lists.filter(|l| !l.is_empty()).ok_or(()))
}

/// Exit codes of the elevated copy.
const EXIT_OK: i32 = 0;
const EXIT_BAD_ARGS: i32 = 2;
const EXIT_NO_PRIVILEGE: i32 = 3;
const EXIT_FAILED: i32 = 4;

/// Run first in `main`: when this process is the elevated copy, does its job and returns the exit
/// code; otherwise None and Altbase starts as usual.
pub fn elevated_main() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let lists = match parse_args(&args)? {
        Ok(l) => l,
        Err(()) => return Some(EXIT_BAD_ARGS),
    };
    if !enable_privilege("SeProfileSingleProcessPrivilege") {
        return Some(EXIT_NO_PRIVILEGE);
    }
    // Lets the working sets of other users' and system processes be emptied too; optional.
    let _ = enable_privilege("SeIncreaseQuotaPrivilege");
    let mut code = EXIT_OK;
    for l in lists {
        let command = l.command();
        // SAFETY: class 80 (SystemMemoryListInformation) takes one u32 command, passed by pointer
        // with its size.
        let status = unsafe { NtSetSystemInformation(SYSTEM_MEMORY_LIST_INFORMATION, (&raw const command).cast(), 4) };
        if status < 0 {
            code = EXIT_FAILED;
        }
    }
    Some(code)
}

/// Asks Windows (UAC) to run the elevated copy for `lists` and waits for it, up to two minutes.
/// `Cancelled` when the user says no at the prompt.
pub fn empty(lists: &[EmptyList]) -> Result<()> {
    if lists.is_empty() {
        return Err(AppError::Invalid(tr!("Pick what to empty.")));
    }
    let exe = std::env::current_exe().map_err(|e| AppError::Internal(e.to_string()))?;
    let exe = wide(&exe.to_string_lossy());
    let params = wide(&args_for(lists));
    let verb = wide("runas");
    let mut info = ShellExecuteInfoW {
        cb_size: std::mem::size_of::<ShellExecuteInfoW>() as u32,
        f_mask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        hwnd: 0,
        lp_verb: verb.as_ptr(),
        lp_file: exe.as_ptr(),
        lp_parameters: params.as_ptr(),
        lp_directory: std::ptr::null(),
        n_show: 0, // SW_HIDE
        h_inst_app: 0,
        lp_id_list: std::ptr::null_mut(),
        lp_class: std::ptr::null(),
        hkey_class: 0,
        dw_hot_key: 0,
        h_icon_or_monitor: 0,
        h_process: 0,
    };
    // SAFETY: `info` is a fully initialised SHELLEXECUTEINFOW whose strings outlive the call.
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        // SAFETY: no arguments.
        let err = unsafe { GetLastError() };
        if err == ERROR_CANCELLED {
            return Err(AppError::Cancelled);
        }
        log::warn!("memory: could not start the elevated helper (error {err})");
        return Err(AppError::Internal(tr!("Windows didn't start the memory cleaner (error {code}).", code = err)));
    }
    if info.h_process == 0 {
        return Err(AppError::Internal(tr!("Windows didn't start the memory cleaner (error {code}).", code = 0)));
    }
    let mut code: u32 = u32::MAX;
    // SAFETY: `h_process` is the helper's process handle (SEE_MASK_NOCLOSEPROCESS), waited on,
    // read and closed once here; `code` is a local.
    let finished = unsafe {
        let waited = WaitForSingleObject(info.h_process, 120_000);
        let read = GetExitCodeProcess(info.h_process, &mut code);
        CloseHandle(info.h_process);
        waited == 0 && read != 0
    };
    let code = if finished { code as i32 } else { -1 };
    log::info!("memory: emptied {} (helper exit {code})", args_for(lists));
    match code {
        EXIT_OK => Ok(()),
        EXIT_NO_PRIVILEGE => Err(AppError::Invalid(tr!("Windows refused: emptying memory lists needs an administrator account."))),
        _ => Err(AppError::Internal(tr!("The memory cleaner didn't finish (code {code}).", code = code))),
    }
}

/// How full the PC's physical memory is, in percent; None when Windows won't say.
pub fn load_pct() -> Option<u32> {
    let mut status = MemoryStatusEx { dw_length: std::mem::size_of::<MemoryStatusEx>() as u32, ..Default::default() };
    // SAFETY: `status` is a MEMORYSTATUSEX with its length set.
    (unsafe { GlobalMemoryStatusEx(&mut status) } != 0).then_some(status.dw_memory_load)
}

/// How often the pressure trim looks, and the least time between two rounds: the pages a trim
/// frees fault back in as the games need them, so trimming again at once only costs CPU.
const PRESSURE_LOOK: std::time::Duration = std::time::Duration::from_secs(20);
const PRESSURE_REST: std::time::Duration = std::time::Duration::from_secs(180);

/// Whether a pressure trim is due (pure): the setting is on, memory is at least that full, and the
/// last round was long enough ago.
fn pressure_due(at_pct: u32, load: Option<u32>, since_last: Option<std::time::Duration>) -> bool {
    at_pct > 0 && load.is_some_and(|l| l >= at_pct) && since_last.is_none_or(|d| d >= PRESSURE_REST)
}

/// The memory-pressure trim (`Settings.trim_at_mem_pct`): while the PC's memory is that full,
/// pages every running client's working set out, at most once every three minutes. No admin
/// rights; the clients' own trims (`limits`) go on as they are.
pub fn spawn_pressure(app: tauri::AppHandle) {
    use tauri::Manager;
    let started = std::thread::Builder::new().name("memory-pressure".into()).spawn(move || {
        let mut last: Option<std::time::Instant> = None;
        loop {
            std::thread::sleep(PRESSURE_LOOK);
            let s = app.state::<crate::App>();
            let at = s.db.settings().map(|v| v.trim_at_mem_pct).unwrap_or(0);
            let load = if at > 0 { load_pct() } else { None };
            if !pressure_due(at, load, last.map(|t| t.elapsed())) {
                continue;
            }
            last = Some(std::time::Instant::now());
            let mut trimmed = 0;
            for (_, pid, t0, _) in s.tracker.clients() {
                if crate::instances::limits::trim(pid, t0).is_ok() {
                    trimmed += 1;
                }
            }
            log::info!("memory: at {}% (trim at {at}%), trimmed {trimmed} clients", load.unwrap_or(0));
        }
    });
    if let Err(e) = started {
        log::warn!("memory-pressure trim not running: {e}");
    }
}

/// Physical memory now. Counters that can't be read count as 0 (logged once).
pub fn lists() -> MemoryLists {
    let mut status = MemoryStatusEx { dw_length: std::mem::size_of::<MemoryStatusEx>() as u32, ..Default::default() };
    // SAFETY: `status` is a MEMORYSTATUSEX with its length set.
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return MemoryLists::default();
    }
    let counters = page_lists().unwrap_or_else(|why| {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| log::warn!("memory: page list counters unreadable: {why}"));
        PageLists::default()
    });
    split(status.ull_total_phys, status.ull_avail_phys, &counters)
}

/// Bytes on each page list, from the Memory counters.
#[derive(Default, Debug, PartialEq)]
struct PageLists {
    modified: u64,
    standby: u64,
    free: u64,
}

/// MB per list from total, available and the page lists (pure). Available is standby plus free,
/// so in use is what neither available nor modified holds.
fn split(total: u64, available: u64, p: &PageLists) -> MemoryLists {
    let mb = |b: u64| u32::try_from(b / (1024 * 1024)).unwrap_or(u32::MAX);
    let in_use = total.saturating_sub(available).saturating_sub(p.modified);
    MemoryLists { total_mb: mb(total), in_use_mb: mb(in_use), modified_mb: mb(p.modified), standby_mb: mb(p.standby), free_mb: mb(p.free) }
}

fn page_lists() -> std::result::Result<PageLists, String> {
    const PATHS: [&str; 5] = [
        r"\Memory\Modified Page List Bytes",
        r"\Memory\Standby Cache Reserve Bytes",
        r"\Memory\Standby Cache Normal Priority Bytes",
        r"\Memory\Standby Cache Core Bytes",
        r"\Memory\Free & Zero Page List Bytes",
    ];
    let mut query: isize = 0;
    // SAFETY: a null data source is the live system; `query` is a local out pointer.
    let s = unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) };
    if s != 0 {
        return Err(format!("PdhOpenQuery {s:#x}"));
    }
    let read = || -> std::result::Result<[u64; 5], String> {
        let mut counters = [0isize; 5];
        for (path, counter) in PATHS.iter().zip(counters.iter_mut()) {
            let w = wide(path);
            // SAFETY: `query` is open; `w` is NUL-terminated and outlives the call.
            let s = unsafe { PdhAddEnglishCounterW(query, w.as_ptr(), 0, counter) };
            if s != 0 {
                return Err(format!("PdhAddEnglishCounter {path} {s:#x}"));
            }
        }
        // SAFETY: `query` is open with its counters added.
        let s = unsafe { PdhCollectQueryData(query) };
        if s != 0 {
            return Err(format!("PdhCollectQueryData {s:#x}"));
        }
        let mut out = [0u64; 5];
        for (c, o) in counters.iter().zip(out.iter_mut()) {
            let mut v = PdhFmtCounterValue::default();
            // SAFETY: `c` was added to the collected query; `v` is a local PDH_FMT_COUNTERVALUE.
            let s = unsafe { PdhGetFormattedCounterValue(*c, PDH_FMT_LARGE, std::ptr::null_mut(), &mut v) };
            if s != 0 {
                return Err(format!("PdhGetFormattedCounterValue {s:#x}"));
            }
            *o = u64::try_from(v.large_value).unwrap_or(0);
        }
        Ok(out)
    };
    let result = read();
    // SAFETY: `query` was opened above and is closed once.
    unsafe { PdhCloseQuery(query) };
    let [modified, reserve, normal, core, free] = result?;
    Ok(PageLists { modified, standby: reserve + normal + core, free })
}

/// Enables a privilege in this process's token; false when the token doesn't hold it.
fn enable_privilege(name: &str) -> bool {
    let name = wide(name);
    let mut luid = Luid::default();
    // SAFETY: a null system name is this PC; `name` is NUL-terminated; `luid` is a local.
    if unsafe { LookupPrivilegeValueW(std::ptr::null(), name.as_ptr(), &mut luid) } == 0 {
        return false;
    }
    let mut token: isize = 0;
    // SAFETY: -1 is GetCurrentProcess()'s pseudo handle; `token` is a local out pointer.
    if unsafe { OpenProcessToken(-1, TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &mut token) } == 0 {
        return false;
    }
    let tp = TokenPrivileges { count: 1, luid, attributes: SE_PRIVILEGE_ENABLED };
    // SAFETY: `token` is open with TOKEN_ADJUST_PRIVILEGES; `tp` holds one privilege. It succeeds
    // even when the privilege wasn't assigned, which GetLastError then says.
    let ok = unsafe { AdjustTokenPrivileges(token, 0, &tp, 0, std::ptr::null_mut(), std::ptr::null_mut()) } != 0
        && unsafe { GetLastError() } != ERROR_NOT_ALL_ASSIGNED;
    // SAFETY: `token` was opened above and is closed once.
    unsafe { CloseHandle(token) };
    ok
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// ---- Win32, declared by hand ----

const SYSTEM_MEMORY_LIST_INFORMATION: u32 = 80;
const SEE_MASK_NOCLOSEPROCESS: u32 = 0x40;
const SEE_MASK_NOASYNC: u32 = 0x100;
const ERROR_CANCELLED: u32 = 1223;
const ERROR_NOT_ALL_ASSIGNED: u32 = 1300;
const TOKEN_ADJUST_PRIVILEGES: u32 = 0x20;
const TOKEN_QUERY: u32 = 0x8;
const SE_PRIVILEGE_ENABLED: u32 = 0x2;
const PDH_FMT_LARGE: u32 = 0x400;

/// SHELLEXECUTEINFOW.
#[repr(C)]
#[allow(dead_code)] // laid out for Windows, not all read here
struct ShellExecuteInfoW {
    cb_size: u32,
    f_mask: u32,
    hwnd: isize,
    lp_verb: *const u16,
    lp_file: *const u16,
    lp_parameters: *const u16,
    lp_directory: *const u16,
    n_show: i32,
    h_inst_app: isize,
    lp_id_list: *mut c_void,
    lp_class: *const u16,
    hkey_class: isize,
    dw_hot_key: u32,
    h_icon_or_monitor: isize,
    h_process: isize,
}

/// MEMORYSTATUSEX.
#[repr(C)]
#[allow(dead_code)] // laid out for Windows, not all read here
#[derive(Default)]
struct MemoryStatusEx {
    dw_length: u32,
    dw_memory_load: u32,
    ull_total_phys: u64,
    ull_avail_phys: u64,
    ull_total_page_file: u64,
    ull_avail_page_file: u64,
    ull_total_virtual: u64,
    ull_avail_virtual: u64,
    ull_avail_extended_virtual: u64,
}

/// LUID.
#[repr(C)]
#[allow(dead_code)] // laid out for Windows, not all read here
#[derive(Default, Clone, Copy)]
struct Luid {
    low: u32,
    high: i32,
}

/// TOKEN_PRIVILEGES with one LUID_AND_ATTRIBUTES.
#[repr(C)]
#[allow(dead_code)] // laid out for Windows, not all read here
struct TokenPrivileges {
    count: u32,
    luid: Luid,
    attributes: u32,
}

/// PDH_FMT_COUNTERVALUE read as PDH_FMT_LARGE.
#[repr(C)]
#[allow(dead_code)] // laid out for Windows, not all read here
#[derive(Default)]
struct PdhFmtCounterValue {
    c_status: u32,
    large_value: i64,
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtSetSystemInformation(class: u32, info: *const c_void, len: u32) -> i32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    fn GetLastError() -> u32;
    fn WaitForSingleObject(handle: isize, ms: u32) -> u32;
    fn GetExitCodeProcess(process: isize, code: *mut u32) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn LookupPrivilegeValueW(system: *const u16, name: *const u16, luid: *mut Luid) -> i32;
    fn OpenProcessToken(process: isize, access: u32, token: *mut isize) -> i32;
    fn AdjustTokenPrivileges(token: isize, disable_all: i32, new: *const TokenPrivileges, len: u32, previous: *mut TokenPrivileges, ret_len: *mut u32) -> i32;
}

#[link(name = "shell32")]
unsafe extern "system" {
    fn ShellExecuteExW(info: *mut ShellExecuteInfoW) -> i32;
}

#[link(name = "pdh")]
unsafe extern "system" {
    fn PdhOpenQueryW(source: *const u16, user_data: usize, query: *mut isize) -> u32;
    fn PdhAddEnglishCounterW(query: isize, path: *const u16, user_data: usize, counter: *mut isize) -> u32;
    fn PdhCollectQueryData(query: isize) -> u32;
    fn PdhGetFormattedCounterValue(counter: isize, format: u32, kind: *mut u32, value: *mut PdhFmtCounterValue) -> u32;
    fn PdhCloseQuery(query: isize) -> u32;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &[&str]) -> Vec<String> {
        s.iter().map(|a| a.to_string()).collect()
    }

    #[test]
    fn helper_arguments_round_trip_and_nothing_else_is_accepted() {
        let line = args_for(&[EmptyList::StandbyList, EmptyList::WorkingSets, EmptyList::StandbyList]);
        assert_eq!(line, "--altbase-empty-memory workingsets,standby", "fixed order, no repeats");
        let parts: Vec<&str> = std::iter::once("altbase.exe").chain(line.split(' ')).collect();
        assert_eq!(parse_args(&args(&parts)), Some(Ok(vec![EmptyList::WorkingSets, EmptyList::StandbyList])));
        assert_eq!(parse_args(&args(&["altbase.exe"])), None, "a normal start");
        assert_eq!(parse_args(&args(&["altbase.exe", "--other"])), None);
        assert_eq!(parse_args(&args(&["altbase.exe", ARG])), Some(Err(())), "nothing to empty");
        assert_eq!(parse_args(&args(&["altbase.exe", ARG, "standby,format-c"])), Some(Err(())));
        assert_eq!(parse_args(&args(&["altbase.exe", ARG, "standby", "extra"])), Some(Err(())));
        assert_eq!(parse_args(&args(&["altbase.exe", ARG, ""])), Some(Err(())));
    }

    #[test]
    fn pressure_trim_waits_for_the_level_and_rests_between_rounds() {
        use std::time::Duration;
        assert!(!pressure_due(0, Some(99), None), "off");
        assert!(!pressure_due(85, Some(84), None), "below the level");
        assert!(!pressure_due(85, None, None), "unknown load never trims");
        assert!(pressure_due(85, Some(85), None), "first round");
        assert!(!pressure_due(85, Some(97), Some(Duration::from_secs(60))), "resting");
        assert!(pressure_due(85, Some(97), Some(PRESSURE_REST)));
    }

    #[test]
    fn lists_split_physical_memory() {
        const MB: u64 = 1024 * 1024;
        let p = PageLists { modified: 300 * MB, standby: 4000 * MB, free: 1000 * MB };
        let m = split(16_000 * MB, 5000 * MB, &p);
        assert_eq!(m, MemoryLists { total_mb: 16_000, in_use_mb: 10_700, modified_mb: 300, standby_mb: 4000, free_mb: 1000 });
        assert_eq!(split(0, 10, &p).in_use_mb, 0, "never below zero");
    }

    #[test]
    fn struct_sizes_match_win32() {
        assert_eq!(std::mem::size_of::<ShellExecuteInfoW>(), 112);
        assert_eq!(std::mem::size_of::<MemoryStatusEx>(), 64);
        assert_eq!(std::mem::size_of::<TokenPrivileges>(), 16);
        assert_eq!(std::mem::size_of::<PdhFmtCounterValue>(), 16);
    }
}
