//! The startup greeting: "Claude, all the way, baby!" in a female voice, recorded once with the
//! open-source Kokoro text-to-speech model (voice af_heart, Apache-2.0) and built into the app.
//! Played by Windows' own sound player (`PlaySoundW`, winmm), not the web view, which plays nothing
//! before the first click. Nothing is downloaded, nothing is started, nothing waits for it.

/// The recording: 16-bit PCM WAV, 24 kHz mono, about 1.7 s.
static GREETING: &[u8] = include_bytes!("../sounds/greeting.wav");

const SND_ASYNC: u32 = 0x1;
const SND_NODEFAULT: u32 = 0x2;
const SND_MEMORY: u32 = 0x4;

#[link(name = "winmm")]
unsafe extern "system" {
    fn PlaySoundW(sound: *const u16, module: isize, flags: u32) -> i32;
}

/// Says the greeting in the background; a PC with no sound device stays quiet (logged).
pub fn say_greeting() {
    // SAFETY: with SND_MEMORY the first argument is the WAV image itself; `GREETING` is static, so
    // it outlives the asynchronous playback.
    let played = unsafe { PlaySoundW(GREETING.as_ptr().cast(), 0, SND_MEMORY | SND_ASYNC | SND_NODEFAULT) };
    if played == 0 {
        log::info!("startup greeting not played (no sound device?)");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_recording_is_a_pcm_wav() {
        assert_eq!(&GREETING[..4], b"RIFF");
        assert_eq!(&GREETING[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes([GREETING[20], GREETING[21]]), 1, "PCM");
        assert_eq!(u16::from_le_bytes([GREETING[22], GREETING[23]]), 1, "mono");
        assert!(GREETING.len() < 200_000, "small enough to embed");
    }
}
