//! Anti-AFK. Roblox disconnects a player after 20 minutes without input (reason 278). Every
//! `Settings.anti_afk.interval_min` minutes, each client in a game that hasn't opted out
//! (`Instance.anti_afk`) is brought to the front for a moment, gets a real F13 press through
//! `SendInput` (by scan code, as a keyboard sends it; no game binds F13, so the character
//! doesn't move), and the window that was in front gets the focus back. One client at a time,
//! about 100 ms each. Only while nobody has touched the keyboard or mouse for 5 s
//! (`GetLastInputInfo`); otherwise it tries again 30 s later. A minimized client is restored for
//! its press (`window::unhide`) and minimized again.
//!
//! - Urgent clients: one that has gone `URGENT_MS` (17 min) without a press is close to Roblox's
//!   20-minute kick, so a short pause in the user's own typing (`URGENT_IDLE_MS`) is enough, and
//!   it is tried every 5 s, not 30 s. Without this, someone using the PC all along (playing on
//!   their main, say) never left 5 s idle and every alt got kicked.
//! - Locked Windows: the lock screen takes all input, so no key can reach a client. The round is
//!   skipped and the user is told once per lock (auto-rejoin then brings kicked clients back).
//! - A client that can't be brought to the front backs off (`BACKOFF`) instead of being retried,
//!   with focus changes, every 30 s for ever.
//!
//! Measured 2026-11-02 on minimized clients over 21 minutes: keys posted to the window
//! (WM_KEYDOWN, with or without WM_ACTIVATE) and focus without a key don't count as activity
//! and the client is kicked; a real Space or F13 does. Games with their own idle handling
//! teleport such clients back to spawn before the kick, which stops egg hatching.
//!
//! Nothing is injected into or read from the client; auto-rejoin on the 278 kick stays the
//! fallback.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::sleep;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetLastInputInfo, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_KEYUP,
    KEYEVENTF_SCANCODE, LASTINPUTINFO, MOUSEEVENTF_MOVE, MOUSEINPUT, SendInput, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow};

use super::{process, window};
use crate::App;
use crate::commands::{instances_changed, notice, now_ms};

/// No keyboard or mouse input for this long counts as the user being away.
const IDLE_MS: u32 = 5_000;
const TICK: Duration = Duration::from_secs(10);
/// After the user was active, or a client couldn't be brought to the front.
const RETRY: Duration = Duration::from_secs(30);
const BETWEEN: Duration = Duration::from_millis(100);
/// F13's set-1 scan code.
const F13: u16 = 0x64;
/// A restored client's time to draw again before it takes the focus.
const RESTORED: Duration = Duration::from_millis(300);
/// Without a press for this long a client is urgent: Roblox kicks at 20 minutes.
const URGENT_MS: i64 = 17 * 60_000;
/// An urgent client needs only this much of a pause in the user's input ...
const URGENT_IDLE_MS: u32 = 1_500;
/// ... and is tried again this soon.
const URGENT_RETRY: Duration = Duration::from_secs(5);
/// A client that couldn't be brought to the front isn't tried again for this long (ms).
const BACKOFF: i64 = 2 * 60_000;

/// A client anti-AFK may press keys in (`Tracker::afk_clients`).
#[derive(Clone, Debug, PartialEq)]
pub struct AfkClient {
    pub id: String,
    pub pid: u32,
    /// Unix ms of its last press, else of reaching the game.
    pub since: i64,
}

/// What one tick does.
#[derive(Debug, PartialEq)]
pub enum Plan {
    /// Nobody is due.
    Wait,
    /// Someone is due but the user is at the PC: again in 30 s, or 5 s when one is `urgent`.
    Retry { urgent: bool },
    /// Press a key in these clients (ids).
    Press(Vec<String>),
}

