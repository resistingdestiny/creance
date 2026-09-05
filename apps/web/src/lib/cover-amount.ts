/**
 * The cover amounts on offer, docs/DESIGN-TOKENS.md section 7: 1,000 to 10,000
 * in steps of 500, which is nineteen positions on the slider.
 *
 * They live here rather than beside the slider because the server needs them
 * too, to open the Amount screen at a limit and to price it, and a constant
 * exported from a 'use client' module reaches the server as a stub that throws
 * when it is read. The API validates the same range in apps/api/src/pricing.ts,
 * which is what actually enforces it.
 */

export const AMOUNT_MIN = 1000;
export const AMOUNT_MAX = 10_000;
export const AMOUNT_STEP = 500;

/** Where the slider opens. DESIGN.md 3.4's demo limit. */
export const AMOUNT_DEFAULT = 5_000;
