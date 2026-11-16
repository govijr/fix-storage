import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cannotRemove, managedByTool } from "../src/core/browse";
import { clean } from "../src/core/clean";
import { Store } from "../src/ui/store";

const home = "/Users/someone";
const h = (...parts: string[]) => join(home, ...parts);

test("account data and credentials are never removable, folder or contents", () => {
  for (const path of [
    h("Library/Keychains"),
    h("Library/Keychains/login.keychain-db"),
    h("Library/Preferences/com.apple.finder.plist"),
    h("Library/Messages/chat.db"),
    h("Library/Mail/V10/MailData"),
    h("Library/Safari/History.db"),
    h(".ssh/id_ed25519"),
    h(".gnupg/private-keys-v1.d"),
    h("Library/Containers/com.apple.Safari/Data/Library/Safari/History.db"),
    h("Library/Containers/com.apple.mail"),
    h("Library/Application Support/AddressBook/Sources"),
    h("Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"),
    // A path that climbs out of a cache folder still lands on the keychain.
    h("Library/Caches/../Keychains/login.keychain-db"),
  ]) {
    assert.match(cannotRemove(path, home) ?? "", /never removes/, path);
  }
});

test("photos libraries are never removable, wherever they live", () => {
  for (const path of [
    h("Pictures/Photos Library.photoslibrary"),
    h("Pictures/Photos Library.photoslibrary/originals/A/IMG_0001.HEIC"),
    h("Documents/Old Trip.photoslibrary"),
  ]) {
    assert.match(cannotRemove(path, home) ?? "", /Photos library/, path);
  }
  assert.equal(cannotRemove(h("Pictures/exports/IMG_0001.jpg"), home), null);
});

test("ordinary items inside the scanned folders stay removable", () => {
  for (const path of [
    h("Library/Application Support/SomeApp"),
    h("Library/Keychains-old/stale"),
    h("Downloads/Figma.dmg"),
    h("code/app/node_modules"),
  ]) {
    assert.equal(cannotRemove(path, home), null, path);
  }
});

test("the folders the scan is built on, and anything outside them, are not removable", () => {
  assert.match(cannotRemove(h("Library"), home) ?? "", /needs this folder/);
  assert.match(cannotRemove(home, home) ?? "", /needs this folder/);
  assert.match(cannotRemove("/private/var/vm/sleepimage", home) ?? "", /macOS manages/);
  assert.match(cannotRemove("/etc/hosts", home) ?? "", /Outside/);
});

test("items a tool manages point to that tool instead of being removable", () => {
  assert.match(managedByTool({ path: "/opt/homebrew/Cellar", size: 1, dir: true }, "developer") ?? "", /brew cleanup/);
  assert.match(
    managedByTool({ path: h("Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"), size: 1 }, "developer") ?? "",
    /docker system prune/,
  );
  // Folders holding tool data, and junk-looking names inside a tool's folder.
  assert.match(managedByTool({ path: h(".ollama"), size: 1, dir: true }, "developer") ?? "", /ollama rm/);
  assert.match(managedByTool({ path: "/opt/homebrew/lib/node_modules", size: 1, dir: true }, "developer") ?? "", /brew/);
  assert.match(managedByTool({ path: "/usr/local/Homebrew", size: 1, dir: true }, "developer") ?? "", /brew/);
  assert.equal(managedByTool({ path: h("code/app/node_modules"), size: 1, dir: true }, "documents"), null);
  assert.equal(managedByTool({ path: "/usr/local/bin/terraform", size: 1 }, "developer"), null);
});

test("the interface refuses to remove what the rules protect", () => {
  const store = new Store({ demo: true, dryRun: false });
  assert.match(store.blocked({ path: "/opt/homebrew/Cellar", size: 1, dir: true }) ?? "", /brew/);
  assert.equal(store.blocked({ path: h("Downloads/Figma.dmg"), size: 1 }), null);
});

test("clearing caches deletes only what is inside the cache folders", async () => {
  const fake = mkdtempSync(join(tmpdir(), "fix-storage-test-"));
  try {
    const cache = join(fake, "Library/Caches/com.example.app");
    const document = join(fake, "Documents/keep.txt");
    mkdirSync(cache, { recursive: true });
    mkdirSync(join(fake, "Documents"));
    writeFileSync(join(cache, "blob"), "x");
    writeFileSync(document, "mine");

    const items = [
      { path: cache, size: 1 },
      { path: document, size: 1 },
      { path: join(fake, "Library/Caches/../../Documents/keep.txt"), size: 1 },
    ];
    const pretend = await clean("caches", items, { home: fake, dryRun: true });
    assert.equal(existsSync(cache), true, "a dry run deletes nothing");
    assert.equal(pretend.removed, 1);

    const result = await clean("caches", items, { home: fake });
    assert.equal(existsSync(cache), false);
    assert.equal(existsSync(document), true);
    assert.deepEqual(result.skipped, [items[1].path, items[2].path]);
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});
