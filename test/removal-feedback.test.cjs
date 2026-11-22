const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Store } = require("../dist/ui/store");

function until(store, predicate) {
  if (predicate(store.get())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("store transition timed out"));
    }, 8000);
    const unsubscribe = store.subscribe(() => {
      if (!predicate(store.get())) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

test("removal during a scan explains the wait without arming or removing", () => {
  const store = new Store({ demo: true, dryRun: true });
  try {
    assert.equal(store.get().scan.phase, "scanning");
    store.removeItem();
    assert.match(store.get().note || "", /still measuring.*wait for the scan/i);
    assert.equal(store.get().confirm, null);
    assert.equal(store.get().removing, null);
  } finally {
    store.stop();
  }
});

test("after scanning, removal still needs two presses and remains a dry run", { timeout: 12000 }, async () => {
  const store = new Store({ demo: true, dryRun: true });
  try {
    store.rescan();
    await until(store, (state) => state.scan.phase === "done");
    const before = store.entries().length;
    assert.ok(before > 0);
    store.removeItem();
    assert.equal(store.get().confirm?.kind, "item");
    assert.equal(store.get().removing, null);
    assert.equal(store.entries().length, before);
    store.removeItem();
    await until(store, (state) => state.removing === null && !!state.note);
    assert.match(store.get().note, /dry run, nothing changed/i);
    assert.equal(store.entries().length, before - 1);
  } finally {
    store.stop();
  }
});
