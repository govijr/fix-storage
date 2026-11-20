import { execFile, spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Drive } from "./drives";

/**
 * What only Windows has: drive letters, the folders Windows says Documents and
 * Downloads are (OneDrive often moves them), and the Recycle Bin.
 */

function output(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((done, fail) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1 << 22, env: env ?? process.env }, (error, stdout, stderr) => {
      if (error) fail(new Error(stderr.trim() || error.message));
      else done(stdout);
    });
  });
}

const powershell = (script: string, env?: NodeJS.ProcessEnv) =>
  output("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], env);

/** Runs once and remembers the answer. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= make());
}

// ---- drives ---------------------------------------------------------------

interface LogicalDisk {
  DeviceID: string;
  DriveType: number;
  VolumeName: string | null;
  FileSystem: string | null;
}

/** Local disks and USB drives. Network drives and disc drives are left out: slow, and they have no Recycle Bin. */
const LOCAL = new Set([2, 3]);

const exists = (path: string) =>
  fsp.access(path).then(
    () => true,
    () => false,
  );

/** Drive letters with a filesystem on them, the system drive first. */
export async function windowsDrives(home: string = homedir()): Promise<Drive[]> {
  const systemDrive = (process.env.SystemDrive ?? "C:").toUpperCase();
  let disks: LogicalDisk[];
  try {
    const json = await powershell(
      "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName,FileSystem | ConvertTo-Json -Compress",
    );
    const parsed = JSON.parse(json) as LogicalDisk | LogicalDisk[];
    disks = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // No PowerShell or WMI: the system drive is still there.
    disks = [{ DeviceID: systemDrive, DriveType: 3, VolumeName: "", FileSystem: "NTFS" }];
  }

  const homeDrive = home.slice(0, 2).toUpperCase();
  const drives: Drive[] = [];
  for (const disk of disks) {
    const id = disk.DeviceID.toUpperCase();
    if (!LOCAL.has(disk.DriveType) || !disk.FileSystem) continue;
    const mount = `${id}\\`;
    // A locked BitLocker drive or an empty card reader cannot be measured.
    try {
      await fsp.statfs(mount);
    } catch {
      continue;
    }
    const isSystem = id === systemDrive;
    const isHome = id === homeDrive;
    // Another copy of Windows (an old install, a second disk) is look only, like a dual boot.
    const otherWindows = !isSystem && (await exists(join(mount, "Windows", "System32")));
    const label = disk.VolumeName ?? "";
    drives.push({
      id,
      name: `${label || "Local Disk"} (${id})`,
      mount,
      mounts: [],
      // The letter is already in the name and the mount.
      device: "",
      fstype: disk.FileSystem.toLowerCase(),
      label,
      readOnly: false,
      kind: isSystem || isHome ? "main" : otherWindows ? "windows" : "data",
      home: isHome,
      system: isSystem,
      removable: disk.DriveType === 2,
    });
  }
  return drives.sort((a, b) => Number(b.system) - Number(a.system) || a.id.localeCompare(b.id));
}

/** The drive a path is on, from its letter: "d:\\games" is on D:. */
export function driveLetter(path: string): string | null {
  const match = /^([a-z]):/i.exec(path);
  return match ? `${match[1].toUpperCase()}:` : null;
}

// ---- known folders ----------------------------------------------------------

export interface KnownFolders {
  documents: string;
  desktop: string;
  downloads: string;
  pictures: string;
  videos: string;
  music: string;
  roaming: string;
  local: string;
}

/** Registry names of the folders, the same in every language of Windows. */
const SHELL_FOLDERS: Record<keyof KnownFolders, string> = {
  documents: "Personal",
  desktop: "Desktop",
  downloads: "{374DE290-123F-4565-9164-39C4925E467B}",
  pictures: "My Pictures",
  videos: "My Video",
  music: "My Music",
  roaming: "AppData",
  local: "Local AppData",
};

/** Expands %USERPROFILE% and the like, as Windows does for these registry values. */
const expand = (value: string) => value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);

/**
 * Where Windows keeps each folder. OneDrive and folder redirection move
 * Documents, Desktop and Pictures, so they are looked up, not assumed.
 */
export const knownFolders = once(async (): Promise<KnownFolders> => {
  const home = homedir();
  const folders: KnownFolders = {
    documents: join(home, "Documents"),
    desktop: join(home, "Desktop"),
    downloads: join(home, "Downloads"),
    pictures: join(home, "Pictures"),
    videos: join(home, "Videos"),
    music: join(home, "Music"),
    roaming: process.env.APPDATA ?? join(home, "AppData", "Roaming"),
    local: process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
  };
  let text = "";
  try {
    text = await output("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders"]);
  } catch {
    return folders;
  }
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line);
    if (match) values.set(match[1].toLowerCase(), expand(match[2]));
  }
  for (const key of Object.keys(SHELL_FOLDERS) as Array<keyof KnownFolders>) {
    const value = values.get(SHELL_FOLDERS[key].toLowerCase());
    if (value && /^[a-z]:\\/i.test(value)) folders[key] = value.replace(/\\+$/, "");
  }
  return folders;
});

// ---- the Recycle Bin --------------------------------------------------------

