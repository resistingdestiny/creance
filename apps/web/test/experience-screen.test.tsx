// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/app/purchase-actions', () => ({ chooseBand: vi.fn() }));

const { ExperienceScreen } = await import('../src/app/experience/experience-screen');
const { BAND_EFFECT, BAND_NOT_FUNDED } = await import('../src/lib/bands');

/// The experience question.
///
/// What this screen has to get right is not the layout. It is that a band is a
/// price and never a payout, and that a band nobody has funded says so on its
/// own row, before it is pressed, in words that do not read as a fault.

const FUNDED = [
  { band: '0_5', label: '0 to 5 years', available: true, reason: 'none', premium: '31.50' },
  { band: '5_25', label: '5 to 25 years', available: true, reason: 'none', premium: '28.00' },
  { band: '25_plus', label: '25 or more', available: true, reason: 'none', premium: '28.00' },
] as const;

const JUNIOR_UNFUNDED = [
  { band: '0_5', label: '0 to 5 years', available: false, reason: 'no_capital', premium: null },
  { band: '5_25', label: '5 to 25 years', available: true, reason: 'none', premium: '28.00' },
  { band: '25_plus', label: '25 or more', available: true, reason: 'none', premium: '26.20' },
] as const;

describe('the experience question', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('asks once and names the three bands in the words they were offered in', () => {
    render(
      <ExperienceScreen bands={[...FUNDED]} chosen={null} occupation="Computer and mathematical" />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'How long have you been working?',
    );
    for (const row of FUNDED) {
      expect(screen.getByText(row.label)).toBeTruthy();
    }
  });

  it('says a band changes the price and not the payout, and claims nothing else', () => {
    render(
      <ExperienceScreen bands={[...FUNDED]} chosen={null} occupation="Computer and mathematical" />,
    );
    expect(screen.getByText(BAND_EFFECT)).toBeTruthy();
    // Nothing on this screen may suggest the index measures experience, or that
    // a band changes who is covered or when a claim opens. The published data
    // has no occupation-by-age series at all.
    const text = document.body.textContent ?? '';
    for (const forbidden of ['claim', 'eligib', 'cover you', 'more likely', 'risk of']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('carries each band its own price, so nothing has to be tapped to be compared', () => {
    render(
      <ExperienceScreen bands={[...FUNDED]} chosen={null} occupation="Computer and mathematical" />,
    );
    expect(screen.getByText('31.50 a month')).toBeTruthy();
    expect(screen.getAllByText('28.00 a month')).toHaveLength(2);
  });

  it('says a band nobody has funded before it is pressed, and offers no price for it', () => {
    render(
      <ExperienceScreen
        bands={[...JUNIOR_UNFUNDED]}
        chosen={null}
        occupation="Computer and mathematical"
      />,
    );
    expect(screen.getByText(BAND_NOT_FUNDED)).toBeTruthy();
    // Not a zero and not a dash. There is no price, so nothing stands there.
    expect(screen.queryByText('0.00 a month')).toBeNull();
  });

  it('does not let the unfunded band be chosen, and does let the others', () => {
    render(
      <ExperienceScreen
        bands={[...JUNIOR_UNFUNDED]}
        chosen={null}
        occupation="Computer and mathematical"
      />,
    );
    const buttons = screen.getAllByRole('button');
    // Three rows, one of them not a button at all, plus Continue.
    expect(buttons.filter((node) => node.textContent?.includes('0 to 5 years'))).toHaveLength(0);

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /5 to 25 years/ }));
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false);
  });

  it('says so plainly when capital has chosen none of the three', () => {
    const none = JUNIOR_UNFUNDED.map((row) => ({
      ...row,
      available: false,
      reason: 'no_capital' as const,
      premium: null,
    }));
    render(
      <ExperienceScreen bands={none} chosen={null} occupation="Computer and mathematical" />,
    );
    expect(screen.getByRole('status').textContent).toContain('No capital has chosen');
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);
  });
});
