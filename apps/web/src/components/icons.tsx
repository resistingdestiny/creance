/**
 * The glyphs the sheet names, all black with a 2px stroke, all decorative.
 * Every one is aria-hidden: the row's label carries the meaning.
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

/**
 * The menu glyph, three rules, on the header's disclosure below the medium
 * breakpoint. It is the one control in the product whose label is a picture,
 * because at 360 the bar has room for the mark, the primary action and about
 * fifty pixels, and fifty pixels is not a word. The summary carries the word
 * "Menu" for anything that reads the page rather than looks at it.
 */
export function MenuGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="18"
      viewBox="0 0 18 18"
      width="18"
    >
      <path
        d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * The upload glyph: a tray with an arrow rising out of it. It stands in the
 * drop area, which is the one place in the product where a control has to say
 * what it is before it says what it does.
 */
export function UploadGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="24"
      viewBox="0 0 24 24"
      width="24"
    >
      <path
        d="M12 15V4m0 0L8 8m4-4l4 4M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
