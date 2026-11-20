/** How many columns a character takes: 2 for wide East Asian characters and most emoji, 0 for combining marks. */
export function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0) return 0;
  if ((code >= 0x300 && code <= 0x36f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
    return 2;
  return 1;
}

export function width(text: string): number {
  let total = 0;
  for (const char of text) total += charWidth(char);
  return total;
}

/** Cuts text to fit `cols`, ending in … when anything was cut. */
export function truncate(text: string, cols: number, ellipsis: boolean): string {
  if (width(text) <= cols) return text;
  const room = ellipsis ? cols - 1 : cols;
  let out = "";
  let used = 0;
  for (const char of text) {
    const w = charWidth(char);
    if (used + w > room) break;
    out += char;
    used += w;
  }
  return ellipsis && cols > 0 ? out + "…" : out;
}

/** Wraps text at spaces to lines of at most `cols` columns, breaking long words. */
export function lines(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      if (width(line + word) <= cols) {
        line += word;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = word.trimStart();
      while (width(line) > cols) {
        const head = truncate(line, cols, false);
        out.push(head);
        line = line.slice(head.length);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