/// Which clients are due (`interval_min` since their `since`), gated on the user having been
/// idle for 5 s, or 1.5 s when one of them is urgent (pure).
pub fn plan(clients: &[AfkClient], now: i64, interval_min: u32, idle_ms: u32) -> Plan {
    let every = i64::from(interval_min) * 60_000;
    let due: Vec<&AfkClient> = clients.iter().filter(|c| now - c.since >= every).collect();
    if due.is_empty() {
        return Plan::Wait;
    }
    let urgent = due.iter().any(|c| now - c.since >= URGENT_MS);
    if idle_ms < if urgent { URGENT_IDLE_MS } else { IDLE_MS } {
        Plan::Retry { urgent }
    } else {
        Plan::Press(due.iter().map(|c| c.id.clone()).collect())
    }
}

/// Clients that couldn't be brought to the front, by id: not tried again before this Unix ms.
static BACKED_OFF: LazyLock<Mutex<HashMap<String, i64>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// The user was told this lock that anti-AFK can't press keys.
static LOCK_SAID: AtomicBool = AtomicBool::new(false);

/// Runs for the app's lifetime on its own thread (focus changes and `SendInput` block briefly).
pub fn spawn(app: AppHandle) {
    let started = std::thread::Builder::new().name("anti-afk".into()).spawn(move || {
        loop {
            sleep(tick(&app));
        }
    });
    if let Err(e) = started {
        log::warn!("anti-AFK not running: {e}");
    }
}

/// One round; how long to wait before the next.
fn tick(app: &AppHandle) -> Duration {
    let s = app.state::<App>();
    let v = match s.db.settings() {
        Ok(v) => v,
        Err(e) => {
            log::warn!("anti-AFK: could not read settings: {e}");
            return TICK;
        }
    };
    if !v.anti_afk.enabled {
        return TICK;
    }
    let now = now_ms();
    // A hung client would block this one thread, and the others would get kicked for idling.
    let mut backed_off = BACKED_OFF.lock().unwrap_or_else(|e| e.into_inner());
    backed_off.retain(|_, until| *until > now);
    let clients: Vec<_> =
        s.tracker.afk_clients().into_iter().filter(|c| !backed_off.contains_key(&c.id) && !process::hung(c.pid)).collect();
    drop(backed_off);
    let ids = match plan(&clients, now, v.anti_afk.interval_min, idle_ms()) {
        Plan::Wait => return TICK,
        Plan::Retry { urgent } => return if urgent { URGENT_RETRY } else { RETRY },
        Plan::Press(ids) => ids,
    };
    // The lock screen swallows every key: nothing to try until the user is back.
    if session_locked() {
        if !LOCK_SAID.swap(true, Ordering::Relaxed) {
            log::info!("anti-AFK: Windows is locked, no key can reach a client");
            notice(app, false, tr!("Anti-AFK can't press keys while Windows is locked. To keep clients online, let the screen turn off instead of locking it; Auto-rejoin brings back any that get kicked."));
        }
        return TICK;
    }
    LOCK_SAID.store(false, Ordering::Relaxed);
    let urgent = clients.iter().any(|c| ids.contains(&c.id) && now - c.since >= URGENT_MS);
    let mut failed = false;
    // Our own SendInput moves GetLastInputInfo too, so "the user came back" is any input newer
    // than our last injection.
    let mut ours = last_input();
    for c in clients.iter().filter(|c| ids.contains(&c.id)) {
        if last_input() != ours {
            failed = true;
            break;
        }
        let Some((hwnd, minimized)) = process::main_window(c.pid) else {
            log::debug!("anti-AFK: instance {} has no window", c.id);
            continue;
        };
        if minimized {
            window::unhide(c.pid, hwnd);
            sleep(RESTORED);
        }
        let r = press(hwnd);
        if minimized {
            window::hide(hwnd);
        }
        ours = last_input();
        match r {
            Pressed::Yes => {
                log::info!("anti-AFK: pressed F13 in instance {} (minimized: {minimized})", c.id);
                s.tracker.mark_afk(&c.id, now_ms());
            }
            Pressed::No => {
                failed = true;
                log::info!("anti-AFK: instance {} couldn't be brought to the front; again in {} min", c.id, BACKOFF / 60_000);
                BACKED_OFF.lock().unwrap_or_else(|e| e.into_inner()).insert(c.id.clone(), now_ms() + BACKOFF);
            }
            Pressed::Interrupted => {
                failed = true;
                break;
            }
        }
        sleep(BETWEEN);
    }
    instances_changed(app);
    match (failed, urgent) {
        (false, _) => TICK,
        (true, true) => URGENT_RETRY,
        (true, false) => RETRY,
    }
}

