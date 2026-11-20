import type { Style } from "../ui/runtime";
import { textOf, type TuiNode } from "./nodes";
import { lines, width as textWidth } from "./text";

// yoga-layout is an ES module that loads WebAssembly, so it is imported once, up front.
type Yoga = Awaited<ReturnType<(typeof import("yoga-layout/load", { with: { "resolution-mode": "import" } }))["loadYoga"]>>;
type YogaModule = typeof import("yoga-layout/load", { with: { "resolution-mode": "import" } });
type YogaNode = ReturnType<Yoga["Node"]["create"]>;

let yoga: Yoga;
let Y: YogaModule;

export async function loadLayout(): Promise<void> {
  Y = await import("yoga-layout/load");
  yoga = await Y.loadYoga();
}

/**
 * The interface is written in pixels for a font of size fs, where a character is
 * fs * 0.6 wide. Here a character is one column and a line is one row, so
 * every length is converted to columns or rows before layout, and Yoga rounds
 * the result to whole cells.
 */
export interface Metrics {
  /** What the interface is told the font is: root.info.basePx. */
  basePx: number;
  /** Pixels per column and per row, in the interface's own units. */
  colPx: number;
  rowPx: number;
}

export function metrics(basePx = 20): Metrics {
  const fs = Math.round(basePx * 0.85);
  // An item row is fs * 1.75 tall in the interface; here it is one line.
  return { basePx, colPx: fs * 0.6, rowPx: fs * 1.75 };
}

type Length = Style["width"];

function length(value: Length, per: number): number | `${number}%` | "auto" | undefined {
  if (value === undefined || value === "auto") return value;
  if (typeof value === "string") return value;
  return value / per;
}

/**
 * Vertical lengths snap to whole rows one by one, before layout: small gaps
 * (a fifth of a line each) would otherwise add up and skip a row every few
 * lines. A gap of 0.4 of a line or more becomes a blank row.
 */
const snapRows = (v: number, m: Metrics) => Math.floor(v / m.rowPx + 0.6);

function applyStyle(node: YogaNode, style: Style, m: Metrics, direction: "row" | "column") {
  const cols = (v: number) => v / m.colPx;
  const rows = (v: number) => snapRows(v, m);

  node.setFlexDirection(direction === "row" ? Y.FlexDirection.Row : Y.FlexDirection.Column);
  if (style.flexGrow !== undefined) node.setFlexGrow(style.flexGrow);
  if (style.flexShrink !== undefined) node.setFlexShrink(style.flexShrink);
  if (style.flexBasis !== undefined) node.setFlexBasis(length(style.flexBasis, m.colPx) as number);

  node.setWidth(length(style.width, m.colPx) as number);
  // Anything given a height takes at least a row, so a dot or a spacer never vanishes.
  node.setHeight(typeof style.height === "number" ? Math.max(1, snapRows(style.height, m)) : (length(style.height, m.rowPx) as number));
  if (style.minWidth !== undefined) node.setMinWidth(length(style.minWidth, m.colPx) as number);
  if (style.maxWidth !== undefined) node.setMaxWidth(length(style.maxWidth, m.colPx) as number);
  if (style.maxHeight !== undefined) node.setMaxHeight(typeof style.maxHeight === "number" ? snapRows(style.maxHeight, m) : (length(style.maxHeight, m.rowPx) as number));

  const edges = (value: Style["padding"], set: (edge: number, v: number) => void) => {
    if (value === undefined) return;
    const e = typeof value === "number" ? { left: value, right: value, top: value, bottom: value } : value;
    if (e.left) set(Y.Edge.Left, cols(e.left));
    if (e.right) set(Y.Edge.Right, cols(e.right));
    if (e.top) set(Y.Edge.Top, rows(e.top));
    if (e.bottom) set(Y.Edge.Bottom, rows(e.bottom));
  };
  edges(style.padding, (edge, v) => node.setPadding(edge, v));
  edges(style.margin, (edge, v) => node.setMargin(edge, v));

  if (style.gap) {
    if (direction === "row") node.setGap(Y.Gutter.Column, cols(style.gap));
    else node.setGap(Y.Gutter.Row, rows(style.gap));
  }
  if (style.overflow === "hidden") node.setOverflow(Y.Overflow.Hidden);
  if (style.overflow === "scroll") node.setOverflow(Y.Overflow.Scroll);

  const justify = { start: Y.Justify.FlexStart, center: Y.Justify.Center, end: Y.Justify.FlexEnd, "space-between": Y.Justify.SpaceBetween };
  if (style.justifyContent) node.setJustifyContent(justify[style.justifyContent]);
  const align = { start: Y.Align.FlexStart, center: Y.Align.Center, end: Y.Align.FlexEnd, stretch: Y.Align.Stretch };
  if (style.alignItems) node.setAlignItems(align[style.alignItems]);
}

function build(node: TuiNode, m: Metrics, config: ReturnType<Yoga["Config"]["create"]>, nodes: Map<TuiNode, YogaNode>): YogaNode {
  const yn = yoga.Node.create(config);
  nodes.set(node, yn);
  const style = node.style;
  if (node.type === "text" || node.type === "raw") {
    applyStyle(yn, style, m, "row");
    const text = textOf(node);
    const wrap = style.wrap === true;
    yn.setMeasureFunc((width, widthMode) => {
      const natural = textWidth(text);
      if (!wrap || widthMode === Y.MeasureMode.Undefined || natural <= width) return { width: natural, height: 1 };
      const wrapped = lines(text, Math.max(1, Math.floor(width)));
      return { width: Math.min(natural, Math.floor(width)), height: wrapped.length };
    });
    return yn;
  }
  applyStyle(yn, style, m, style.flexDirection ?? "row");
  node.children.forEach((child, i) => yn.insertChild(build(child, m, config, nodes), i));
  return yn;
}

/**
 * Lays the tree out on a cols x rows grid and gives every node its rect, in
 * cells and on screen: a scrolled box moves its children up by its scroll.
 */
export function layout(root: TuiNode, cols: number, rows: number, m: Metrics) {
  const config = yoga.Config.create();
  config.setUseWebDefaults(true);
  config.setPointScaleFactor(1);
  const nodes = new Map<TuiNode, YogaNode>();
  const top = build(root, m, config, nodes);
  top.setWidth(cols);
  top.setHeight(rows);
  top.calculateLayout(cols, rows, Y.Direction.LTR);

  const place = (node: TuiNode, col: number, row: number) => {
    const yn = nodes.get(node)!;
    const l = yn.getComputedLayout();
    node.rect = { col: col + l.left, row: row + l.top, cols: l.width, rows: l.height };
    if (node.style.overflow === "scroll") {
      // Never scroll past the end of the content.
      const content = node.children.reduce((end, child) => {
        const c = nodes.get(child)!.getComputedLayout();
        return Math.max(end, c.top + c.height);
      }, 0);
      node.scroll = Math.max(0, Math.min(node.scroll, content - l.height));
    }
    // The raw text inside a text node is measured as part of it, not laid out apart.
    if (node.type !== "box") return;
    const scroll = node.style.overflow === "scroll" ? node.scroll : 0;
    for (const child of node.children) place(child, node.rect.col, node.rect.row - scroll);
  };
  place(root, 0, 0);

  top.freeRecursive();
  config.free();
}

/** How many rows of content a scrolling box holds. */
export function contentRows(node: TuiNode): number {
  if (!node.rect) return 0;
  const top = node.rect.row + node.scroll;
  return node.children.reduce((end, child) => (child.rect ? Math.max(end, child.rect.row + node.scroll + child.rect.rows - top) : end), 0);
}
