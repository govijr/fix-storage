import { StringDecoder } from "node:string_decoder";
import type { KeyEvent } from "../ui/runtime";
import { enableMouseInput } from "../core/windows";
import type { CellPixels } from "./graphics";
import type { Cell, Grid } from "./paint";

export interface MouseEvent {
  col: number;
  row: number;
  kind: "press" | "release" | "move" | "wheel";
  button: "left" | "middle" | "right" | "none";
  /** For wheel: -1 up, 1 down. */
  delta: number;
}

export interface TerminalInfo {
  sixel: boolean;
  cell: CellPixels | null;
}

const ESC = "\x1b";
const mods = (bits = 0) => ({ shift: !!(bits & 1), alt: !!(bits & 2), ctrl: !!(bits & 4), super: false });
const press = (key: string, m = mods(), text?: string): KeyEvent => ({ key, kind: "press", text, mods: m });

const CSI_KEYS: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "tab" };
const TILDE_KEYS: Record<string, string> = { "1": "home", "2": "insert", "3": "delete", "4": "end", "5": "pageup", "6": "pagedown", "7": "home", "8": "end" };

/**
 * Splits what the terminal sends into keys and mouse events. Returns what is
 * left over: the start of a sequence that has not fully arrived yet.
 */
export function parseInput(data: string, onKey: (event: KeyEvent) => void, onMouse: (event: MouseEvent) => void): string {
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    if (rest[0] === ESC) {
      if (rest.length === 1) return rest;
      // SGR mouse: ESC [ < button ; col ; row (M | m)
      const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest);
      if (mouse) {
        const code = Number(mouse[1]);
        const base = code & 3;
        const button = base === 0 ? "left" : base === 1 ? "middle" : base === 2 ? "right" : "none";
        const event: MouseEvent = { col: Number(mouse[2]) - 1, row: Number(mouse[3]) - 1, kind: "press", button, delta: 0 };
        if (code & 64) Object.assign(event, { kind: "wheel", delta: base === 0 ? -1 : 1 });
        else if (code & 32) event.kind = "move";
        else if (mouse[4] === "m") event.kind = "release";
        onMouse(event);
        i += mouse[0].length;
        continue;
      }
      const csi = /^\x1b\[(?:(\d+)(?:;(\d+))?)?([A-Z~])/.exec(rest) ?? /^\x1bO()()([A-DHF])/.exec(rest);
      if (csi) {
        const [whole, num, mod, final] = csi;
        const m = mods(mod ? Number(mod) - 1 : 0);
        if (final === "Z") onKey(press("tab", { ...m, shift: true }));
        else if (final === "~") {
          const key = TILDE_KEYS[num ?? ""];
          if (key) onKey(press(key, m));
        } else if (CSI_KEYS[final]) onKey(press(CSI_KEYS[final], m));
        i += whole.length;
        continue;
      }
      if (/^\x1b\[[\d;<]*$/.test(rest)) return rest; // incomplete
      // ESC then a key: that key with alt. A lone ESC is escape.
      const next = rest[1];
      if (next && next !== ESC && next !== "[") {
        onKey(press(next.toLowerCase(), { ...mods(), alt: true }, next));
        i += 2;
      } else {
        onKey(press("escape"));
        i += 1;
      }
      continue;
    }
    const ch = rest[0];
    i += ch.length;
    if (ch === "\r" || ch === "\n") onKey(press("enter"));
    else if (ch === "\t") onKey(press("tab"));
    else if (ch === "\x7f" || ch === "\b") onKey(press("backspace"));
    else if (ch === " ") onKey(press("space", mods(), " "));
    else if (ch.charCodeAt(0) < 32) onKey(press(String.fromCharCode(ch.charCodeAt(0) + 96), { ...mods(), ctrl: true }));
    else {
      const lower = ch.toLowerCase();
      onKey(press(lower, { ...mods(), shift: lower !== ch }, ch));
    }
  }
  return "";
}

