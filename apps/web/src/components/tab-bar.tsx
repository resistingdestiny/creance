/**
 * docs/DESIGN-TOKENS.md section 7: two tabs and no more, 80px high, hairline
 * on top. The active label is ink. The inactive label moves from ink-3 to
 * ink-2, because a tab label is information and ink-3 is 2.41:1 on canvas. Two
 * greys still read as a clear active state. See docs/DECISIONS.md.
 */

export type TabId = 'cover' | 'index';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'cover', label: 'Cover' },
  { id: 'index', label: 'Index' },
];

export function TabBar({ active, onSelect }: { active: TabId; onSelect?: (id: TabId) => void }) {
  return (
    <nav
      aria-label="Sections"
      className="flex h-20 items-start border-t border-hairline bg-canvas"
    >
      {TABS.map((tab) => {
        const current = tab.id === active;
        return (
          <button
            aria-current={current ? 'page' : undefined}
            className={[
              'flex min-h-11 flex-1 items-center justify-center pt-4 text-secondary font-medium',
              current ? 'text-ink' : 'text-ink-2',
            ].join(' ')}
            key={tab.id}
            onClick={onSelect ? () => onSelect(tab.id) : undefined}
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
