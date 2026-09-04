/**
 * The colour tokens of docs/DESIGN-TOKENS.md section 1 as data, and the WCAG
 * 2.x contrast maths that goes with them.
 *
 * This exists so the gallery can print every token's computed ratio against
 * canvas and surface beside the swatch. The sheet declares a 4.5:1 floor and
 * asserts the palette clears it. Three tokens do not, in the exact places the
 * component list puts them, so the ratios are printed rather than asserted in
 * prose. See docs/DECISIONS.md, "state colours are indicators, not text".
 */

export interface ColourToken {
  readonly name: string;
  readonly hex: string;
  readonly use: string;
}

export const COLOUR_TOKENS: readonly ColourToken[] = [
  { name: 'canvas', hex: '#FFFFFF', use: 'page background' },
  { name: 'surface', hex: '#F4F5F7', use: 'grouped sections, sheets, form fills' },
  { name: 'hairline', hex: '#E4E6EA', use: 'all separation and depth, always 1px' },
  { name: 'ink', hex: '#000000', use: 'text, primary actions' },
  { name: 'ink-2', hex: '#6B6F76', use: 'secondary text, labels, axis labels, inactive tab' },
  { name: 'ink-3', hex: '#A3A7AE', use: 'placeholder and disabled only' },
  { name: 'covered', hex: '#0B8A4E', use: 'state indicator: money in, active cover, paid' },
  { name: 'watch', hex: '#C77A00', use: 'state indicator: index rising, payment due' },
  { name: 'triggered', hex: '#D13B3B', use: 'state indicator: trigger fired, failed' },
];

export const CANVAS = '#FFFFFF';
export const SURFACE = '#F4F5F7';

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new RangeError(`Not a six digit hex colour: ${hex}`);
  const digits = match[1] as string;
  const r = channel(Number.parseInt(digits.slice(0, 2), 16));
  const g = channel(Number.parseInt(digits.slice(2, 4), 16));
  const b = channel(Number.parseInt(digits.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #rrggbb colours, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Two decimals, the form the gallery prints beside each swatch. */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

/** WCAG 1.4.3: 4.5:1 for body text, 3:1 for large text and non-text indicators. */
export function passesTextFloor(ratio: number, large = false): boolean {
  return ratio >= (large ? 3 : 4.5);
}
