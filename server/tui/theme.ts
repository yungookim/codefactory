import type { FeedbackStatus, PR } from "@shared/schema";

export const color = {
  accent: "cyan",
  ok: "green",
  warn: "yellow",
  err: "red",
  info: "magenta",
  muted: "gray",
} as const;

export type ThemeColor = (typeof color)[keyof typeof color];

export const glyph = {
  focus: "❯",
  bullet: "•",
  dot: "●",
  ring: "○",
  running: "◐",
  check: "✓",
  cross: "✗",
  warn: "!",
  pause: "⏸",
  caret: "›",
  sep: "│",
  collapsed: "▸",
  expanded: "▾",
} as const;

export function prStatusTone(status: PR["status"]): ThemeColor {
  if (status === "processing") return color.info;
  if (status === "done") return color.ok;
  if (status === "error") return color.err;
  if (status === "archived") return color.muted;
  return color.accent;
}

export function prStatusGlyph(status: PR["status"]): string {
  if (status === "processing") return glyph.running;
  if (status === "done") return glyph.check;
  if (status === "error") return glyph.cross;
  if (status === "archived") return glyph.ring;
  return glyph.dot;
}

export function feedbackTone(status: FeedbackStatus): ThemeColor {
  if (status === "resolved") return color.ok;
  if (status === "rejected") return color.muted;
  if (status === "failed") return color.err;
  if (status === "warning") return color.warn;
  if (status === "in_progress") return color.info;
  if (status === "queued") return color.accent;
  return color.muted;
}

export function feedbackGlyph(status: FeedbackStatus): string {
  if (status === "resolved") return glyph.check;
  if (status === "rejected") return glyph.cross;
  if (status === "failed") return glyph.cross;
  if (status === "warning") return glyph.warn;
  if (status === "in_progress") return glyph.running;
  if (status === "queued") return glyph.ring;
  return glyph.bullet;
}
