import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants";
import type { BoxProps, ClickEvent, Style, Surface } from "../ui/runtime";

/** Where a node landed, in whole terminal cells. */
export interface CellRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export interface Handlers {
  onClick?: (event: ClickEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onMouseMove?: (event: ClickEvent) => void;
}

/** One element on screen: a box, a run of text, or the raw text inside one. */
export interface TuiNode extends Handlers {
  id: number;
  type: "box" | "text" | "raw";
  style: Style;
  surface?: Surface;
  /** For raw text. */
  value: string;
  parent: TuiNode | null;
  children: TuiNode[];
  /** Set by layout; null until the node has been laid out. */
  rect: CellRect | null;
  /** Rows scrolled, for a box with overflow: scroll. */
  scroll: number;
}

let nextId = 1;

export function makeNode(type: TuiNode["type"], props: BoxProps & { style?: Style } = {}, value = ""): TuiNode {
  const node: TuiNode = { id: nextId++, type, style: {}, value, parent: null, children: [], rect: null, scroll: 0 };
  setProps(node, props);
  return node;
}

function setProps(node: TuiNode, props: BoxProps) {
  node.style = props.style ?? {};
  node.surface = props.surface;
  node.onClick = props.onClick;
  node.onMouseEnter = props.onMouseEnter;
  node.onMouseLeave = props.onMouseLeave;
  node.onMouseMove = props.onMouseMove;
}

/** The text a text node shows: all the raw text inside it, in order. */
export function textOf(node: TuiNode): string {
  if (node.type === "raw") return node.value;
  return node.children.map(textOf).join("");
}

/** What a ref to a box or text points at, the same shape as pixel's NodeHandle. */
export interface Handle {
  id: number;
  scrollIntoView(smooth?: boolean): void;
}

function append(parent: TuiNode, child: TuiNode) {
  remove(child);
  child.parent = parent;
  parent.children.push(child);
}

function insertBefore(parent: TuiNode, child: TuiNode, before: TuiNode) {
  remove(child);
  child.parent = parent;
  const at = parent.children.indexOf(before);
  parent.children.splice(at < 0 ? parent.children.length : at, 0, child);
}

function remove(child: TuiNode) {
  const parent = child.parent;
  if (!parent) return;
  const at = parent.children.indexOf(child);
  if (at >= 0) parent.children.splice(at, 1);
  child.parent = null;
}

/** Brings a node into view in the nearest scrolling box above it. */
export function scrollIntoView(node: TuiNode) {
  for (let box = node.parent; box; box = box.parent) {
    if (box.style.overflow !== "scroll" || !box.rect || !node.rect) continue;
    // node.rect is where it is drawn now, after the current scroll.
    const top = node.rect.row - box.rect.row;
    const bottom = top + node.rect.rows;
    if (top < 0) box.scroll = Math.max(0, box.scroll + top);
    else if (bottom > box.rect.rows) box.scroll += bottom - box.rect.rows;
    return;
  }
}

export interface Container {
  root: TuiNode;
  /** Called after every commit, to lay out and draw. */
  committed(): void;
  /** Called when a node wants to scroll into view, after the next layout. */
  scrollLater(node: TuiNode): void;
}

type Props = BoxProps & { children?: unknown };

export const reconciler = Reconciler<string, Props, Container, TuiNode, TuiNode, TuiNode, unknown, Handle, object, true, unknown, ReturnType<typeof setTimeout>, -1>({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  noTimeout: -1,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  createInstance: (type, props) => makeNode(type === "text" ? "text" : "box", props),
  createTextInstance: (text) => makeNode("raw", {}, text),
  appendInitialChild: append,
  appendChild: append,
  appendChildToContainer: (container, child) => append(container.root, child),
  insertBefore,
  insertInContainerBefore: (container, child, before) => insertBefore(container.root, child, before),
  removeChild: (_parent, child) => remove(child),
  removeChildFromContainer: (_container, child) => remove(child),
  clearContainer: (container) => {
    for (const child of [...container.root.children]) remove(child);
  },
  finalizeInitialChildren: () => false,
  prepareUpdate: () => true,
  commitUpdate: (node, _payload, _type, _old, props) => setProps(node, props),
  commitTextUpdate: (node, _old, text) => {
    node.value = text;
  },
  resetTextContent: () => {},
  shouldSetTextContent: () => false,

  getRootHostContext: () => ({}),
  getChildHostContext: (context) => context,
  getPublicInstance: (node) => ({
    id: node.id,
    scrollIntoView: () => containerOf(node)?.scrollLater(node),
  }),
  prepareForCommit: () => null,
  resetAfterCommit: (container) => container.committed(),
  preparePortalMount: () => {},
  getCurrentEventPriority: () => DefaultEventPriority,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},
});

/** Each tree's root node knows its container, so a node can find its way back. */
const containers = new WeakMap<TuiNode, Container>();

export function registerContainer(container: Container) {
  containers.set(container.root, container);
}

function containerOf(node: TuiNode): Container | undefined {
  let top = node;
  while (top.parent) top = top.parent;
  return containers.get(top);
}