/** This account's security identifier, which names its folder in each drive's Recycle Bin. */
export const userSid = once(async (): Promise<string | null> => {
  try {
    return /S-1-5-[\d-]+/.exec(await output("whoami.exe", ["/user"]))?.[0] ?? null;
  } catch {
    return null;
  }
});

/** This account's Recycle Bin on a drive: <drive>\$Recycle.Bin\<sid>. */
export function recycleBin(mount: string, sid: string): string {
  return join(mount, "$Recycle.Bin", sid);
}

/** True for a file or folder Windows keeps in the Recycle Bin: the $R... that holds it. */
export const isRecycled = (path: string) => /^\$R/i.test(basename(path)) && /^\$recycle\.bin$/i.test(basename(dirname(dirname(path))));

/** The $I... record next to a recycled item, which says where it came from. */
const recordOf = (path: string) => join(dirname(path), "$I" + basename(path).slice(2));

/**
 * Where a recycled item was before it was deleted, read from its $I record:
 * a version, the size, the deletion time, then the original path in UTF-16.
 */
export async function originalPath(path: string): Promise<string | null> {
  try {
    const record = await fsp.readFile(recordOf(path));
    if (record.length < 28) return null;
    const version = Number(record.readBigUInt64LE(0));
    if (version === 2) {
      const chars = record.readUInt32LE(24);
      return record.toString("utf16le", 28, 28 + Math.max(0, chars - 1) * 2);
    }
    // Version 1 (Windows Vista to 8): a fixed 260-character field.
    return record.toString("utf16le", 24, 24 + 520).replace(/\0[\s\S]*$/, "");
  } catch {
    return null;
  }
}

/** After a recycled item is deleted for good, its $I record goes too, so Explorer stops listing it. */
export async function forgetRecord(path: string): Promise<void> {
  if (!isRecycled(path)) return;
  await fsp.unlink(recordOf(path)).catch(() => {});
}

/**
 * Moves a file or folder to the Recycle Bin through the Windows shell, the way
 * Explorer's Delete does. FOF_WANTNUKEWARNING makes Windows ask before it
 * deletes something for good instead: an item too big for the Recycle Bin, or
 * on a drive without one. Saying no there leaves the item where it was.
 */
const RECYCLE = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FixStorageRecycle {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SHFILEOPSTRUCT {
    public IntPtr hwnd; public uint wFunc; public string pFrom; public string pTo;
    public ushort fFlags; public bool fAnyOperationsAborted; public IntPtr hNameMappings; public string lpszProgressTitle;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHFileOperation(ref SHFILEOPSTRUCT op);
  public static string Recycle(string path) {
    // FO_DELETE with FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING | FOF_NOERRORUI | FOF_SILENT
    var op = new SHFILEOPSTRUCT { wFunc = 3, pFrom = path + "\\0\\0", fFlags = 0x0040 | 0x0010 | 0x4000 | 0x0400 | 0x0004 };
    int code = SHFileOperation(ref op);
    if (op.fAnyOperationsAborted) return "aborted";
    return code == 0 ? "ok" : "error " + code;
  }
}
'@
[FixStorageRecycle]::Recycle($env:FIX_STORAGE_TARGET)
`;

export async function recycle(path: string): Promise<void> {
  // The path goes in through the environment, so no quoting can change what is deleted.
  const result = (await powershell(RECYCLE, { ...process.env, FIX_STORAGE_TARGET: path })).trim();
  if (result === "aborted") throw new Error("kept it: windows would have deleted it for good instead of recycling it");
  if (result !== "ok") throw new Error(`windows could not recycle it (${result})`);
  // The shell reports success for a path that is already gone; make sure it really moved.
  if (await exists(path)) throw new Error("it is still there; it may be open in another app");
}

// ---- the console ----------------------------------------------------------------

const MOUSE_INPUT = `$ErrorActionPreference = 'Stop'
$console = Add-Type -PassThru -Name Console -Namespace FixStorage -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr handle, out uint mode);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr handle, uint mode);
'@
# The console this process shares with fix-storage: read and write (written in
# decimal, as PowerShell reads 0xC0000000 as a negative number), shared, open existing.
$handle = $console::CreateFileW('CONIN$', 3221225472, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
$mode = 0
# ENABLE_VIRTUAL_TERMINAL_INPUT
if ($console::GetConsoleMode($handle, [ref]$mode)) { [void]$console::SetConsoleMode($handle, $mode -bor 0x200) }
`;

/**
 * Lets mouse clicks and the wheel reach fix-storage. Node reads the Windows
 * console as key presses only, and Windows Terminal sends its mouse reports
 * only to a console in virtual terminal input mode, so a helper attached to
 * the same console switches that on. Call it after raw mode is on; turning raw
 * mode off sets the console back the way Node found it. `done` runs once the
 * helper has finished, whether it worked or not.
 */
export function enableMouseInput(done: () => void): void {
  try {
    const encoded = Buffer.from(MOUSE_INPUT, "utf16le").toString("base64");
    // Not windowsHide: that starts the helper on a hidden console of its own, and
    // it would change that console instead of this one. Sharing a console opens no window.
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { stdio: "ignore" })
      .on("error", done)
      .on("exit", done)
      .unref();
  } catch {
    // No PowerShell: the keyboard still does everything.
    done();
  }
}
