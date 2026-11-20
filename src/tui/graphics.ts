/** A frame a surface presented: BGRA, as the disk meter draws it. */
export interface Frame {
  bgra: Buffer;
  width: number;
  height: number;
}

/** Real size of one terminal cell in pixels, when the terminal says. */
export interface CellPixels {
  width: number;
  height: number;
}

/** Scales a frame to an exact size by averaging the pixels each new pixel covers. */
export function scale(frame: Frame, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  const sx = frame.width / width;
  const sy = frame.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < frame.height; yy++) {
        for (let xx = x0; xx < x1 && xx < frame.width; xx++) {
          const i = (yy * frame.width + xx) * 4;
          b += frame.bgra[i];
          g += frame.bgra[i + 1];
          r += frame.bgra[i + 2];
          n++;
        }
      }
      const o = (y * width + x) * 3;
      out[o] = n ? r / n : 0;
      out[o + 1] = n ? g / n : 0;
      out[o + 2] = n ? b / n : 0;
    }
  }
  return out;
}

/**
 * Encodes RGB pixels as Sixel, the image format Windows Terminal and WezTerm
 * show in place of characters. Black is left transparent, so the black cells
 * underneath show through. Colors are reduced to 255 at most.
 *
 * It runs for every frame of the meter's animation, so it works in typed
 * arrays: one pass to count colors, one to map pixels to palette entries, and
 * one per band of six rows to set each color's bits.
 */
export function sixel(rgb: Uint8Array, width: number, height: number): string {
  const pixels = width * height;
  const dark = (i: number) => rgb[i] + rgb[i + 1] + rgb[i + 2] < 24;

  // Count colors at decreasing precision until they fit in the palette.
  let shift = 2;
  let counts: Uint32Array;
  let distinct: number;
  const key = (i: number) => ((rgb[i] >> shift) << (16 - 2 * shift)) | ((rgb[i + 1] >> shift) << (8 - shift)) | (rgb[i + 2] >> shift);
  for (;;) {
    counts = new Uint32Array(1 << (3 * (8 - shift)));
    distinct = 0;
    for (let i = 0; i < pixels * 3; i += 3) {
      if (dark(i)) continue;
      if (counts[key(i)]++ === 0) distinct++;
    }
    if (distinct <= 255 || shift >= 5) break;
    shift++;
  }
  const bits = 8 - shift;
  const keys: number[] = [];
  counts.forEach((count, k) => {
    if (count) keys.push(k);
  });
  const palette = keys.sort((a, b) => counts[b] - counts[a]).slice(0, 255);
  const level = (k: number, channel: number) => (((k >> (channel * bits)) & ((1 << bits) - 1)) << shift) + (1 << (shift - 1));
  const register = new Int16Array(counts.length).fill(-1);
  palette.forEach((k, n) => (register[k] = n + 1));
  const nearest = (k: number) => {
    let best = 1;
    let distance = Infinity;
    palette.forEach((p, n) => {
      let d = 0;
      for (let c = 0; c < 3; c++) d += (level(p, c) - level(k, c)) ** 2;
      if (d < distance) {
        distance = d;
        best = n + 1;
      }
    });
    return best;
  };

  const color = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p++) {
    const i = p * 3;
    if (dark(i)) continue;
    const k = key(i);
    if (register[k] < 0) register[k] = nearest(k);
    color[p] = register[k];
  }

  const parts: string[] = [`\x1bP0;1;0q"1;1;${width};${height}`];
  palette.forEach((k, n) => {
    const pct = (c: number) => Math.round((Math.min(255, level(k, c)) / 255) * 100);
    parts.push(`#${n + 1};2;${pct(2)};${pct(1)};${pct(0)}`);
  });
  const rows = new Map<number, Uint8Array>();
  for (let top = 0; top < height; top += 6) {
    rows.clear();
    for (let b = 0; b < 6 && top + b < height; b++) {
      const offset = (top + b) * width;
      for (let x = 0; x < width; x++) {
        const c = color[offset + x];
        if (!c) continue;
        let row = rows.get(c);
        if (!row) rows.set(c, (row = new Uint8Array(width)));
        row[x] |= 1 << b;
      }
    }
    for (const [c, row] of rows) {
      let line = `#${c}`;
      let x = 0;
      // Leave off what follows the last pixel of this color.
      let end = width;
      while (end > 0 && row[end - 1] === 0) end--;
      while (x < end) {
        const value = row[x];
        let run = 1;
        while (x + run < end && row[x + run] === value) run++;
        const ch = String.fromCharCode(63 + value);
        line += run > 3 ? `!${run}${ch}` : ch.repeat(run);
        x += run;
      }
      parts.push(line + "$");
    }
    parts.push("-");
  }
  parts.push("\x1b\\");
  return parts.join("");
}
