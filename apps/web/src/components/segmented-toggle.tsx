'use client';

/**
 * A pill container on surface holding two or three options, the active one
 * lifted onto canvas with a hairline border and the rest in ink-2. It is a
 * radiogroup, so the arrow keys move between the options and only the active
 * option is in the tab order, which is the platform behaviour for a set of
 * radios and the reason not to build this out of buttons.
 */

export interface SegmentedOption {
  readonly id: string;
  readonly label: string;
}

export function SegmentedToggle({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: readonly SegmentedOption[];
  active: string;
  onSelect?: (id: string) => void;
}) {
  const move = (delta: number) => {
    const current = options.findIndex((option) => option.id === active);
    const next = options[(current + delta + options.length) % options.length];
    if (next && onSelect) onSelect(next.id);
  };

  return (
    <div
      aria-label={label}
      className="inline-flex rounded-full bg-surface p-1"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
      role="radiogroup"
    >
      {options.map((option) => {
        const current = option.id === active;
        return (
          <button
            aria-checked={current}
            className={[
              'min-h-9 rounded-full px-4 text-button font-medium',
              current ? 'border border-hairline bg-canvas text-ink' : 'text-ink-2',
            ].join(' ')}
            key={option.id}
            onClick={onSelect ? () => onSelect(option.id) : undefined}
            role="radio"
            tabIndex={current ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
