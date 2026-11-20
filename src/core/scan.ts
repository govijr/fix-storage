import { execFile, spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { basename, join, sep } from "node:path";
import { CATEGORIES, type CategoryId, type Root } from "./categories";
import type { Drive } from "./drives";
import type { Layout } from "./layout";
import { byOs, IS_MAC, IS_WINDOWS } from "./platform";
import { isRecycled, originalPath } from "./windows";
import { measureFolder, type DuProcess } from "./windu-server";

export interface Item {
  path: string;
  size: number;
  /** True for folders, which can be opened for a closer look. */
  dir?: boolean;
  /** Where it was before it was deleted, for an item in the Windows Recycle Bin, which renames everything to $R.... */
  origin?: string;
}

export interface ScanSnapshot {
  phase: "scanning" | "done";
  /** Capacity of the disk in bytes. */
  total: number;
  /** Free bytes, as the filesystem reports them. */
  available: number;
  /** total - available. While scanning, the sum measured so far. */
  used: number;
  sizes: Record<CategoryId, number>;
  /** Measured folders per category, largest first. */
  items: Record<CategoryId, Item[]>;
  /** Path being measured right now. */
  current: string;
  /** Folders this process may not read. */
  blocked: string[];
}

export interface ScanHandle {
  cancel(): void;
  done: Promise<ScanSnapshot>;
}

export function emptyRecord<T>(make: () => T): Record<CategoryId, T> {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, make()])) as Record<CategoryId, T>;
}

export function emptySnapshot(): ScanSnapshot {
  return {
    phase: "scanning",
    total: 0,
    available: 0,
    used: 0,
    sizes: emptyRecord(() => 0),
    items: emptyRecord<Item[]>(() => []),
    current: "",
    blocked: [],
  };
}

export interface Space {
  total: number;
  /** Free bytes this account can use. */
  available: number;
  /** Bytes in use. On Linux this leaves out the blocks reserved for root, the way df counts. */
  used: number;
}

export async function diskSpace(drive?: Drive): Promise<Space> {
  const paths = IS_MAC || !drive ? ["/System/Volumes/Data", "/"] : [drive.mount];
  for (const path of paths) {
    try {
      const s = await fsp.statfs(path);
      const total = s.blocks * s.bsize;
      const available = s.bavail * s.bsize;
      return { total, available, used: byOs({ mac: total - available, linux: (s.blocks - s.bfree) * s.bsize, windows: (s.blocks - s.bfree) * s.bsize }) };
    } catch {
      // try the next one
    }
  }
  return { total: 0, available: 0, used: 0 };
}

function denied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EACCES";
}

const STALL_CHECK_MS = 5000;

interface DuResult {
  bytes: number;
  denied: boolean;
}

/**
 * Starts du on a folder with these options ("-s", or "-d <n>"): the system's
 * own, or on Windows, which has none, fix-storage's: the fast one in
 * windu-server.ts, or windu.js where that cannot run. They all print the same.
 */
export async function startDu(options: string[], path: string): Promise<DuProcess> {
  if (IS_WINDOWS) {
    const fast = await measureFolder(path, options[0] === "-d" ? Number(options[1]) : 0);
    if (fast) return fast;
  }
  const [file, args] = IS_WINDOWS ? [process.execPath, [join(__dirname, "windu.js"), ...options, path]] : ["du", ["-k", "-x", ...options, path]];
  return spawn(file, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) as unknown as DuProcess;
}

/** Disk usage of one folder via du, which is far faster than walking it in JS. */
export async function du(path: string, children: Set<DuProcess>): Promise<DuResult> {
  const child = await startDu(["-s"], path);
  return new Promise((resolve) => {
    children.add(child);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => {
      if (err.length < 4096) err += chunk;
    });
    // A folder guarded by a macOS privacy prompt (Music, TV, Photos) makes du
    // wait for an answer that may never come. A du that has used no CPU time
    // between two checks is waiting like that: give up on it and report the
    // folder as unreadable. Linux has no such prompts, and its ps counts CPU
    // time in whole seconds, so a du busy reading a slow disk would look stuck.
    let stalled = false;
    let lastCpu = "";
    const check = () => {
      if (child.pid === undefined) return;
      execFile("ps", ["-o", "cputime=", "-p", String(child.pid)], (error, stdout) => {
        const cpu = stdout.trim();
        if (error || cpu === "") return;
        if (cpu === lastCpu) {
          stalled = true;
          child.kill();
        }
        lastCpu = cpu;
      });
    };
    const watchdog = IS_MAC ? setInterval(check, STALL_CHECK_MS) : undefined;

    const finish = () => {
      clearInterval(watchdog);
      children.delete(child);
      const kb = Number.parseInt(out, 10);
      resolve({
        bytes: Number.isFinite(kb) ? kb * 1024 : 0,
        denied: stalled || /not permitted|Permission denied/.test(err),
      });
    };
    child.on("error", finish);
    child.on("close", finish);
  });
}

interface Unit {
  path: string;
  category: CategoryId;
}

export interface ScanOptions {
  /** How many folders to measure at once. */
  concurrency?: number;
  /** Minimum milliseconds between onUpdate calls. */
  throttleMs?: number;
}

