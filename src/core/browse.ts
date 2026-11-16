import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promises as fsp } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { roots, type CategoryId } from "./categories";
import { classify, isWhole, type Usage } from "./classify";
import { du, type Item } from "./scan";

export interface ListHandle {
  cancel(): void;
}

/**
 * Folder sizes measured on the way to a culprit. Opening one of those folders
 * later reuses them instead of measuring again, so diving in is instant.
 */
const known = new Map<string, number>();

/** Drops remembered sizes for a path, everything inside it, and every folder above it. */
export function forgetSizes(path: string) {
  for (const key of known.keys()) {
    if (key === path || key.startsWith(path + "/") || path.startsWith(key + "/")) known.delete(key);
  }
}

export function forgetAllSizes() {
  known.clear();
}

/**
 * Measures everything directly inside a folder: loose files straight away,
 * subfolders with du, a few at a time. Calls back with the list so far,
 * largest first, and once more with done = true.
 */
export function listFolder(path: string, onUpdate: (items: Item[], done: boolean, current: string) => void): ListHandle {
  const children = new Set<ChildProcess>();
  let cancelled = false;
  const items: Item[] = [];
  const sorted = () => [...items].sort((a, b) => b.size - a.size);

  const run = async () => {
    let entries;
    try {
      entries = await fsp.readdir(path, { withFileTypes: true });
    } catch {
      if (!cancelled) onUpdate([], true, "");
      return;
    }
    const folders: string[] = [];
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        folders.push(child);
        continue;
      }
      try {
        const stat = await fsp.lstat(child);
        items.push({ path: child, size: stat.blocks * 512, dir: false });
      } catch {
        // vanished
      }
    }
    if (cancelled) return;
    onUpdate(sorted(), folders.length === 0, folders[0] ?? "");

    let next = 0;
    const worker = async () => {
      while (!cancelled && next < folders.length) {
        const folder = folders[next++];
        const cached = known.get(folder);
        const bytes = cached ?? (await du(folder, children)).bytes;
        if (cancelled) return;
        items.push({ path: folder, size: bytes, dir: true });
        onUpdate(sorted(), false, folder);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (!cancelled) onUpdate(sorted(), true, "");
  };
  void run();

  return {
    cancel() {
      cancelled = true;
      for (const child of children) child.kill();
    },
  };
}

// ---- culprits -------------------------------------------------------------

export interface Culprit {
  /** Folders, then maybe one file, each holding most of the one before it. Empty when the space is spread out. */
  chain: Item[];
  /** The biggest things directly inside, for when no single one dominates. */
  top: Item[];
}

/** A child holding at least this share of its parent counts as "where the space is". */
const DOMINANT = 0.5;
const DEPTH = 12;

/**
 * Finds where the space inside a folder actually is: measures every subfolder
 * in one du walk, then follows the biggest child down for as long as it holds
 * most of its parent.
 */
export function findCulprit(path: string, onDone: (culprit: Culprit) => void): ListHandle {
  let cancelled = false;
  const child = spawn("du", ["-kx", "-d", String(DEPTH), path], { stdio: ["ignore", "pipe", "ignore"] });
  const sizes = new Map<string, number>();
  const kids = new Map<string, Item[]>();
  let buffer = "";
  const take = (line: string) => {
    const tab = line.indexOf("\t");
    if (tab < 0) return;
    const kb = Number.parseInt(line.slice(0, tab), 10);
    const dir = line.slice(tab + 1);
    if (!Number.isFinite(kb)) return;
    const bytes = kb * 1024;
    sizes.set(dir, bytes);
    if (dir === path) return;
    const parent = dirname(dir);
    const list = kids.get(parent) ?? [];
    list.push({ path: dir, size: bytes, dir: true });
    kids.set(parent, list);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) take(line);
  });

  const finish = async () => {
    if (cancelled) return;
    if (buffer) take(buffer);
    for (const [dir, bytes] of sizes) known.set(dir, bytes);

    const chain: Item[] = [];
    let current = path;
    let currentSize = sizes.get(path) ?? 0;
    for (let depth = 0; depth < DEPTH; depth++) {
      const best = (kids.get(current) ?? []).reduce<Item | null>((a, b) => (!a || b.size > a.size ? b : a), null);
      if (!best || best.size < currentSize * DOMINANT) break;
      chain.push(best);
      current = best.path;
      currentSize = best.size;
      if (isWhole(best.path)) break;
    }
    // A single huge file at the bottom (a video, a disk image) is the real answer.
    const last = chain[chain.length - 1];
    if (!last || !isWhole(last.path)) {
      const biggestFile = (await looseFiles(current))[0];
      if (biggestFile && biggestFile.size >= currentSize * DOMINANT) chain.push(biggestFile);
    }

    const top = [...(kids.get(path) ?? []), ...(await looseFiles(path))].sort((a, b) => b.size - a.size).slice(0, 3);
    if (!cancelled) onDone({ chain, top });
  };
  child.on("close", () => void finish());
  child.on("error", () => void finish());

  return {
    cancel() {
      cancelled = true;
      child.kill();
    },
  };
}

