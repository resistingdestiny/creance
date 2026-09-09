'use client';

import { PillButton, type PillButtonVariant } from '../pill-button';
import { useQuote } from './quote-state';

/**
 * "Get a quote", docs/DESIGN-TOKENS.md section 8. It appears three times on the
 * landing page, in the navigation, in the hero and in the closing band, and all
 * three open the same quote in the same place.
 *
 * It was a form submitting beginPurchase, which started a session on the server
 * and redirected to /occupation. The quote is now on this page (T35), so the
 * button opens it here instead. Nothing was lost with the redirect: the session
 * is started by the first thing the quote writes, and both routes still work for
 * a link that was already shared.
 */
export function QuoteButton({
  className,
  variant,
}: {
  className?: string;
  variant?: PillButtonVariant;
}) {
  const { start } = useQuote();
  return (
    <PillButton className={className} onClick={start} type="button" variant={variant}>
      Get a quote
    </PillButton>
  );
}