export function startScan(layout: Layout, onUpdate: (snapshot: ScanSnapshot) => void, options: ScanOptions = {}): ScanHandle {
  const concurrency = options.concurrency ?? 6;
  const throttleMs = options.throttleMs ?? 40;

  const snap = emptySnapshot();
  const children = new Set<DuProcess>();
  let cancelled = false;
  let lastEmit = 0;

  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < throttleMs) return;
    lastEmit = now;
    onUpdate({ ...snap, sizes: { ...snap.sizes } });
  };

  const add = (category: CategoryId, bytes: number) => {
    snap.sizes[category] += bytes;
    snap.used += bytes;
  };

  const run = async (): Promise<ScanSnapshot> => {
    const space = await diskSpace(layout.drive);
    snap.total = space.total;
    snap.available = space.available;

    const all = layout.roots;
    const rootPaths = new Set(all.map((r) => r.path));
    const holdsRoot = (path: string) => {
      const prefix = path + sep;
      return all.some((r) => r.path.startsWith(prefix));
    };

    const units: Unit[] = [];

    // Lists a folder, queueing each subfolder for du and adding loose files
    // straight away. Subfolders that hold another root are opened instead of
    // measured whole, so the inner root is not counted twice.
    const addFile = async (path: string, category: CategoryId) => {
      try {
        const stat = await fsp.lstat(path);
        const bytes = stat.blocks * 512;
        add(category, bytes);
        if (bytes > 0) snap.items[category].push({ path, size: bytes, dir: false });
      } catch {
        // vanished or unreadable; nothing to count
      }
    };

    // Unreadable system folders are expected; they count as System data anyway.
    // So are, on Windows, folders it locks for everyone (WindowsApps, a service's
    // ProgramData): only unreadable folders in your own home are worth a mention.
    const home = layout.home.toLowerCase() + sep;
    const report = (path: string, category: CategoryId) => {
      if (IS_WINDOWS && !path.toLowerCase().startsWith(home)) return;
      if (category !== "system" && basename(path) !== "lost+found") snap.blocked.push(path);
    };

    const expand = async (path: string, category: CategoryId, hidden?: CategoryId): Promise<void> => {
      if (cancelled) return;
      let entries;
      try {
        entries = await fsp.readdir(path, { withFileTypes: true });
      } catch (error) {
        // A root can be a single file, like a swap file.
        if ((error as NodeJS.ErrnoException).code === "ENOTDIR") await addFile(path, category);
        else if (denied(error)) report(path, category);
        return;
      }
      for (const entry of entries) {
        const child = join(path, entry.name);
        if (rootPaths.has(child) || layout.skip(child)) continue;
        const kind = hidden !== undefined && entry.name.startsWith(".") ? hidden : category;
        if (entry.isDirectory()) {
          if (holdsRoot(child)) await expand(child, kind);
          else units.push({ path: child, category: kind });
        } else {
          await addFile(child, kind);
        }
      }
    };

    const order = CATEGORIES.map((c) => c.id);
    const sorted: Root[] = [...all].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
    for (const root of sorted) {
      snap.current = root.path;
      await expand(root.path, root.category, root.hidden);
      emit();
    }

    let next = 0;
    const worker = async () => {
      while (!cancelled && next < units.length) {
        const unit = units[next++];
        snap.current = unit.path;
        emit();
        const result = await du(unit.path, children);
        if (cancelled) return;
        add(unit.category, result.bytes);
        if (result.bytes > 0) snap.items[unit.category].push({ path: unit.path, size: result.bytes, dir: true });
        if (result.denied && result.bytes < 1024 * 1024) report(unit.path, unit.category);
        emit();
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    for (const list of Object.values(snap.items)) list.sort((a, b) => b.size - a.size);
    if (IS_WINDOWS) await nameRecycled(snap.items.trash);

    // Whatever the disk reports as used beyond what was measured is the
    // system's: the OS itself, snapshots, swap, and folders this process may
    // not read.
    const after = await diskSpace(layout.drive);
    if (after.total > 0) {
      snap.total = after.total;
      snap.available = after.available;
      const others = snap.used - snap.sizes.system;
      if (IS_WINDOWS) {
        // Windows' own folders share many files through hard links (WinSxS and
        // System32), and folders measured apart count such a file in each, so
        // their sum overstates System data; what the disk says is used does not.
        snap.sizes.system = Math.max(0, after.used - others);
        snap.used = Math.max(after.used, others);
      } else {
        snap.sizes.system = Math.max(snap.sizes.system, after.used - others);
        snap.used = Math.max(after.used, snap.used);
      }
    }
    snap.current = "";
    snap.phase = "done";
    emit(true);
    return snap;
  };

  return {
    cancel() {
      cancelled = true;
      for (const child of children) child.kill();
    },
    done: run(),
  };
}

/** Re-measures one category after something was deleted from it. */
export async function measure(category: CategoryId, layout: Layout): Promise<number> {
  const children = new Set<DuProcess>();
  let total = 0;
  for (const root of layout.roots) {
    if (root.category !== category) continue;
    total += (await du(root.path, children)).bytes;
  }
  return total;
}

/** Gives each item in the Recycle Bin the path it had before it was deleted. */
export async function nameRecycled(items: Item[]): Promise<void> {
  for (const item of items) {
    if (!item.origin && isRecycled(item.path)) item.origin = (await originalPath(item.path)) ?? undefined;
  }
}
