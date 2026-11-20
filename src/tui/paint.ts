import type { Color } from "../ui/runtime";
import { contentRows } from "./layout";
import { textOf, type CellRect, type TuiNode } from "./nodes";
import { charWidth, lines, truncate } from "./text";

export type Rgb = [number, number, number];

export interface Cell {
  /** One character, or "" for the second half of a wide one. */
  ch: string;
  fg: Rgb;
  bg: Rgb;
  bold: boolean;
}

export class Grid {
  readonly cells: Cell[];
  constructor(
    readonly cols: number,
    readonly rows: number,
    background: Rgb,
  ) {
    this.cells = Array.from({ length: cols * rows }, () => ({ ch: " ", fg: [230, 230, 230], bg: background, bold: false }));
  }
  at(col: number, row: number): Cell | undefined {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return undefined;
    return this.cells[row * this.cols + col];
  }
}

/** A box drawing pixels (the disk meter), and the cells it may draw into. */
export interface Placed {
  node: TuiNode;
  rect: CellRect;
  /** The part of rect that is on screen. */
  visible: CellRect;
  background: Rgb;
}

export function parseColor(color: Color | undefined): [number, number, number, number] | undefined {
  if (color === undefined) return undefined;
  if (Array.isArray(color)) return [color[0], color[1], color[2], color.length > 3 ? (color as number[])[3] / 255 : 1];
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color)?.[1];
  if (!hex) return undefined;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
}

function blend(color: [number, number, number, number], under: Rgb): Rgb {
  const a = color[3];
  return [0, 1, 2].map((i) => Math.round(color[i] * a + under[i] * (1 - a))) as Rgb;
}

const clipTo = (a: CellRect, b: CellRect): CellRect => {
  const col = Math.max(a.col, b.col);
  const row = Math.max(a.row, b.row);
  const cols = Math.min(a.col + a.cols, b.col + b.cols) - col;
  const rows = Math.min(a.row + a.rows, b.row + b.rows) - row;
  return { col, row, cols: Math.max(0, cols), rows: Math.max(0, rows) };
};

const inside = (r: CellRect, col: number, row: number) => col >= r.col && row >= r.row && col < r.col + r.cols && row < r.row + r.rows;

/**
 * A dot of a dot-matrix bar: a round box smaller than a character. A row of
 * them is drawn as • characters, spread over the cells the row was given.
 */
function isDot(node: TuiNode, colPx: number): boolean {
  const { width, cornerRadius, background } = node.style;
  return node.type === "box" && !!cornerRadius && !!background && typeof width === "number" && width < colPx && node.children.length === 0;
}

export interface PaintOptions {
  colPx: number;
  /** Nodes under the mouse, for hover colors. */
  hovered: Set<TuiNode>;
}

export function paint(root: TuiNode, grid: Grid, background: Rgb, options: PaintOptions): Placed[] {
  const placed: Placed[] = [];
  const screen: CellRect = { col: 0, row: 0, cols: grid.cols, rows: grid.rows };

  const fill = (rect: CellRect, bg: Rgb) => {
    for (let row = rect.row; row < rect.row + rect.rows; row++)
      for (let col = rect.col; col < rect.col + rect.cols; col++) {
        const cell = grid.at(col, row)!;
        cell.bg = bg;
        cell.ch = " ";
      }
  };

  const put = (col: number, row: number, ch: string, fg: Rgb, bold: boolean, clip: CellRect) => {
    if (!inside(clip, col, row)) return;
    const cell = grid.at(col, row);
    if (!cell) return;
    cell.ch = ch;
    cell.fg = fg;
    cell.bold = bold;
  };

  const dots = (node: TuiNode, rect: CellRect, clip: CellRect, bg: Rgb) => {
    const kids = node.children;
    for (let i = 0; i < rect.cols; i++) {
      const dot = kids[Math.min(kids.length - 1, Math.floor((i * kids.length) / rect.cols))];
      const color = parseColor(dot.style.background)!;
      const shade = blend(color, bg);
      // An unlit dot is nearly the background; a dim · keeps the row readable.
      const lit = shade[0] + shade[1] + shade[2] > 90;
      put(rect.col + i, rect.row, lit ? "•" : "·", lit ? shade : [58, 58, 58], false, clip);
    }
  };

  const visit = (node: TuiNode, clip: CellRect, bg: Rgb) => {
    const rect = node.rect;
    if (!rect) return;
    const style = node.style;

    if (node.type === "text" || node.type === "raw") {
      const color = parseColor(options.hovered.has(node) && style.hoverColor ? style.hoverColor : style.color) ?? [230, 230, 230, 1];
      const fg = blend(color, bg);
      const bold = style.fontWeight === "bold" || (typeof style.fontWeight === "number" && style.fontWeight >= 600);
      const text = textOf(node);
      const rows = style.wrap ? lines(text, Math.max(1, rect.cols)) : [text];
      rows.slice(0, Math.max(1, rect.rows)).forEach((line, r) => {
        let col = rect.col;
        for (const ch of truncate(line, rect.cols, style.ellipsis === true)) {
          const w = charWidth(ch);
          put(col, rect.row + r, ch, fg, bold, clip);
          if (w === 2) put(col + 1, rect.row + r, "", fg, bold, clip);
          col += w;
        }
      });
      return;
    }

    let under = bg;
    const backgroundColor = parseColor(style.background);
    if (backgroundColor && !isDot(node, options.colPx)) {
      under = blend(backgroundColor, bg);
      fill(clipTo(rect, clip), under);
    }

    if (node.children.length > 2 && node.children.every((child) => isDot(child, options.colPx))) {
      dots(node, rect, clip, under);
      return;
    }
    if (isDot(node, options.colPx)) {
      const shade = blend(backgroundColor!, bg);
      put(rect.col, rect.row, "•", shade, false, clip);
      return;
    }

    const inner = style.overflow === "hidden" || style.overflow === "scroll" ? clipTo(clip, rect) : clip;
    if (node.surface) placed.push({ node, rect, visible: clipTo(inner, rect), background: under });
    for (const child of node.children) visit(child, inner, under);

    if (style.overflow === "scroll") {
      const total = contentRows(node);
      if (total > rect.rows && rect.rows > 0) {
        const thumb = Math.max(1, Math.round((rect.rows * rect.rows) / total));
        const at = Math.round((node.scroll / Math.max(1, total - rect.rows)) * (rect.rows - thumb));
        const color = parseColor(style.scrollbar?.thumbColor) ?? [42, 42, 42, 1];
        for (let i = 0; i < thumb; i++) put(rect.col + rect.cols - 1, rect.row + at + i, "▕", blend(color, under), false, clip);
      }
    }
  };

  visit(root, screen, background);
  return placed;
}

/** The deepest node at a cell, and every node above it. */
export function nodesAt(root: TuiNode, col: number, row: number): TuiNode[] {
  const path: TuiNode[] = [];
  const visit = (node: TuiNode, clip: CellRect) => {
    if (!node.rect || !inside(clipTo(node.rect, clip), col, row)) return;
    path.push(node);
    const inner = node.style.overflow === "hidden" || node.style.overflow === "scroll" ? clipTo(clip, node.rect) : clip;
    // Later children are drawn on top, so they are hit first.
    for (let i = node.children.length - 1; i >= 0; i--) {
      const before = path.length;
      visit(node.children[i], inner);
      if (path.length > before) return;
    }
  };
  visit(root, { col: 0, row: 0, cols: Number.MAX_SAFE_INTEGER, rows: Number.MAX_SAFE_INTEGER });
  return path;
}
