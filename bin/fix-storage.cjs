#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const args = process.argv.slice(2);
const appDir = path.resolve(__dirname, "..");

const linux = process.platform === "linux";
const windows = process.platform === "win32";
// Systems with more than one drive to choose from.
const drives = linux || windows;

const HELP = `fix-storage: see what is filling your ${drives ? "disks" : "Mac's disk"} and clear what is safe to clear.

Usage: fix-storage [options]

  (no options)   ${windows
    ? `Print a text summary. The interactive view is not on
                 Windows yet.`
    : `Open the interactive view. Needs a terminal with kitty
                 graphics (Ghostty, kitty, iTerm2, WezTerm); other terminals
                 get a simpler character view.`}
  --dry-run      Interactive view, but clearing only pretends: nothing is deleted.
  --demo         Interactive view on a made-up disk. Reads and deletes nothing.
  --plain        Print a text summary and exit. Deletes nothing.
  --json         Print the summary as JSON and exit. Deletes nothing.
${drives ? `  --drives       List mounted drives, and partitions that are not mounted, and exit.
  --drive <d>    Start on drive <d>: its number from --drives, its name, mount
                 point, label or device, or any path on it.
` : ""}  -h, --help     Show this help.
`;

if (args.includes("-h") || args.includes("--help")) {
  process.stdout.write(HELP);
  process.exit(0);
}

const known = new Set(["--dry-run", "--demo", "--plain", "--json", "--drives"]);
let unknown;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--drive") {
    if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
      process.stderr.write(`fix-storage: --drive needs a drive\n\n${HELP}`);
      process.exit(2);
    }
    i++;
  } else if (!known.has(arg) && !arg.startsWith("--drive=")) {
    unknown = arg;
    break;
  }
}
if (unknown) {
  process.stderr.write(`fix-storage: unknown option ${unknown}\n\n${HELP}`);
  process.exit(2);
}

// pixel, which draws the interactive view, has no Windows build: Windows gets the summary.
const textModes = ["--plain", "--json", "--drives"];
if (windows && process.stdout.isTTY && !args.some((arg) => textModes.includes(arg))) {
  process.stderr.write("fix-storage: the interactive view is not on Windows yet, so here is the summary.\n\n");
}

if (args.includes("--plain") || args.includes("--json") || args.includes("--drives") || !process.stdout.isTTY || windows) {
  require(path.join(appDir, "dist", "plain.js"))
    .runPlain(args)
    .catch((error) => {
      process.stderr.write(`fix-storage: ${error && error.message ? error.message : error}\n`);
      process.exit(1);
    });
} else {
  const pixel = require.resolve("@zenbu-labs/pixel/package.json", { paths: [appDir] });
  const bin = path.join(path.dirname(pixel), "dist", "bin.js");
  const result = spawnSync(process.execPath, [bin, appDir, "--", ...args], { stdio: "inherit" });
  process.exit(result.status === null ? 1 : result.status);
}
