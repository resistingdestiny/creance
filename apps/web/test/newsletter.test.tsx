import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  NEWSLETTER_NOTICE,
  NEWSLETTER_OUTCOMES,
  newsletterMessage,
  newsletterOutcome,
} from '../src/lib/newsletter-model.js';

/**
 * The newsletter sign up.
 *
 * The interesting tests are the honesty ones. A sign up form is the one place
 * on a page where somebody hands over something of their own, and this product
 * has no mailing list operation behind it: there is no provider, no key and no
 * queue anywhere in the repository. So the page says so, in a sentence a person
 * reads before they type rather than behind a link, and these hold that
 * sentence to what is actually true of the deployment.
 *
 * The action is mocked for the same reason the other screen tests mock the
 * purchase actions: it is a server action, it calls the API and it redirects,
 * and none of that is what this file is about.
 */

vi.mock('../src/app/newsletter-actions.js', () => ({ joinNewsletter: vi.fn() }));

const { NewsletterSignup } = await import('../src/components/landing/newsletter-signup.js');

function visible(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function render(props: Parameters<typeof NewsletterSignup>[0] = {}): string {
  return renderToStaticMarkup(<NewsletterSignup {...props} />);
}

describe('the newsletter form', () => {
  it('is a form with one field and posts before any script has run', () => {
    const markup = render();
    // A form element and a real input. Nothing here is a client component and
    // nothing waits for hydration to be pressable.
    expect(markup).toContain('<form');
    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('required');
    expect(markup).toContain('<button');
  });

  it('gives the field a label a screen reader reaches', () => {
    const markup = render();
    expect(markup).toContain('for="newsletter-email"');
    expect(markup).toContain('id="newsletter-email"');
    expect(visible(markup)).toContain('Email address');
  });

  it('says what happens to the address before anybody types one', () => {
    expect(visible(render())).toContain(NEWSLETTER_NOTICE);
  });

  it('promises no frequency, no launch and no third party', () => {
    const notice = NEWSLETTER_NOTICE.toLowerCase();
    expect(notice).toContain('nothing else');
    expect(notice).toContain('prototype on a test network');
    expect(notice).toContain('there is no mailing list behind it');
    for (const claim of ['weekly', 'monthly', 'every', 'launch', 'unsubscribe', 'partner']) {
      expect(notice).not.toContain(claim);
    }
  });

  it('answers a press in the product voice, and never repeats the address', () => {
    expect(visible(render({ outcome: 'joined' }))).toContain('Thanks. We have your address.');
    expect(visible(render({ outcome: 'invalid' }))).toContain(
      'That does not look like an email address.',
    );
    expect(visible(render({ outcome: 'failed' }))).toContain('That did not save.');
  });

  it('says nothing at all until something has been pressed', () => {
    expect(render()).not.toContain('newsletter-answer');
  });

  it('carries no em dash, no en dash and no percent glyph', () => {
    for (const outcome of NEWSLETTER_OUTCOMES) {
      expect(visible(render({ outcome }))).not.toMatch(/[–—%]/);
    }
  });

  it('draws on either of the two grounds the landing page has', () => {
    expect(render({ tone: 'night' })).toContain('data-tone="night"');
    expect(render({ tone: 'night' })).toContain('text-white');
    expect(render({ tone: 'day' })).not.toContain('data-tone="night"');
    expect(render({ tone: 'day' })).toContain('text-ink');
  });
});

describe('what the address bar is allowed to say', () => {
  it('reads back only the three codes it writes', () => {
    for (const outcome of NEWSLETTER_OUTCOMES) expect(newsletterOutcome(outcome)).toBe(outcome);
  });

  it('falls back rather than erroring on anything else', () => {
    for (const rubbish of [undefined, '', 'joined ', 'Thanks for signing up', '../../etc']) {
      expect(newsletterOutcome(rubbish)).toBeNull();
    }
  });

  it('treats a repeat exactly as a first sign up, because the API will not say', () => {
    // There is no fourth outcome for "already on the list" and there must not
    // be: the endpoint answers both identically so that nobody can use the
    // form to find out whether somebody else signed up.
    expect(NEWSLETTER_OUTCOMES).toHaveLength(3);
    expect(newsletterMessage('joined').done).toBe(true);
    expect(newsletterMessage('joined').line).not.toContain('already');
  });
});
