/**
 * The part of pixel the interface uses. pixel is an optional dependency, as it
 * has no Windows build, so its types are declared here rather than imported:
 * the code still compiles where pixel is not installed. They follow pixel's own.
 */
import type { ForwardRefExoticComponent, ReactNode, RefAttributes, RefObject } from "react";

export type Rgba = [number, number, number, number];
export type Color = Rgba | [number, number, number] | string;

export interface Edges {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

type Length = number | `${number}%` | "auto";

export interface Style {
  flexDirection?: "row" | "column";
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: Length;
  width?: Length;
  height?: Length;
  minWidth?: Length;
  maxWidth?: Length;
  maxHeight?: Length;
  padding?: number | Edges;
  margin?: number | Edges;
  gap?: number;
  overflow?: "visible" | "hidden" | "scroll";
  justifyContent?: "start" | "center" | "end" | "space-between";
  alignItems?: "start" | "center" | "end" | "stretch";
  background?: Color;
  cornerRadius?: number;
  color?: Color;
  fontSize?: number;
  fontFamily?: string | string[];
  fontWeight?: number | "normal" | "bold";
  hoverColor?: Color;
  wrap?: boolean;
  ellipsis?: boolean;
  selectable?: boolean;
  pointerShape?: "default" | "pointer";
  scrollbar?: { width?: number; thumbColor?: Color };
}

export interface ClickEvent {
  /** Where, from the top left of the box, in pixels. */
  x: number;
  y: number;
}

export type MouseMoveEvent = ClickEvent;

export interface NodeHandle {
  id: number;
  /** Scrolls the nearest scrolling box above it until the node is in view. */
  scrollIntoView(smooth?: boolean): void;
}

export interface Surface {
  present(frame: { bgra: Buffer; width: number; height: number }): void;
  close(): void;
}

export interface BoxProps {
  style?: Style;
  surface?: Surface;
  onClick?: (event: ClickEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onMouseMove?: (event: MouseMoveEvent) => void;
  children?: ReactNode;
}

export interface TextProps {
  style?: Style;
  onClick?: (event: ClickEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children?: ReactNode;
}

export interface KeyEvent {
  key: string;
  kind: "press" | "repeat" | "release";
  text?: string;
  mods: { shift: boolean; alt: boolean; ctrl: boolean; super: boolean };
}

export interface RootInfo {
  /** "cells" when the terminal shows characters only; anything else can show pixels. */
  renderer?: "kitty" | "cells";
  /** Height of a line of text, in pixels. */
  basePx: number;
}

export interface Root {
  readonly info: RootInfo;
  render(element: ReactNode): void;
  setTitle(title: string): void;
  createSurface(): Surface;
  stop(code?: number): void;
}

export interface RootOptions {
  name?: string;
  onKey?: (event: KeyEvent) => boolean | void;
  onResize?: () => void;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Runtime {
  Box: ForwardRefExoticComponent<BoxProps & RefAttributes<NodeHandle>>;
  Text: ForwardRefExoticComponent<TextProps & RefAttributes<NodeHandle>>;
  useRect(ref: RefObject<NodeHandle | null>): Rect | null;
  createRoot(options?: RootOptions): Root;
}

// Loaded by name, so nothing needs pixel until the interactive view starts.
const runtime: Runtime = require("@zenbu-labs/pixel");

export const { Box, Text, useRect, createRoot } = runtime;