/** Clicks, movement for hover, and the wheel, in SGR form. */
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1003h${ESC}[?1006h`;

const sgr = (cell: Cell) => `${ESC}[${cell.bold ? 1 : 22};38;2;${cell.fg.join(";")};48;2;${cell.bg.join(";")}m`;
const same = (a: Cell, b: Cell) => a.ch === b.ch && a.bold === b.bold && a.fg.join() === b.fg.join() && a.bg.join() === b.bg.join();

export class Terminal {
  private previous: Grid | null = null;
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private listening: ((data: Buffer) => void) | null = null;
  private replies: ((text: string) => void) | null = null;
  private stopped = false;

  constructor(
    private readonly onKey: (event: KeyEvent) => void,
    private readonly onMouse: (event: MouseEvent) => void,
  ) {}

  get cols() {
    return process.stdout.columns || 80;
  }
  get rows() {
    return process.stdout.rows || 24;
  }

  /** Takes over the terminal: alternate screen, no cursor, raw keys, mouse reporting. */
  async start(): Promise<TerminalInfo> {
    process.stdin.setRawMode?.(true);
    // Mouse reporting is asked for again once the console passes it through.
    enableMouseInput(() => this.stopped || process.stdout.write(MOUSE_ON));
    process.stdin.resume();
    this.listening = (data) => this.input(data);
    process.stdin.on("data", this.listening);
    process.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[2J`);
    const info = await this.ask();
    process.stdout.write(MOUSE_ON);
    return info;
  }

  /**
   * Asks the terminal whether it shows Sixel images (in its device attributes)
   * and how big a cell is in pixels. Terminals that do not answer get neither.
   */
  private ask(): Promise<TerminalInfo> {
    return new Promise((done) => {
      let text = "";
      const finish = () => {
        this.replies = null;
        const attributes = /\x1b\[\?([\d;]+)c/.exec(text)?.[1].split(";") ?? [];
        const size = /\x1b\[6;(\d+);(\d+)t/.exec(text);
        const cell = size ? { height: Number(size[1]), width: Number(size[2]) } : null;
        done({ sixel: attributes.includes("4"), cell: cell && cell.width > 0 && cell.height > 0 ? cell : null });
      };
      const timer = setTimeout(finish, 400);
      this.replies = (chunk) => {
        text += chunk;
        // Device attributes come last, as every terminal answers them.
        if (/\x1b\[\?[\d;]+c/.test(text)) {
          clearTimeout(timer);
          finish();
        }
      };
      process.stdout.write(`${ESC}[16t${ESC}[c`);
    });
  }

  private input(data: Buffer) {
    const text = this.decoder.write(data);
    if (this.replies) return this.replies(text);
    this.pending = parseInput(this.pending + text, this.onKey, this.onMouse);
  }

  stop() {
    this.stopped = true;
    if (this.listening) process.stdin.off("data", this.listening);
    process.stdout.write(`${ESC}[?1006l${ESC}[?1003l${ESC}[?1000l${ESC}[0m${ESC}[?25h${ESC}[?1049l`);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  }

  setTitle(title: string) {
    process.stdout.write(`${ESC}]0;${title}\x07`);
  }

  /** True when the next frame is drawn in full, which wipes any images: they have to be sent again. */
  get redrawn(): boolean {
    return !this.previous || this.previous.cols !== this.cols || this.previous.rows !== this.rows;
  }

  /** Forgets what is on screen, so the next frame is drawn in full (after a resize). */
  invalidate() {
    this.previous = null;
  }

  /**
   * Writes a frame, only the cells that changed since the last one, then any
   * images on top. Wrapped in synchronized output so it never shows half drawn.
   */
  draw(grid: Grid, images: Array<{ col: number; row: number; data: string }>) {
    const old = this.previous && this.previous.cols === grid.cols && this.previous.rows === grid.rows ? this.previous : null;
    let out = `${ESC}[?2026h`;
    // The same frame again, to put new images on it: no cell has changed.
    const unchanged = grid === this.previous;
    if (!old) out += `${ESC}[0m${ESC}[2J`;
    let style = "";
    for (let row = 0; row < grid.rows && !unchanged; row++) {
      let col = 0;
      while (col < grid.cols) {
        const cell = grid.at(col, row)!;
        if (old && same(cell, old.at(col, row)!)) {
          col++;
          continue;
        }
        out += `${ESC}[${row + 1};${col + 1}H`;
        while (col < grid.cols) {
          const c = grid.at(col, row)!;
          if (old && same(c, old.at(col, row)!)) break;
          const s = sgr(c);
          if (s !== style) {
            out += s;
            style = s;
          }
          out += c.ch;
          col++;
        }
      }
    }
    for (const image of images) out += `${ESC}[${image.row + 1};${image.col + 1}H${image.data}`;
    out += `${ESC}[?2026l`;
    process.stdout.write(out);
    this.previous = grid;
  }
}
