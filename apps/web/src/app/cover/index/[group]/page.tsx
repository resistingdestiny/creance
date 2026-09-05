import { redirect } from 'next/navigation';

import { findOccupation } from '../../../../lib/occupations';

/**
 * The entry point a deep link opens: one occupation's index page, named in the
 * path.
 *
 * The Index tab itself reads the occupation from `?group=`, which is the right
 * shape for a tab someone is already inside. A link that arrives from outside is
 * a different thing: World App takes the path to open as one url encoded value,
 * and nothing in the documentation says whether a query string survives inside
 * it, so the entry a deep link uses carries the occupation in the path and then
 * hands over to the tab.
 *
 * It works cold, with no session and no cover, which is the whole point: the
 * link is for someone who has not bought anything yet.
 *
 * https://docs.world.org/mini-apps/sharing/quick-actions
 */

export const dynamic = 'force-dynamic';

export default async function OccupationIndexEntry({
  params,
}: {
  params: Promise<{ group: string }>;
}) {
  const { group } = await params;
  if (findOccupation(group) === null) redirect('/');
  redirect(`/cover/index?group=${encodeURIComponent(group)}`);
}
