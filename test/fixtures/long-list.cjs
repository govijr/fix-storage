// Synthetic data only: this fixture never starts a disk scan or removes files.
const React = require("react");
const { createRoot } = require("@zenbu-labs/pixel");
const { App } = require("../../dist/ui/app");
const { Store } = require("../../dist/ui/store");
const { demoDrives, demoLayout } = require("../../dist/core/demo");

const store = new Store({ demo: true, dryRun: true });
const items = Array.from({ length: 80 }, (_, i) => ({
  path: `/demo/item-${String(i).padStart(3, "0")}.txt`,
  size: (80 - i) * 1e7,
  dir: false,
}));
const initial = store.get();
const drives = demoDrives();
// Seed the compiled JS store to make layout independent of demo scan timing.
store.state = {
  ...initial,
  drives,
  layout: demoLayout(drives[0]),
  selected: "documents",
  pane: "list",
  usage: Object.fromEntries(items.map((item) => [item.path, { at: Date.now() - 220 * 864e5, kind: "opened" }])),
  scan: {
    ...initial.scan,
    phase: "done",
    total: 1e12,
    used: 324e8,
    available: 9676e8,
    sizes: { ...initial.scan.sizes, documents: 324e8 },
    items: { ...initial.scan.items, documents: items },
  },
};
const root = createRoot({
  name: "layout-test",
  onKey(event) {
    if (event.kind === "release") return;
    if (event.key === "end") store.moveRow(Infinity);
    if (event.key === "home") store.moveRow(-Infinity);
    if (event.key === "q") {
      store.stop();
      root.stop();
    }
    return true;
  },
  onResize() { render(); },
});
function render() { root.render(React.createElement(App, { root, store })); }
render();
