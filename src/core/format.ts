import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { sep } from "node:path";
import { byOs, IS_WINDOWS } from "./platform";

// File Explorer counts in powers of two and still calls them GB, MB and KB; matching it
// keeps the numbers the same as the ones Windows shows. macOS and Linux tools count in
// powers of ten.
const KB = byOs({ mac: 1e3, linux: 1e3, windows: 2 ** 10 });
const MB = KB * KB;
const GB = MB * KB;

/** Gigabytes with one decimal, the way the system reports storage. */
export function gb(bytes: number): string {
  return `${(Math.max(0, bytes) / GB).toFixed(1)} GB`;
}

/** Whole gigabytes for the disk's capacity ("512 GB"). Explorer rounds down: a 1 TB drive is "952 GB". */
export function capacity(bytes: number): string {
  return `${IS_WINDOWS ? Math.floor(bytes / GB) : Math.round(bytes / GB)} GB`;
}

/** Picks GB or MB, for lists where small items matter. */
export function size(bytes: number): string {
  if (bytes >= GB) return gb(bytes);
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(0, Math.round(bytes / KB))} KB`;
}

const HOME = homedir();
/** Where the home folder really is, when it is reached through a symlink (/home -> /var/home). */
const REAL_HOME = (() => {
  try {
    return realpathSync(HOME);
  } catch {
    return HOME;
  }
})();

/** Windows paths match whatever their case. */
const fold = (path: string) => (IS_WINDOWS ? path.toLowerCase() : path);

/** Replaces the home directory with ~ so paths stay short. */
export function tilde(path: string, home: string = HOME): string {
  for (const h of home === HOME ? [HOME, REAL_HOME] : [home]) {
    if (fold(path) === fold(h) || fold(path).startsWith(fold(h + sep))) return "~" + path.slice(h.length);
  }
  return path;
}
