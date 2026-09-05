/// The Mini App surface's entry points, built where the ids already live.
///
/// The same web app is a website and a World App Mini App, and a Mini App is
/// entered in three ways: launched from its own link, opened at a path by a
/// universal link, or opened at a path from a notification. All three are the
/// same two values, a Mini App id and a path, so they are built here rather than
/// written into a document that then drifts from the app.
///
/// The Mini App id is not the World ID app id. Both are `app_...` strings from
/// the same Developer Portal and they are not interchangeable: MiniKit is
/// initialised with the Mini App id, while IDKit takes the World ID app id, the
/// rp id, the action and the signing key. Two fields, two variables, and the
/// docs say so in as many words.
///
/// https://docs.world.org/mini-apps/sharing/quick-actions
/// https://docs.world.org/world-id/idkit/mini-apps
/// https://docs.world.org/mini-apps/commands/how-to-send-notifications

/** The universal link form, which falls back to the app store when World App is absent. */
const UNIVERSAL = 'https://world.org/mini-app';

/** The custom scheme form. It is what `mini_app_path` takes in a notification. */
const SCHEME = 'worldapp://mini-app';

export interface MiniAppEntry {
  /** The path inside the app the link opens, absolute and without a query. */
  path: string;
  /** The link a person can tap or a QR code can carry. */
  url: string;
  /** The same target as `mini_app_path` for the send-notification endpoint. */
  miniAppPath: string;
}

/**
 * The link that opens the Mini App at its own start.
 *
 * The docs give this host in the quick actions schema and the SDK's own helper
 * builds the same one. The Portal's testing page defaults its QR generator to
 * `worldcoin.org` instead, which is the legacy domain; `world.org` is the one to
 * publish.
 */
export function miniAppLaunchUrl(appId: string): string {
  return link(UNIVERSAL, appId, undefined);
}

/**
 * One deep link, at a path.
 *
 * The path is encoded once, which is what the quick actions page asks for: "the
 * url encoded path where you want to link to inside of your mini app". Note that
 * `MiniKit.getMiniAppUrl` in the SDK encodes it twice, once itself and once
 * through the query serialiser, so the two do not agree; the documented form is
 * the one published here. Recorded in the feedback for World.
 */
export function miniAppEntry(appId: string, path: string): MiniAppEntry {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return {
    path: absolute,
    url: link(UNIVERSAL, appId, absolute),
    miniAppPath: link(SCHEME, appId, absolute),
  };
}

/** The path that opens one occupation's index page, named in the path itself. */
export function occupationIndexPath(groupKey: string): string {
  return `/cover/index/${groupKey}`;
}

function link(base: string, appId: string, path: string | undefined): string {
  const url = new URL(base);
  url.searchParams.set('app_id', appId);
  if (path !== undefined) url.searchParams.set('path', path);
  return url.toString();
}
