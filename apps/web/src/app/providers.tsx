'use client';

import { MiniKitProvider, useMiniKit } from '@worldcoin/minikit-js/minikit-provider';
import type { ReactNode } from 'react';

import { detectSurface, SurfaceContext } from '../lib/surface';

/**
 * MiniKit, installed once around the whole app.
 *
 * The provider is the documented way in: it calls `MiniKit.install()` in an
 * effect and does nothing at all outside World App, where install returns
 * `outside_of_worldapp` and the app carries on as the website it already was.
 *
 * It is mounted without an app id. The only reason to pass one is a MiniKit
 * command, and this build calls none: the value settles on Hedera testnet, so
 * nothing here sends a World Chain transaction, a payment or a signature, and
 * World App is used for exactly one thing, holding the person's World ID while
 * IDKit runs the Selfie Check. IDKit takes the World ID app id as a prop, which
 * is a different value from the Mini App app id and still arrives with the
 * signed request context from the API. See docs/DECISIONS.md under T27.
 *
 * No route is taken client only for this. The documented hydration hazard is
 * reading `window.WorldApp` while rendering; the surface here is read from the
 * provider's own post-install state instead, so the server and the first client
 * render agree and the canonical index page stays server rendered.
 *
 * https://docs.world.org/mini-apps/quick-start/installing
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MiniKitProvider>
      <Surface>{children}</Surface>
    </MiniKitProvider>
  );
}

/**
 * The surface, published to the tree.
 *
 * A parent's effect runs after its children's, so the provider installs MiniKit
 * after a screen has already mounted, and a screen that asks on mount is asking
 * too early. The provider's own flag is what says install has run, so it is read
 * here as the trigger to ask again rather than as the answer: it is false for an
 * out of date World App, which is still World App and still runs the native
 * IDKit transport, because that transport is not a MiniKit command.
 */
function Surface({ children }: { children: ReactNode }) {
  const { isInstalled } = useMiniKit();
  const surface = isInstalled === undefined ? 'browser' : detectSurface();
  return <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>;
}
