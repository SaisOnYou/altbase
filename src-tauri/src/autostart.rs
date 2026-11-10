//! Start with Windows: Altbase's own line in the user's Run key
//! (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), which Windows reads at sign-in. Per user,
//! no admin rights, and Task Manager's Startup tab lists it, where it can be turned off too. The
//! registry is the one place it is kept: nothing in Settings can disagree with it.

use std::ffi::c_void;

use windows::Win32::System::Registry::HKEY_CURRENT_USER;

use crate::error::{AppError, Result};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE: &str = "Altbase";
const REG_SZ: u32 = 1;
const ERROR_FILE_NOT_FOUND: i32 = 2;
/// HKEY_CURRENT_USER as the raw handle the hand-declared calls take.
const HKCU: isize = 0x8000_0001u32 as i32 as isize;

#[link(name = "advapi32")]
unsafe extern "system" {
    fn RegSetKeyValueW(key: isize, subkey: *const u16, value: *const u16, kind: u32, data: *const c_void, len: u32) -> i32;
    fn RegDeleteKeyValueW(key: isize, subkey: *const u16, value: *const u16) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The Run line for `exe` (pure): quoted, so a path with spaces starts the right program.
fn run_line(exe: &str) -> String {
    format!("\"{exe}\"")
}

/// Whether a Run line starts `exe` (pure): the same path, whatever its case or quotes.
fn starts(line: &str, exe: &str) -> bool {
    line.trim().trim_matches('"').eq_ignore_ascii_case(exe)
}

/// Whether Windows starts this Altbase at sign-in. A line left by a copy installed elsewhere
/// doesn't count: turning it on again repoints it here.
pub fn enabled() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    crate::launcher::client::reg_string(HKEY_CURRENT_USER, RUN_KEY, Some(VALUE)).is_some_and(|line| starts(&line, &exe.to_string_lossy()))
}

/// Adds or removes the Run line.
pub fn set(on: bool) -> Result<()> {
    let (key, value) = (wide(RUN_KEY), wide(VALUE));
    let status = if on {
        let exe = std::env::current_exe().map_err(|e| AppError::Internal(e.to_string()))?;
        let line = wide(&run_line(&exe.to_string_lossy()));
        // SAFETY: the strings are NUL-terminated and outlive the call; `len` is `line` in bytes.
        unsafe { RegSetKeyValueW(HKCU, key.as_ptr(), value.as_ptr(), REG_SZ, line.as_ptr().cast(), (line.len() * 2) as u32) }
    } else {
        // SAFETY: the strings are NUL-terminated and outlive the call.
        match unsafe { RegDeleteKeyValueW(HKCU, key.as_ptr(), value.as_ptr()) } {
            ERROR_FILE_NOT_FOUND => 0,
            other => other,
        }
    };
    if status != 0 {
        log::warn!("autostart: registry error {status}");
        return Err(AppError::Internal(tr!("Windows didn't change the startup setting (error {code}).", code = status)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_line_round_trips_and_ignores_case() {
        let exe = r"C:\Users\Sam Lee\AppData\Local\Altbase\altbase.exe";
        assert_eq!(run_line(exe), "\"C:\\Users\\Sam Lee\\AppData\\Local\\Altbase\\altbase.exe\"");
        assert!(starts(&run_line(exe), exe));
        assert!(starts(&run_line(&exe.to_uppercase()), exe));
        assert!(!starts("\"C:\\Other\\altbase.exe\"", exe));
        assert!(!starts("", exe));
    }

    #[test]
    fn hkcu_is_the_predefined_handle() {
        assert_eq!(HKCU as u64, 0xFFFF_FFFF_8000_0001);
    }
}