async function looseFiles(path: string): Promise<Item[]> {
  let entries;
  try {
    entries = await fsp.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: Item[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    try {
      const stat = await fsp.lstat(join(path, entry.name));
      files.push({ path: join(path, entry.name), size: stat.blocks * 512, dir: false });
    } catch {
      // vanished
    }
  }
  return files.sort((a, b) => b.size - a.size);
}

// ---- when things were last used --------------------------------------------

/**
 * Last-opened dates from Spotlight where it has one (apps, documents, media),
 * otherwise the modification time.
 */
export async function usage(paths: string[]): Promise<Map<string, Usage>> {
  const result = new Map<string, Usage>();
  for (let i = 0; i < paths.length; i += 40) {
    const batch = paths.slice(i, i + 40);
    const opened = await new Promise<string[]>((done) => {
      execFile("mdls", ["-raw", "-name", "kMDItemLastUsedDate", ...batch], { maxBuffer: 1 << 20 }, (error, stdout) => {
        const values = stdout ? stdout.split("\0") : [];
        done(values.length === batch.length ? values : []);
      });
    });
    for (let j = 0; j < batch.length; j++) {
      const value = opened[j];
      const at = value && value !== "(null)" ? Date.parse(value.replace(" +0000", "Z").replace(" ", "T")) : NaN;
      if (Number.isFinite(at)) {
        result.set(batch[j], { at, kind: "opened" });
        continue;
      }
      try {
        const stat = await fsp.stat(batch[j]);
        result.set(batch[j], { at: stat.mtimeMs, kind: "changed" });
      } catch {
        // vanished
      }
    }
  }
  return result;
}

// ---- demo --------------------------------------------------------------

const DEMO_NAMES: Partial<Record<CategoryId, string[]>> = {
  apps: ["Contents", "Frameworks", "Resources", "PlugIns", "Helpers", "SharedSupport", "Library", "Info.plist"],
  developer: ["Devices", "node_modules", "Runtimes", "iOS DeviceSupport", "toolchains", ".venv", "target", "logs.txt"],
  photos: ["originals", "resources", "derivatives", "database", "scopes", "private", "Thumbnails"],
  movies: ["Render Files", "Original Media", "Transcoded Media", "Proxy Media", "Final.mov", "Draft 2.mov"],
  documents: ["node_modules", "renders", ".next", "Screen Recording 2025-03-02 at 1.37.29 PM.mov", "Figma-124.1.dmg", "2024", "Archive.zip", "notes.md"],
  music: ["Media.localized", "Apple Loops", "Projects", "Samples", "Bounces", "Library.musicdb"],
  caches: ["v3", "metadata", "content-v2", "index-v5", "blobs", "tmp", "fsCachedData", "Cache.db"],
  trash: ["exports", "renders", "build", "old", "backup.zip", "recording.mov", "data.sqlite"],
  system: ["logs", "snapshots", "swapfile0", "swapfile1", "diagnostics"],
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Made-up contents for a demo folder, so the drill-down has something to show. */
export function demoChildren(category: CategoryId, path: string, size: number, depth: number): Item[] {
  const pool = DEMO_NAMES[category] ?? DEMO_NAMES.documents!;
  const count = 4 + Math.floor(hash(path) * (pool.length - 3));
  const start = Math.floor(hash(path + "#") * pool.length);
  const names = Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
  // About half the folders have one child holding most of the space, so the demo has culprits to find.
  const lopsided = hash(path + "!") < 0.55;
  const weights = names.map((name, i) => (1 / (i + 1.2)) * (0.6 + hash(path + name)) * (lopsided && i === 0 ? 5 : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  return names
    .map((name, i) => ({
      path: `${path}/${name}`,
      size: (size * weights[i]) / sum,
      dir: depth < 7 && !/\.[a-z0-9]+$/i.test(name),
    }))
    .sort((a, b) => b.size - a.size);
}

/** Demo stand-in for findCulprit: follows the made-up tree down. */
export function demoCulprit(category: CategoryId, path: string, size: number, depth: number): Culprit {
  const chain: Item[] = [];
  let current = { path, size, dir: true } as Item;
  for (let d = depth; d < depth + 6 && current.dir; d++) {
    const kids = demoChildren(category, current.path, current.size, d);
    const best = kids[0];
    if (!best || best.size < current.size * 0.5) break;
    chain.push(best);
    current = best;
    if (isWhole(best.path)) break;
  }
  return { chain, top: demoChildren(category, path, size, depth).slice(0, 3) };
}

/** Demo stand-in for usage: stable made-up dates between today and three years ago. */
export function demoUsage(path: string, now: number = Date.now()): Usage {
  const days = Math.floor(hash(path + "@") ** 2 * 1100);
  return { at: now - days * 24 * 3600 * 1000, kind: /\.(app|mov|mp4|key|dmg)$/i.test(path) ? "opened" : "changed" };
}

// ---- acting on one item -------------------------------------------------

/**
 * Folders that must stay where they are, though what is inside them may go:
 * removing one would break the system or the user's account.
 */
function protectedFolders(home: string): Set<string> {
  return new Set(
    [
      ...roots(home).map((r) => r.path),
      "/",
      "/System",
      "/Library",
      "/usr",
      "/usr/local/bin",
      "/usr/local/lib",
      "/opt/homebrew/bin",
      "/opt/homebrew/lib",
      home,
      join(home, "Library"),
    ].map((p) => resolve(p)),
  );
}

/**
 * Account data and credentials. Neither these folders nor anything inside
 * them is ever offered for removal: their size is shown, nothing more.
 */
function privateData(home: string): string[] {
  const lib = (name: string) => join(home, "Library", name);
  return [
    lib("Keychains"),
    lib("Preferences"),
    lib("Mail"),
    lib("Messages"),
    lib("Accounts"),
    lib("Cookies"),
    lib("Calendars"),
    lib("Safari"),
    lib("Photos"),
    lib("Biome"),
    // Apple's own apps keep their data in containers too.
    lib("Containers/com.apple.Safari"),
    lib("Containers/com.apple.mail"),
    lib("Application Support/AddressBook"),
    lib("Group Containers/group.com.apple.notes"),
    join(home, ".ssh"),
    join(home, ".gnupg"),
  ].map((p) => resolve(p));
}

/** Why an item cannot be removed, or null when it can. */
export function cannotRemove(path: string, home: string = homedir()): string | null {
  if (!path.startsWith("/")) return "Not a real path.";
  const target = resolve(path);
  if (privateData(home).some((p) => target === p || target.startsWith(p + sep)))
    return "Account data or credentials. This tool never removes it.";
  if (target.split(sep).some((part) => part.toLowerCase().endsWith(".photoslibrary")))
    return "A Photos library. Delete photos in the Photos app instead.";
  if (protectedFolders(home).has(target)) return "macOS or your account needs this folder.";
  if (target.startsWith("/System/") || target.startsWith("/private/")) return "macOS manages this.";
  const known = roots(home).some((root) => target.startsWith(resolve(root.path) + sep));
  if (!known) return "Outside the folders this tool looks at.";
  return null;
}

/**
 * Why a tool-managed item (Docker's disk, Ollama models, Homebrew) should be
 * cleaned up with that tool instead, or null. Deleting these by hand breaks
 * the tool that owns them.
 */
export function managedByTool(item: Item, category: CategoryId): string | null {
  const label = classify(item, category);
  if (label.verdict !== "system") return null;
  return `A tool manages this: ${label.reason}.`;
}

/** True when the item lives where permanent deletion is fine: caches and the Trash. */
export function deletesForGood(category: CategoryId): boolean {
  return category === "caches" || category === "trash";
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    execFile(file, args, (error, _stdout, stderr) => {
      if (error) fail(new Error(stderr.trim() || error.message));
      else done();
    });
  });
}

/** Moves a file or folder to the Trash, where it can be put back from Finder. */
export async function moveToTrash(path: string): Promise<void> {
  try {
    await fsp.access("/usr/bin/trash");
    await run("/usr/bin/trash", [path]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await run("osascript", [
      "-e",
      "on run argv",
      "-e",
      'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
      "-e",
      "end run",
      path,
    ]);
  }
}

/** Deletes for good. Only used for caches and things already in the Trash. */
export async function deleteForGood(path: string): Promise<void> {
  await fsp.rm(path, { recursive: true, force: true });
}

/** Opens a Finder window with the item selected. */
export function reveal(path: string): Promise<void> {
  return run("open", ["-R", path]);
}

export function trashPathFor(path: string, home: string = homedir()): string {
  return join(home, ".Trash", basename(path));
}
