import type { Rgb } from './png.ts';

// Band colors for projects. Embedded in the source (nothing is read
// at runtime). Hues avoid the state ring's green, yellow and red. Four entries were darkened (same hue, lower lightness) so white band text
// reaches WCAG contrast 3.0; see the notes on each line. The first entry
// is the default blue used for keys without a project.
export const PROJECT_PALETTE: readonly Rgb[] = [
  [0x3b, 0x82, 0xf6], // #3b82f6
  [0x8b, 0x5c, 0xf6], // #8b5cf6
  [0xd9, 0x46, 0xef], // #d946ef
  [0x05, 0xa2, 0xbd], // #05a2bd (was #06b6d4, white contrast 2.43 -> 3.04)
  [0xde, 0x7a, 0x38], // #de7a38 (was #e07b39, white contrast 2.97 -> 3.02)
  [0xe3, 0x6a, 0xa9], // #e36aa9 (was #f472b6, white contrast 2.65 -> 3.04)
  [0x12, 0xa6, 0x95], // #12a695 (was #14b8a6, white contrast 2.49 -> 3.04)
];

export const DEFAULT_PROJECT_COLOR: Rgb = [0x3b, 0x82, 0xf6];

// FNV-1a 32-bit over UTF-16 code units: pure, stateless, stable across restarts.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Stable band color for a project name; blank names keep the default blue. */
export function projectColor(name: string): Rgb {
  const key = name.trim().toLowerCase();
  if (!key) return [...DEFAULT_PROJECT_COLOR];
  const color = PROJECT_PALETTE[fnv1a(key) % PROJECT_PALETTE.length]!;
  return [color[0], color[1], color[2]];
}
