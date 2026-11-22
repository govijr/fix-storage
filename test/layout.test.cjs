const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");

// Opt-in native terminal integration test. Requires tmux and pixel's runtime.
// Keep artifacts beside the checkout (or in the chosen directory), never /tmp.
const artifacts = resolve(process.env.FIX_STORAGE_TEST_DIR || ".test-artifacts");
mkdirSync(artifacts, { recursive: true });
const runDir = mkdtempSync(join(artifacts, "layout-"));
const socket = join(runDir, "s");
const env = {
  ...process.env,
  TMPDIR: runDir,
  XDG_STATE_HOME: join(runDir, "state"),
  PIXEL_RENDERER: "cells",
};
const pixel = resolve("node_modules/@zenbu-labs/pixel/dist/bin.js");
const fixture = resolve("test/fixtures/long-list.cjs");
function tmux(...args) {
  return spawnSync("tmux", ["-S", socket, ...args], { env, encoding: "utf8" });
}
function checked(...args) {
  const result = tmux(...args);
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout;
}
async function screenUntil(name, predicate) {
  const deadline = Date.now() + 15000;
  let screen = "";
  while (Date.now() < deadline) {
    const result = tmux("capture-pane", "-p", "-t", "layout");
    screen = result.stdout || result.stderr || "";
    if (result.status === 0 && predicate(screen)) {
      writeFileSync(join(runDir, name + ".txt"), screen);
      return screen;
    }
    await delay(100);
  }
  writeFileSync(join(runDir, name + "-failed.txt"), screen);
  assert.fail(`terminal condition not reached: ${name}\n${screen}`);
}

test("long lists keep the footer and selected last row visible", { timeout: 60000 }, async (t) => {
  try {
    for (const [cols, rows] of [[100, 24], [120, 40], [160, 60]]) {
      await t.test(`${cols}x${rows}`, async () => {
        if (cols === 100) {
          checked("new-session", "-d", "-s", "layout", "-x", String(cols), "-y", String(rows),
            process.execPath, pixel, fixture);
        } else {
          checked("resize-window", "-t", "layout", "-x", String(cols), "-y", String(rows));
        }
        checked("send-keys", "-t", "layout", "Home");
        await screenUntil(`${cols}x${rows}-first`, (screen) => screen.includes("item-000.txt"));
        checked("send-keys", "-t", "layout", "End");
        const screen = await screenUntil(`${cols}x${rows}-last`, (text) =>
          text.includes("item-079.txt") && text.includes("q quit"));
        assert.match(screen, /item-079\.txt/);
        assert.match(screen, /q quit/);
        const itemRows = screen.split("\n").filter((line) => /item-\d{3}\.txt/.test(line));
        assert.ok(itemRows.length > 0);
        for (const line of itemRows) {
          assert.match(line, /7mo\s*[▐▕│┃█░▒▓]*\s*$/, "scrollbar must not cover the last-used value: " + line);
        }
      });
    }
  } finally {
    tmux("send-keys", "-t", "layout", "q");
    await delay(1000);
    tmux("kill-server"); // Only the uniquely named server this test created.
  }
});
