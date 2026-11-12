//! The status console: a plain console window beside Altbase showing the farm as text (which
//! accounts are online, what they're playing, what's down) for a second screen or a glance.
//!
//! It is a second copy of Altbase started with `--altbase-console <file> <pid>`: that copy opens
//! its own console, redraws `<file>` (text with colours, written by the UI through
//! `console_write`) once a second, and exits when Altbase (`<pid>`) does. Being its own process,
//! closing the console's window ends only the console, never Altbase. While it is open Altbase
//! emits `console://tick` every 2 s: an event reaches the UI even when its window is minimized,
//! where the web view's own timers slow to a crawl.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter};

use crate::error::{AppError, Result};

const ARG: &str = "--altbase-console";
/// The text the console shows, in the data folder.
pub const FILE: &str = "console.txt";
/// Most text the UI may hand over (a few hundred accounts fit easily).
pub const MAX_TEXT: usize = 256 * 1024;
/// After this long without new text the console says it's waiting (Altbase hidden or busy).
const STALE: Duration = Duration::from_secs(20);
/// How often the UI is asked for new text.
const TICK: Duration = Duration::from_secs(2);

const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
const ENABLE_PROCESSED_OUTPUT: u32 = 0x0001;
const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
const STILL_ACTIVE: u32 = 259;
const CP_UTF8: u32 = 65001;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn AllocConsole() -> i32;
    fn GetStdHandle(which: u32) -> isize;
    fn GetConsoleMode(handle: isize, mode: *mut u32) -> i32;
    fn SetConsoleMode(handle: isize, mode: u32) -> i32;
    fn SetConsoleTitleW(title: *const u16) -> i32;
    fn SetConsoleOutputCP(page: u32) -> i32;
    fn WriteConsoleW(handle: isize, text: *const u16, len: u32, written: *mut u32, reserved: *const c_void) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
    fn GetExitCodeProcess(process: isize, code: *mut u32) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}

/// The console's file and Altbase's process id, when these are the console's arguments (pure).
fn parse_args(args: &[String]) -> Option<(PathBuf, u32)> {
    match args {
        [_, flag, file, pid] if flag == ARG => Some((PathBuf::from(file), pid.parse().ok()?)),
        _ => None,
    }
}

/// One redraw (pure): from the top-left, each line cleared to its end, then the rest of the screen
/// cleared, so nothing flickers and nothing old is left below. A note when the text is stale.
fn frame(text: &str, stale_for: Option<Duration>) -> String {
    let mut out = String::with_capacity(text.len() + 256);
    out.push_str("\x1b[H");
    for line in text.lines() {
        out.push_str(line);
        out.push_str("\x1b[0m\x1b[K\r\n");
    }
    if let Some(d) = stale_for {
        out.push_str(&format!(
            "\r\n\x1b[93m  {}\x1b[0m\x1b[K\r\n",
            tr!("No update for {secs} s: Altbase may be busy or minimized.", secs = d.as_secs())
        ));
    }
    out.push_str("\x1b[J");
    out
}

/// Whether process `pid` is still running.
fn alive(pid: u32) -> bool {
    // SAFETY: a query-only handle, closed below; a null handle means it's gone (or not ours).
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle == 0 {
        return false;
    }
    let mut code = 0u32;
    // SAFETY: `handle` is valid and `code` is a writable u32.
    let ok = unsafe { GetExitCodeProcess(handle, &raw mut code) } != 0;
    // SAFETY: closing the handle opened above.
    unsafe { CloseHandle(handle) };
    ok && code == STILL_ACTIVE
}

fn write_console(out: isize, text: &str) {
    let wide: Vec<u16> = text.encode_utf16().collect();
    for chunk in wide.chunks(16 * 1024) {
        let mut written = 0u32;
        // SAFETY: `chunk` is valid for its length and `written` is a writable u32.
        unsafe { WriteConsoleW(out, chunk.as_ptr(), chunk.len() as u32, &raw mut written, std::ptr::null()) };
    }
}

