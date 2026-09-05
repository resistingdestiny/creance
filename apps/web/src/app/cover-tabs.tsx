'use client';

import { useRouter } from 'next/navigation';

import { TabBar, type TabId } from '../components/tab-bar';

/**
 * The two tab bar, wired to the two routes it names.
 *
 * docs/DESIGN-TOKENS.md gives the bar two tabs and does not say where it lives.
 * It lives on Home and on the Index tab and nowhere else: not during a purchase,
 * not during a claim, not on the investor screens.
 */

const HREF: Record<TabId, string> = { cover: '/home', index: '/cover/index' };

export function CoverTabs({ active }: { active: TabId }) {
  const router = useRouter();
  return <TabBar active={active} onSelect={(id) => router.push(HREF[id])} />;
}
