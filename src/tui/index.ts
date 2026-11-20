/**
 * fix-storage's character renderer, for Windows, where pixel has no build. It
 * draws the same interface as pixel, from the same components, into the cells
 * of the terminal: text as text, the dot bars as • characters, and the disk
 * meter as a real image (Sixel) where the terminal shows them, or as a bar of
 * colored cells where it does not.
 *
 * It provides only what fix-storage uses of pixel: see ../ui/runtime.ts.
 */
import { createElement, forwardRef, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import type { BoxProps, KeyEvent, NodeHandle, Rect, Root, RootOptions, Surface, TextProps } from "../ui/runtime";
import { scale, sixel, type Frame } from "./graphics";
import { layout, loadLayout, metrics } from "./layout";
import { makeNode, reconciler, registerContainer, scrollIntoView, type Container, type TuiNode } from "./nodes";
import { Grid, nodesAt, paint, type Placed, type Rgb } from "./paint";
import { Terminal, type MouseEvent, type TerminalInfo } from "./terminal";

export const Box = forwardRef<NodeHandle, BoxProps>((props, ref) => createElement("box", { ...props, ref }));
export const Text = forwardRef<NodeHandle, TextProps>((props, ref) => createElement("text", { ...props, ref }));

const BACKGROUND: Rgb = [0, 0, 0];
/** At most this many images a second, so an animating meter leaves time for the scan. */
const IMAGE_FPS = 15;

interface Live {
  root: TuiNode;
  m: ReturnType<typeof metrics>;
  rectListeners: Set<() => void>;
}

let live: Live | null = null;

/** Finds a node by the id its handle carries. */
function find(node: TuiNode, id: number): TuiNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

/** Where a box is, in pixels, the way pixel reports it. Null until laid out. */
export function useRect(ref: RefObject<NodeHandle | null>): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    const check = () => {
      if (!live || !ref.current) return;
      const node = find(live.root, ref.current.id);
      if (!node?.rect) return;
      const { colPx, rowPx } = live.m;
      const next = { x: node.rect.col * colPx, y: node.rect.row * rowPx, width: node.rect.cols * colPx, height: node.rect.rows * rowPx };
      setRect((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    live?.rectListeners.add(check);
    check();
    return () => {
      live?.rectListeners.delete(check);
    };
  }, [ref]);
  return rect;
}

class TuiSurface implements Surface {
  frame: Frame | null = null;
  /** Bumped on every present, so the renderer knows when to send the image again. */
  version = 0;
  closed = false;
  constructor(private readonly changed: () => void) {}
  present(frame: Frame) {
    if (this.closed) return;
    // Not copied: it is encoded before the meter draws its next frame.
    this.frame = frame;
    this.version++;
    this.changed();
  }
  close() {
    this.closed = true;
  }
}

export function createRoot(options: RootOptions = {}): Root {
  const m = metrics();
  const rootNode = makeNode("box", { style: { flexDirection: "column", width: "100%", height: "100%" } });
  const rectListeners = new Set<() => void>();
  live = { root: rootNode, m, rectListeners };

  let info: TerminalInfo = { sixel: false, cell: null };
  let scheduled = false;
  let started = false;
  let stopped = false;
  const scrollQueue: TuiNode[] = [];
  /** Which version of each surface's image is on screen. */
  const shown = new Map<TuiSurface, string>();
  let lastImages = 0;
  let imageTimer: NodeJS.Timeout | null = null;
  /** The last frame drawn, for sending a new meter image without laying everything out again. */
  let lastGrid: Grid | null = null;
  let lastPlaced: Placed[] = [];
  let hovered: TuiNode[] = [];

  const container: Container = {
    root: rootNode,
    committed: () => schedule(),
    scrollLater: (node) => {
      scrollQueue.push(node);
      schedule();
    },
  };
  registerContainer(container);

  const schedule = () => {
    if (scheduled || !started || stopped) return;
    scheduled = true;
    setImmediate(draw);
  };

  const draw = () => {
    scheduled = false;
    if (stopped) return;
    const { cols, rows } = terminal;
    layout(rootNode, cols, rows, m);
    if (scrollQueue.length) {
      for (const node of scrollQueue.splice(0)) scrollIntoView(node);
      layout(rootNode, cols, rows, m);
    }
    for (const listener of rectListeners) listener();

    const grid = new Grid(cols, rows, BACKGROUND);
    const placed = paint(rootNode, grid, BACKGROUND, { colPx: m.colPx, hovered: new Set(hovered) });
    terminal.draw(grid, images(placed));
    lastGrid = grid;
    lastPlaced = placed;
  };

  /**
   * A new meter frame needs only a new image: it is sent on top of the frame
   * already on screen, at most IMAGE_FPS times a second.
   */
  const scheduleImages = () => {
    if (!started || stopped || scheduled || imageTimer) return;
    const wait = Math.max(0, lastImages + 1000 / IMAGE_FPS - Date.now());
    imageTimer = setTimeout(() => {
      imageTimer = null;
      if (scheduled || stopped || !lastGrid) return;
      const out = images(lastPlaced);
      if (out.length) terminal.draw(lastGrid, out);
    }, wait);
  };

  /** The meter as a Sixel image. Terminals without images get the character meter instead. */
  const images = (placed: Placed[]) => {
    const out: Array<{ col: number; row: number; data: string }> = [];
    const now = Date.now();
    for (const p of placed) {
      const surface = p.node.surface as TuiSurface | undefined;
      const frame = surface?.frame;
      if (!surface || !frame || p.visible.cols <= 0 || p.visible.rows <= 0) continue;
      // Only whole images: a meter cut off at the edge of the window waits until it fits again.
      if (!info.cell || p.visible.rows !== p.rect.rows || p.visible.cols !== p.rect.cols) continue;
      const key = `${surface.version}@${p.rect.col},${p.rect.row},${p.rect.cols}x${p.rect.rows}`;
      if (shown.get(surface) === key && !terminal.redrawn) continue;
      if (now - lastImages < 1000 / IMAGE_FPS && !terminal.redrawn) {
        // Too soon: come back for it.
        scheduleImages();
        continue;
      }
      const width = p.rect.cols * info.cell.width;
      const height = p.rect.rows * info.cell.height;
      out.push({ col: p.rect.col, row: p.rect.row, data: sixel(scale(frame, width, height), width, height) });
      shown.set(surface, key);
      lastImages = now;
    }
    return out;
  };

  const px = (node: TuiNode, event: MouseEvent) => ({
    x: (event.col - node.rect!.col + 0.5) * m.colPx,
    y: (event.row - node.rect!.row + 0.5) * m.rowPx,
  });

  const onMouse = (event: MouseEvent) => {
    const path = nodesAt(rootNode, event.col, event.row);
    if (event.kind === "wheel") {
      const box = [...path].reverse().find((n) => n.style.overflow === "scroll");
      if (box) {
        box.scroll = Math.max(0, box.scroll + event.delta * 3);
        schedule();
      }
      return;
    }
    if (event.kind === "move" || event.kind === "press") {
      const now = new Set(path);
      for (const node of hovered) if (!now.has(node)) node.onMouseLeave?.();
      const before = new Set(hovered);
      for (const node of path) if (!before.has(node)) node.onMouseEnter?.();
      hovered = path;
      const mover = [...path].reverse().find((n) => n.onMouseMove);
      mover?.onMouseMove?.(px(mover, event));
      schedule();
    }
    if (event.kind === "press" && event.button === "left") {
      const target = [...path].reverse().find((n) => n.onClick);
      target?.onClick?.(px(target, event));
    }
  };

  const onKey = (event: KeyEvent) => {
    options.onKey?.(event);
  };

  const terminal = new Terminal(onKey, onMouse);
  // The meter draws only as many frames as can be shown.
  const rootInfo: { renderer: "kitty" | "cells"; basePx: number; frameMs: number } = { renderer: "kitty", basePx: m.basePx, frameMs: Math.round(1000 / IMAGE_FPS) };
  const fiber = reconciler.createContainer(container, 0, null, false, null, "", (error) => console.error(error), null);
  let element: ReactNode = null;

  const resize = () => {
    terminal.invalidate();
    options.onResize?.();
    schedule();
  };

  const ready = (async () => {
    await loadLayout();
    info = await terminal.start();
    // Without images the interface draws its character meter instead, as it does under pixel.
    if (!info.sixel || !info.cell) rootInfo.renderer = "cells";
    process.stdout.on("resize", resize);
    started = true;
  })();
  ready.catch((error) => {
    terminal.stop();
    process.stderr.write(`fix-storage: could not start the interface: ${error?.message ?? error}\n`);
    process.exit(1);
  });

  const root: Root = {
    info: rootInfo,
    render(next) {
      element = next;
      void ready.then(() => reconciler.updateContainer(element, fiber, null, null));
    },
    setTitle(title) {
      void ready.then(() => terminal.setTitle(title));
    },
    createSurface: () => new TuiSurface(() => scheduleImages()),
    stop(code = 0) {
      if (stopped) return;
      stopped = true;
      process.stdout.off("resize", resize);
      reconciler.updateContainer(null, fiber, null, null);
      terminal.stop();
      process.exit(code);
    },
  };
  return root;
}
