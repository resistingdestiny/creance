'use server';

import { redirect } from 'next/navigation';

import { openWithCoverKey } from '../../purchase-actions';

/**
 * Opening a published cover, which is opening a cover with its key and nothing
 * else.
 *
 * It forwards the form whole to the action the cover key field already posts
 * to, so there is one path into a cover session and this is not a second one.
 * That action redirects to the dashboard when the API accepts the key, so
 * arriving at the line below at all means the key was refused, and the page
 * says so rather than leaving a button that appears to do nothing.
 */
export async function openPublishedCover(formData: FormData): Promise<void> {
  await openWithCoverKey(formData);
  redirect('/home/demo?refused=1');
}