/// Whether the lock screen (or another secure desktop, like a UAC prompt) has the input: then
/// the user's desktop can't be switched to, and no key reaches a client.
fn session_locked() -> bool {
    const DESKTOP_SWITCHDESKTOP: u32 = 0x0100;
    // SAFETY: opens the input desktop with switch access only, and closes what it opened.
    unsafe {
        let desk = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
        if desk == 0 {
            return true;
        }
        let switchable = SwitchDesktop(desk) != 0;
        CloseDesktop(desk);
        !switchable
    }
}

#[link(name = "user32")]
unsafe extern "system" {
    fn OpenInputDesktop(flags: u32, inherit: i32, access: u32) -> isize;
    fn SwitchDesktop(desktop: isize) -> i32;
    fn CloseDesktop(desktop: isize) -> i32;
}

/// Tick count of the last keyboard or mouse input anywhere in the session (ours included);
/// None if it can't be read.
fn last_input() -> Option<u32> {
    let mut li = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: `li` is a local with cbSize set, as GetLastInputInfo requires.
    unsafe { GetLastInputInfo(&mut li) }.as_bool().then_some(li.dwTime)
}

/// How long since the last keyboard or mouse input anywhere in the session.
fn idle_ms() -> u32 {
    let Some(t) = last_input() else {
        log::warn!("anti-AFK: GetLastInputInfo failed: {}", std::io::Error::last_os_error());
        return 0;
    };
    // SAFETY: no arguments; the tick count wraps the same way dwTime does.
    unsafe { GetTickCount() }.wrapping_sub(t)
}

enum Pressed {
    Yes,
    /// Couldn't get or keep the focus: no key was sent.
    No,
    /// The user (or the restore) needs the round to stop.
    Interrupted,
}

/// F13 in `hwnd`, then the focus back where it was.
fn press(hwnd: HWND) -> Pressed {
    // SAFETY: reads which window is in front.
    let prev = unsafe { GetForegroundWindow() };
    if !to_front(hwnd) {
        return Pressed::No;
    }
    // Never into another window: only while the client is still the one in front.
    // SAFETY: reads which window is in front.
    let sent = unsafe { GetForegroundWindow() } == hwnd;
    // Input other than ours between F13 down and up: the user is back.
    let mut user = false;
    if sent {
        key(VIRTUAL_KEY(0), F13, KEYEVENTF_SCANCODE);
        let after_down = last_input();
        sleep(Duration::from_millis(40));
        user = last_input() != after_down;
        key(VIRTUAL_KEY(0), F13, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP);
        sleep(Duration::from_millis(40));
    }
    if !prev.is_invalid() && prev != hwnd && !to_front(prev) {
        log::warn!("anti-AFK: couldn't give the focus back to the previous window; stopping this round");
        return Pressed::Interrupted;
    }
    match (sent, user) {
        (_, true) => Pressed::Interrupted,
        (true, false) => Pressed::Yes,
        (false, false) => Pressed::No,
    }
}

