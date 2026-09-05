'use client';

import { MiniKit } from '@worldcoin/minikit-js';
import { createContext, useContext } from 'react';

/**
 * Which surface the app is running on, behind one helper.
 *
 * The same web app is both a website and a World App Mini App. Inside World App
 * IDKit uses the native transport and shows no QR code, and nothing about the
 * request, the signature or the verify path changes, so the surface only ever
 * decides what a screen says, never what the check is.
 *
 * `MiniKit.isInstalled()` is the accessor the getting started page names for
 * telling the two apart, and it is the honest one here because it is true only
 * once the provider's install has run, which is also the moment a command could
 * be sent. It logs a console warning every time it answers false, and in a
 * browser that is every render, so the pure `isInWorldApp()` test goes first:
 * outside World App there is nothing installed and nothing worth warning about.
 *
 * https://docs.world.org/mini-apps/quick-start/installing
 * https://docs.world.org/world-id/idkit/mini-apps
 */

export type Surface = 'world-app' | 'browser';

/**
 * The surface as the SDK sees it right now. Client side only: `window.WorldApp`
 * is what both accessors read, and on the server there is no window at all.
 */
export function detectSurface(): Surface {
  if (typeof window === 'undefined') return 'browser';
  if (!MiniKit.isInWorldApp()) return 'browser';
  return MiniKit.isInstalled() ? 'world-app' : 'browser';
}

/**
 * `browser` by default, which is what the server renders and what the first
 * client render agrees on, so the surface never causes a hydration mismatch. It
 * changes once, after the provider has installed MiniKit.
 */
export const SurfaceContext = createContext<Surface>('browser');

export function useSurface(): Surface {
  return useContext(SurfaceContext);
}
