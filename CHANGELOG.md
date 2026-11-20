# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Linux support (x86_64 and arm64). Categories follow Linux conventions (XDG folders, Flatpak, Snap, `~/.local/share`, `~/.config`, `~/.cache`), System data lists where it is (`/usr`, package caches, the journal, crash dumps, swap) with the command that shrinks each, and removed items go to the freedesktop.org trash, so the file manager can put them back.
- Multiple drives on Linux: every mounted drive can be scanned on its own. `v` or `1`–`9` switch drives, `--drive` picks one at start, and `--drives` lists them along with partitions that are not mounted. A drive mounted twice (a bind mount, btrfs subvolumes) is measured once, and another drive mounted inside a folder is not counted in it.
- Windows support (Windows 10 and 11) for the text modes, installed with `npm install -g`: `fix-storage` prints the summary, and `--plain`, `--json`, `--drives` and `--demo` work. Categories follow Windows: `Program Files`, Store apps and `AppData` under Apps; WSL and Docker disks under Developer; the folders Windows says Documents, Downloads and Pictures are (OneDrive included); `Temp`, npm, pip, NuGet, browser and graphics caches. The Recycle Bin lists items by the names they had. Sizes match File Explorer's, and each local drive gets its own scan, measured from Windows' directory listings (a full scan of `C:` in well under a minute). The removal rules are in place for the interactive view: items go to the Recycle Bin, USB drives are look only as they have no Recycle Bin, and Windows' own folders, installed programs, stored passwords and keys and `NTUSER.DAT` are never removed.
- The interactive view on Windows: the same interface as on macOS, drawn by fix-storage's own character renderer because the graphics runtime has no Windows build, with the disk meter in real pixels (Sixel) in Windows Terminal 1.22+ and WezTerm and as a bar of colored cells elsewhere. Keyboard and mouse both work, and removed items go to the Recycle Bin.
- Dual boot: a mounted Windows partition, another Linux install, or an EFI/boot partition is shown look only, with Windows-aware labels (`hiberfil.sys`, `pagefile.sys`, `WinSxS`, `Windows.old`, Windows Update downloads). A read-only NTFS mount says Windows may be hibernated (fast startup).

### Fixed

- The installer now checks the downloaded package against the release's published `.sha256` and stops on a mismatch.
- The installer works on Linux: it checks with `sha256sum`, needs `unzip`, and unpacks the graphics runtime on the same filesystem as the install, so a tmpfs `/tmp` no longer breaks it.

## [0.1.0] - 2026-11-14

### Added

- Interactive disk view with a live dot-matrix meter, a category list and a folder browser you can dive into at any depth.
- Culprit finder: shows which nested folder or file holds most of a folder's space; `g` jumps straight to it.
- Labels on every item (`junk`, `unused`, `system`) with a one-line reason, plus a filter (`f`) to show only junk and unused.
- Last-used ages from Spotlight's last-opened dates, falling back to modification time.
- Reveal in Finder, move to Trash, and delete for good (caches and Trash only), each behind a second keypress.
- One-step clearing of caches and emptying the Trash.
- `--dry-run`, `--demo`, `--plain` and `--json` modes.
- `curl | sh` installer with `--version` and `--uninstall`.

[Unreleased]: https://github.com/govijr/fix-storage/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/govijr/fix-storage/releases/tag/v0.1.0
