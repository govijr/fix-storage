<div align="center">

# fix-storage

**See what is filling your disk on macOS, Linux or Windows, find the culprit, and clear what is safe to clear, from the terminal.**

[![CI](https://github.com/govijr/fix-storage/actions/workflows/ci.yml/badge.svg)](https://github.com/govijr/fix-storage/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/govijr/fix-storage?color=4ade80)](https://github.com/govijr/fix-storage/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![macOS | Linux | Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)

<img width="3344" height="2160" alt="image" src="https://github.com/user-attachments/assets/bbd9ade2-e996-4e2f-9979-ff73b57738f1" />

</div>

```bash
curl -fsSL https://raw.githubusercontent.com/govijr/fix-storage/main/install.sh | sh
```

On Windows:

```powershell
npm install -g https://github.com/govijr/fix-storage/releases/latest/download/fix-storage.tgz
```

---

## Why

"System Data: 86 GB" and a full disk warning don't tell you what to do. fix-storage measures your disk the way Finder's Storage panel does, then goes further:

- **Finds the culprit.** Under every big folder it prints where the space actually is, following the biggest subfolder down: `└ mostly in app/node_modules/  31.2 GB · 77%  junk`. Press `g` to jump straight there.
- **Labels everything.** Each item is tagged `junk`, `unused`, `system` or left as yours, with a one-line reason: *rebuilds with npm install · not touched in 7 months*, *installer · not needed once installed*, *screen capture from 3 weeks ago*.
- **Shows when you last used it.** Last-opened dates come from Spotlight (on Linux and Windows, from file access times), so an app you haven't opened in two years stands out.
- **Every drive, dual boot included (Linux and Windows).** Each drive gets its own scan; a Windows partition or another Linux install is shown look only, with labels that say what to do about it from that system.
- **Clears safely.** Caches and the Trash (the Recycle Bin on Windows) are cleared for good; everything else goes to the Trash so you can get it back. Nothing is removed without a second keypress.
- **Feels like a terminal tool.** One monospace font, keyboard first, mouse optional, with a live dot-matrix disk meter drawn in real pixels.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/govijr/fix-storage/main/install.sh | sh
```

The installer puts the app in `~/.fix-storage` and links the `fix-storage` command into `~/.local/bin`. It needs no `sudo`.

On Windows, install it with npm, from PowerShell or any terminal. It needs no administrator:

```powershell
npm install -g https://github.com/govijr/fix-storage/releases/latest/download/fix-storage.tgz
```

**Requirements**

- macOS (Apple silicon or Intel), Linux (x86_64 or arm64), or Windows 10 or 11 (x64 or arm64)
- Node.js 20.11 or newer (`brew install node`, your distribution's `nodejs` and `npm` packages, or `winget install OpenJS.NodeJS.LTS`)
- On Linux: `unzip`, used once to unpack the graphics runtime. The runtime is Electron-based, so it needs the libraries any desktop already has; on a bare server use `--plain`.
- For the graphical view: a terminal with the kitty graphics protocol, such as [Ghostty](https://ghostty.org), [kitty](https://sw.kovidgoyal.net/kitty/), [WezTerm](https://wezfurlong.org/wezterm/) or iTerm2. Other terminals get a character-only view.
- On Windows, `fix-storage` prints the text summary for now (see [Windows](#windows)); any terminal works.

<details>
<summary>Other install options</summary>

```bash
# A specific version
curl -fsSL https://raw.githubusercontent.com/govijr/fix-storage/main/install.sh | sh -s -- --version 0.2.0

# Somewhere else
curl -fsSL https://raw.githubusercontent.com/govijr/fix-storage/main/install.sh | FIX_STORAGE_HOME=~/apps/fix-storage FIX_STORAGE_BIN=~/bin sh

# From source
git clone https://github.com/govijr/fix-storage && cd fix-storage
npm install && npm start
# On Linux, if npm install fails with EXDEV (a tmpfs /tmp):
mkdir -p .tmp && TMPDIR=$PWD/.tmp npm install
```

</details>

## Usage

```bash
fix-storage              # scan your disk and open the interactive view
fix-storage --dry-run    # same, but deleting only pretends
fix-storage --demo       # a made-up disk, to try the interface; reads and deletes nothing
fix-storage --plain      # print a text summary and exit
fix-storage --json       # print the summary as JSON and exit

# Linux and Windows
fix-storage --drives             # list the drives, and on Linux the partitions that are not mounted
fix-storage --drive /mnt/games   # start on a drive: its number, name, label, device or any path on it
fix-storage --drive d            # on Windows, a drive letter works too
fix-storage --plain --drive 2    # text summary of the second drive
```

> [!TIP]
> On macOS, give your terminal **Full Disk Access** (System Settings → Privacy & Security → Full Disk Access) so the scan can read Mail, Messages, Safari and other protected folders. Without it, those folders are counted under *System data*.
>
> On Linux, run it as yourself, not with `sudo`. Folders only root can read (Docker's images, `/root`) are counted under *System data*.
>
> On Windows, run it as yourself, not as administrator. Folders Windows keeps to itself (`WindowsApps`, other accounts) are counted under *System data*.

### Keys

| Key | In the category list | In a folder |
| --- | --- | --- |
| `↑` `↓` / `j` `k` | pick a category | move |
| `→` / `Enter` | look inside | open the folder |
| `←` / `Esc` | | go up a level |
| `g` | | jump to the culprit |
| `f` | show only junk and unused | show only junk and unused |
| `o` / `Space` | | reveal in Finder, or in the file manager on Linux |
| `⌫` / `d` | | move to Trash, or delete for caches and Trash (press twice) |
| `c` | clear all caches / empty the Trash (press twice) | |
| `v` / `1`–`9` | next drive / that drive (Linux) | next drive / that drive (Linux) |
| `Tab` | switch panes | switch panes |
| `r` / `q` | rescan / quit | rescan / quit |

Everything is clickable too: categories, the disk meter, rows, the breadcrumb, the drive names and every action.

## Linux, drives and dual boot

On Linux, fix-storage reads the mount table and treats each filesystem as one drive, however many times it is mounted. A bind-mounted `/home` or a set of btrfs subvolumes is measured once, and a drive mounted inside a folder of another (say `~/games`) counts only on its own drive. The drive holding your home folder opens first; `v` cycles through the rest.

| Drive | What you see | Can it remove things? |
| --- | --- | --- |
| Your home and system drives | The usual categories, mapped to Linux: Flatpak, Snap, `/opt`, `~/.local/share` and `~/.config` under Apps; your XDG folders under Photos, Videos, Music and Documents; `~/.cache` under Caches; the freedesktop.org trash. System data lists `/usr`, package caches, the journal, crash dumps and swap, each labelled with the command that shrinks it, like `sudo paccache -rk1` or `sudo journalctl --vacuum-size=500M`. | Yes, the same rules as on macOS. |
| Other drives | Everything on the drive, sorted into Photos, Videos, Music and Apps (Steam libraries) by folder name, the rest under Documents. Active swap files count as System data. | Yes. Moved items go to that drive's own `.Trash-$UID`, like a file manager does. |
| A Windows partition | Windows, `Program Files`, each user's `AppData`, `Downloads` and so on, with labels for `hiberfil.sys`, `pagefile.sys`, `WinSxS`, `Windows.old` and Windows Update downloads. | No, look only. Clean it up from Windows. |
| Another Linux install, or a boot/EFI partition | What is on it. | No, look only. |

Partitions that are not mounted, such as the Windows side of a dual boot, are listed by `fix-storage --drives` with the command that mounts them read-only (`udisksctl mount -b /dev/… -o ro`). If an NTFS partition comes up read-only, Windows is probably hibernated by Fast Startup; shut Windows down fully before writing to it from Linux.

## Windows

fix-storage scans each local drive, `C:` first, and leaves out network drives. Sizes are shown the way File Explorer shows them, so a 1 TB drive is `952 GB` and paths read `~\AppData\Local\…`.

| Drive | What you see | Can it remove things? |
| --- | --- | --- |
| The Windows drive | Apps: `Program Files`, Store apps, `AppData`. Developer: WSL and Docker disks, Android SDKs, Visual Studio, tool folders in your home. Photos, Videos, Music and Documents from the folders Windows says they are, so a Documents folder moved to OneDrive is still found. Caches: `AppData\Local\Temp`, npm, pip, NuGet, browser and graphics caches. Your Recycle Bin, by the names things had before they were deleted. System data lists Windows, `Windows.old`, the page and hibernation files and crash dumps, each labelled with how to shrink it (Disk Cleanup, Settings › System › Storage, `powercfg /h off`). | Yes, the same rules as on macOS. |
| Other drives | Everything on the drive, sorted into Photos, Videos, Music and Apps (Steam libraries) by folder name, the rest under Documents. | Yes. Moved items go to that drive's own Recycle Bin. |
| USB drives and memory cards | What is on it. | No, look only: Windows keeps no Recycle Bin on them, so anything removed would be gone for good. |
| Another copy of Windows | What is on it. | No, look only. Clean it up from that Windows. |

Folder sizes come from Windows' own directory listings rather than opening every file, which keeps a full scan of `C:` to well under a minute.

The interactive view, where things are removed, is not on Windows yet: the graphics runtime it uses has no Windows build. Until it is, `fix-storage` prints the summary, and `--plain`, `--json`, `--drives` and `--demo` work as everywhere else. The removal rules above are already in place for it.

## How it decides

### Labels

| Label | Meaning | Examples |
| --- | --- | --- |
| `junk` | Rebuilds by itself or is a leftover. Removing it loses nothing. | `node_modules`, `.next`, `__pycache__`, `.vs`, Pods, Xcode DerivedData, iOS DeviceSupport, `.dmg`/`.pkg`/`.deb`/`.rpm`/`.msi`/`.msix` installers, setup `.exe` files in Downloads, Steam shader caches, caches, the Trash |
| `unused` | Probably not needed, but your call. | build output (including .NET's `obj`), `.venv`, old simulators, Xcode archives, iPhone backups, archives in Downloads, screen recordings older than two weeks, anything not opened in a year |
| `system` | A tool manages it; removing it by hand breaks the tool. The reason says which command to use instead. | Docker's disk image, WSL's Linux disks, Ollama models, Homebrew, Flatpak, Snap, packages under `/usr` and `/opt` |
| *(none)* | Yours and in use. | everything else |

The rules live in [`src/core/classify.ts`](src/core/classify.ts). They are deliberately conservative; pull requests with new patterns are very welcome.

### Culprits

For a folder, fix-storage runs one `du` pass over it, then follows the biggest child down for as long as that child holds more than half of its parent. It stops at things that are one unit to you, like `node_modules`, `.app` bundles or a Photos library, and ends at a single file if one file is most of the folder. When no one thing dominates, it shows the three biggest instead. Sizes measured along the way are reused, so opening those folders afterwards is instant.

### What it will and won't remove

- **Caches and Trash** items are deleted for good. Apps rebuild caches when they need them.
- **Everything else** is moved to the Trash (with macOS's own `trash` command, or Finder on older systems; on Linux, the freedesktop.org trash your file manager uses; on Windows, the Recycle Bin, the way Explorer's Delete does), so you can drag it back out. The space comes back once you empty the Trash. If Windows would delete something for good instead of recycling it, it asks first, and saying no keeps it.
- **Never removed:** System data, anything under `/System` or `/private`, your Keychains, Preferences, Mail, Messages, Photos and Safari data, the top-level folders the scan measures, and anything outside them.
- **Never removed on Linux:** anything under `/usr`, `/etc`, `/var`, `/opt`, `/boot` and the other system folders, Flatpak's own folders, active swap files, `~/.ssh`, `~/.gnupg`, your keyrings and browser profiles, and anything on a Windows partition, another Linux install or a boot partition.
- **Never removed on Windows:** anything inside `Windows`, `WindowsApps`, `ProgramData\Microsoft`, `Windows.old` or the restore points; installed programs (uninstall them in Settings › Apps); where Windows keeps your passwords and keys (`Credentials`, `Protect`, `Vault`, `~\.ssh`); `NTUSER.DAT`, `AppData` itself and browser profiles; and anything on a network drive, a USB drive or another copy of Windows.
- `--dry-run` and `--demo` never touch the disk.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/govijr/fix-storage/main/install.sh | sh -s -- --uninstall
```

On Windows:

```powershell
npm uninstall -g fix-storage
```

## Development

```bash
git clone https://github.com/govijr/fix-storage && cd fix-storage
npm install
npm run demo        # build and open the demo disk
npm run typecheck
```

The interface is React rendered by [pixel](https://www.npmjs.com/package/@zenbu-labs/pixel), which draws real pixels into terminals that support the kitty graphics protocol. pixel has no Windows build, so there `npm install` skips it and only the text modes run; `npm run plain -- --demo` there shows a made-up Windows disk.

```
src/
  main.tsx          entry point and key handling
  plain.ts          --plain / --json / --drives output
  core/
    scan.ts         measures a drive with du
    categories.ts   the categories, and which folders count toward them on macOS
    layout.ts       which folders count toward which category on each Linux and Windows drive
    drives.ts       mounted drives and unmounted partitions (Linux), drive letters (Windows)
    platform.ts     the few things that differ between macOS, Linux and Windows
    windows.ts      drive letters, known folders and the Recycle Bin (Windows)
    windu-server.ts du for Windows, from directory listings
    windu.ts        du for Windows in plain Node, where the fast one cannot run
    classify.ts     junk / unused / system labels and their reasons
    browse.ts       folder listing, culprits, last-used dates, reveal, trash
    trash.ts        the freedesktop.org trash (Linux)
    clean.ts        clearing a whole category
    demo.ts         the made-up demo disks
  ui/
    app.tsx         the interface
    bar.ts          the dot-matrix disk meter
    store.ts        app state and actions
    runtime.ts      what the interface uses of pixel
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes and cut a release.

## License

[MIT](LICENSE)
