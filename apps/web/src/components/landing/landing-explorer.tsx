'use client';

import { ExplorerPanel } from '../../app/index/explorer-panel';
import type { ExplorerData } from '../../lib/explorer-data';
import { useQuote } from './quote-state';

/**
 * The public index explorer on the landing page, pointed at the occupation the
 * inline quote is for.
 *
 * It is the same ExplorerPanel `/index` renders with the same round (T34). The
 * only thing this adds is the occupation, which comes from the quote above it,
 * so picking an occupation to be quoted and reading that occupation's index are
 * one act rather than two. Before anything is picked the panel opens where it
 * always opened, and afterwards the reader is still free to pick any of the
 * fifteen here.
 */
export function LandingExplorer({ data }: { data: ExplorerData }) {
  const { group } = useQuote();
  return <ExplorerPanel data={data} follows={group} />;
}
