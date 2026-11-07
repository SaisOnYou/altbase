# Building Altbase

Altbase is a Windows app. There are two ways to get an installer. **Option A is the easiest**: GitHub
builds it for you and you install nothing.

## Option A: let GitHub build it (no tools on your PC)

1. Make a free GitHub account if you don't have one, then **fork** this repository (the **Fork**
   button at the top right of its page). Your fork has its own Actions.
2. In your fork, open the **Actions** tab and enable workflows if asked.
3. Pick **Build installer** on the left, then **Run workflow** → **Run workflow**.
4. It takes about 15–25 minutes. When the run shows a green tick, open it and download the
   **Altbase-Setup-1.0.2** artifact under *Artifacts*. Unzip it to get `Altbase-Setup-1.0.2.exe`.
5. Run it. SmartScreen warns because the installer isn't code-signed: *More info → Run anyway*.

To share it, send the same `Altbase-Setup-….exe`. Push a `v1.0.2`-style tag instead of running it by
hand and the installer is also attached to a draft release you can publish.

Every push also runs **CI**: the build, the Rust tests and Clippy (which treats warnings as errors).
If something breaks after you change the code, that run tells you where. The installer build doesn't
depend on CI passing.

## Option B: build on your own PC

You need, once:

| Tool | Install with |
| --- | --- |
| Visual Studio Build Tools, "Desktop development with C++" | `winget install Microsoft.VisualStudio.2022.BuildTools` then add that workload in the installer |
| Rust | `winget install Rustlang.Rustup` |
| Node.js 22 or newer | `winget install OpenJS.NodeJS.LTS` |
| Strawberry Perl (to build the encrypted database) | `winget install StrawberryPerl.StrawberryPerl` |
| Inno Setup 6.6 or newer | `winget install JRSoftware.InnoSetup` |

Clone the repository, open a new PowerShell window (so the tools are on PATH) in its folder and run:

```powershell
npm ci
cd src-tauri; cargo test; cd ..          # optional: the Rust tests
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
```

The installer lands in `dist-installer\Altbase-Setup-1.0.2.exe`. The first build takes a while
(OpenSSL and SQLCipher compile from source); later ones are much faster.

To try the app without installing: `npm run tauri dev`.
To see just the interface in a normal browser, with made-up accounts: `npm run dev`, then open
http://localhost:1420.

## Changing the name, colours or version

- **Name**: search the project for `Altbase` (UI text lives in `src/i18n/locales/*.json`, window and
  installer names in `src-tauri/tauri.conf.json` and `installer/Altbase.iss`).
- **Colours**: `src/styles/tokens.css` holds both themes; `src/styles/warm.css` sets the serif titles.
- **Version**: change it in `src-tauri/tauri.conf.json`, `package.json` and `src-tauri/Cargo.toml`
  (all three must match; the build checks).
