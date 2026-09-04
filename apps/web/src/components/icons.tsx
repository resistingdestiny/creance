/**
 * The two glyphs the sheet names, both black with a 2px stroke, both
 * decorative. Every one is aria-hidden: the row's label carries the meaning.
 */

export function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M6 3l5 5-5 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function Check({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M3 8.5l3.5 3.5L13 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function CopyGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <rect
        height="9"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        width="9"
        x="5.75"
        y="5.75"
      />
      <path
        d="M3.25 10.25A1.5 1.5 0 0 1 2 8.75v-5a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 1.5 1.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
