/**
 * du for Windows, which has none: prints what `du -k` prints, so the scan and
 * the culprit search read it the same way on every system.
 *
 *   node windu.js -s <folder>        one line: kilobytes and the folder
 *   node windu.js -d <n> <folder>    every folder down to depth n, deepest first
 *
 * Sizes are the space files take on disk (cloud-only OneDrive files take none).
 * Links and junctions are not followed, so the walk stays on the folder it was
 * given and never loops through the old "Application Data" style junctions.
 * Like du, a file with several hard links is counted once. Folders that cannot
 * be read are reported on stderr as "Permission denied", the way du does.
 */
import { promises as fsp } from "node:fs";
import { join } from "node:path";

/**
 * Folders and files read at once. Windows answers these fastest with many in
 * flight: capping it at 64 made a walk twice as slow. The cap only guards
 * against a folder with millions of entries.
 */
const PARALLEL = 4096;

let active = 0;
// A queue read from the front by index: Array.shift() copies the whole array, and
// with hundreds of thousands of files waiting that made the walk six times slower.
let waiting: Array<() => void> = [];
let head = 0;

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (active >= PARALLEL) await new Promise<void>((go) => waiting.push(go));
  active++;
  try {
    return await task();
  } finally {
    active--;
    if (head < waiting.length) waiting[head++]();
    if (head > 65536 && head * 2 > waiting.length) {
      waiting = waiting.slice(head);
      head = 0;
    }
  }
}

const seen = new Set<string>();
const denied = (error: unknown) => ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "");

/** Bytes in a folder; writes a line for it when it is no deeper than `depth`. */
async function walk(path: string, level: number, depth: number, lines: string[]): Promise<number> {
  let entries;
  try {
    entries = await limited(() => fsp.readdir(path, { withFileTypes: true }));
  } catch (error) {
    if (denied(error)) process.stderr.write(`windu: ${path}: Permission denied\n`);
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) return walk(child, level + 1, depth, lines);
      try {
        const stat = await limited(() => fsp.lstat(child, { bigint: true }));
        if (stat.nlink > 1n) {
          const id = `${stat.dev}:${stat.ino}`;
          if (seen.has(id)) return 0;
          seen.add(id);
        }
        return Number(stat.blocks) * 512;
      } catch {
        return 0; // vanished, or in use by Windows itself
      }
    }),
  );
  const bytes = sizes.reduce((a, b) => a + b, 0);
  if (level <= depth) lines.push(`${Math.ceil(bytes / 1024)}\t${path}`);
  return bytes;
}

async function main() {
  const args = process.argv.slice(2);
  const folder = args[args.length - 1];
  const depth = args[0] === "-d" ? Number(args[1]) : 0;
  if (!folder || !Number.isFinite(depth)) {
    process.stderr.write("usage: windu (-s | -d <depth>) <folder>\n");
    process.exit(2);
  }
  const lines: string[] = [];
  await walk(folder, 0, depth, lines);
  process.stdout.write(lines.join("\n") + "\n");
}

void main();