/// Brings `hwnd` to the front: plainly; else attached to the input of the window in front
/// (whose thread may hand the focus over); else after a zero-movement mouse input, which makes
/// this process the last input source and so lifts Windows' foreground lock without any window
/// reacting (an ALT tap would open menus).
pub(super) fn to_front(hwnd: HWND) -> bool {
    // SAFETY: reads which window is in front.
    let front = || unsafe { GetForegroundWindow() } == hwnd;
    // SAFETY: a window-manager call on a top-level window handle; one that is gone just fails.
    if unsafe { SetForegroundWindow(hwnd) }.as_bool() && front() {
        return true;
    }
    // SAFETY: attaches this thread's input to the foreground window's thread only for these
    // calls and detaches it again; both thread ids are live (ours, the window's owner).
    unsafe {
        let fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let me = GetCurrentThreadId();
        if fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, true).as_bool() {
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            let _ = AttachThreadInput(me, fg_thread, false);
        }
    }
    if front() {
        return true;
    }
    let nudge = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, dwFlags: MOUSEEVENTF_MOVE, ..Default::default() } },
    };
    // SAFETY: one fully initialised mouse INPUT and its size, as SendInput requires.
    if unsafe { SendInput(&[nudge], size_of::<INPUT>() as i32) } == 0 {
        log::debug!("anti-AFK: mouse nudge not sent: {}", std::io::Error::last_os_error());
    }
    // SAFETY: as the first SetForegroundWindow.
    let _ = unsafe { SetForegroundWindow(hwnd) };
    front()
}

/// One key event through `SendInput`.
fn key(vk: VIRTUAL_KEY, scan: u16, flags: KEYBD_EVENT_FLAGS) {
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    };
    // SAFETY: one fully initialised keyboard INPUT and its size, as SendInput requires.
    if unsafe { SendInput(&[input], size_of::<INPUT>() as i32) } == 0 {
        log::warn!("anti-AFK: SendInput sent no key: {}", std::io::Error::last_os_error());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(id: &str, since: i64) -> AfkClient {
        AfkClient { id: id.into(), pid: 1, since }
    }

    #[test]
    fn presses_only_due_clients_while_the_user_is_away() {
        let min = 60_000;
        let clients = [client("a", 0), client("b", 4 * min), client("c", 9 * min + 1)];
        let ids = |v: &[&str]| Plan::Press(v.iter().map(|s| s.to_string()).collect());
        // Nobody due yet.
        assert_eq!(plan(&clients, 5 * min - 1, 5, 60_000), Plan::Wait);
        assert_eq!(plan(&[], 99 * min, 5, 60_000), Plan::Wait);
        // Due exactly at the interval.
        assert_eq!(plan(&clients, 5 * min, 5, 60_000), ids(&["a"]));
        assert_eq!(plan(&clients, 9 * min, 5, 5_000), ids(&["a", "b"]));
        // The user touched the keyboard or mouse within 5 s: later.
        assert_eq!(plan(&clients, 9 * min, 5, 4_999), Plan::Retry { urgent: false });
        assert_eq!(plan(&clients, 9 * min, 5, 0), Plan::Retry { urgent: false });
        // Nobody due wins over a busy user: nothing to retry.
        assert_eq!(plan(&clients, 3 * min, 5, 0), Plan::Wait);
        assert_eq!(plan(&clients, 15 * min, 1, 10_000), ids(&["a", "b", "c"]));
    }

    #[test]
    fn a_client_near_the_kick_needs_only_a_short_pause() {
        let min = 60_000;
        let clients = [client("a", 0), client("b", 10 * min)];
        // 17 minutes without a press: urgent, so 1.5 s of quiet is enough...
        assert_eq!(plan(&clients, 17 * min, 15, 1_500), Plan::Press(vec!["a".into()]));
        // ... and a busy user means trying again soon.
        assert_eq!(plan(&clients, 17 * min, 15, 1_499), Plan::Retry { urgent: true });
        // Not urgent yet: the usual 5 s.
        assert_eq!(plan(&clients, 16 * min, 15, 1_500), Plan::Retry { urgent: false });
    }
}