/// Run first in `main`: when this process is the status console, shows it until Altbase exits and
/// returns the exit code; otherwise None and Altbase starts as usual.
pub fn console_main() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let (file, pid) = parse_args(&args)?;
    // SAFETY: plain Win32 calls on this process's own new console.
    let out = unsafe {
        AllocConsole();
        SetConsoleOutputCP(CP_UTF8);
        let title: Vec<u16> = "Altbase status".encode_utf16().chain(std::iter::once(0)).collect();
        SetConsoleTitleW(title.as_ptr());
        GetStdHandle(STD_OUTPUT_HANDLE)
    };
    if out == 0 || out == -1 {
        return Some(1);
    }
    let mut mode = 0u32;
    // SAFETY: `out` is this console's output handle and `mode` a writable u32.
    unsafe {
        GetConsoleMode(out, &raw mut mode);
        SetConsoleMode(out, mode | ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
    }
    // Clear once, hide the cursor.
    write_console(out, "\x1b[2J\x1b[?25l");
    let waiting = tr!("Waiting for Altbase…");
    while alive(pid) {
        let text = std::fs::read_to_string(&file).unwrap_or_else(|_| waiting.clone());
        let age = std::fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok());
        write_console(out, &frame(&text, age.filter(|a| *a > STALE)));
        std::thread::sleep(Duration::from_secs(1));
    }
    Some(0)
}

/// The console Altbase started, while it may still be open.
static CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// Whether the status console is open (it closes when its window is closed).
pub fn is_open() -> bool {
    let mut child = CHILD.lock().unwrap_or_else(|e| e.into_inner());
    match child.as_mut().map(Child::try_wait) {
        Some(Ok(None)) => true,
        Some(_) => {
            *child = None;
            false
        }
        None => false,
    }
}

/// Opens the status console, unless it's open already, and asks the UI for its text every
/// [`TICK`] until it closes.
pub fn open(app: &AppHandle, data_dir: &Path) -> Result<()> {
    if is_open() {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| AppError::Internal(e.to_string()))?;
    let file = data_dir.join(FILE);
    let child = Command::new(exe).arg(ARG).arg(&file).arg(std::process::id().to_string()).spawn()?;
    *CHILD.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    let app = app.clone();
    std::thread::spawn(move || {
        while is_open() {
            let _ = app.emit("console://tick", ());
            std::thread::sleep(TICK);
        }
    });
    Ok(())
}

/// Closes the status console, if open, and removes its text.
pub fn close(data_dir: &Path) {
    if let Some(mut child) = CHILD.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = std::fs::remove_file(data_dir.join(FILE));
}

/// Hands the console new text: written beside it and renamed over it, so the console never reads
/// half of it.
pub fn write(data_dir: &Path, text: &str) -> Result<()> {
    if text.len() > MAX_TEXT {
        return Err(AppError::Internal("status text too long".into()));
    }
    let file = data_dir.join(FILE);
    let next = data_dir.join(format!("{FILE}.next"));
    std::fs::write(&next, text)?;
    std::fs::rename(&next, &file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn only_its_own_arguments_start_the_console() {
        assert_eq!(parse_args(&args(&["altbase.exe", ARG, r"C:\data\console.txt", "4242"])), Some((PathBuf::from(r"C:\data\console.txt"), 4242)));
        assert_eq!(parse_args(&args(&["altbase.exe"])), None, "a normal start");
        assert_eq!(parse_args(&args(&["altbase.exe", ARG, "f"])), None, "no pid");
        assert_eq!(parse_args(&args(&["altbase.exe", ARG, "f", "abc"])), None, "a pid that isn't a number");
        assert_eq!(parse_args(&args(&["altbase.exe", "--altbase-empty-memory", "f", "1"])), None);
    }

    #[test]
    fn a_frame_redraws_in_place_and_says_when_it_is_stale() {
        let f = frame("one\ntwo", None);
        assert!(f.starts_with("\x1b[H"), "from the top-left, no full clear");
        assert!(f.contains("one\x1b[0m\x1b[K\r\ntwo\x1b[0m\x1b[K\r\n"), "each line cleared to its end");
        assert!(f.ends_with("\x1b[J"), "the rest cleared");
        assert!(!f.contains("No update"));
        assert!(frame("x", Some(Duration::from_secs(42))).contains("42"));
    }
}
