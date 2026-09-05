// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DisplayNumber } from '../src/components/display-number.js';

/**
 * The count-up is the one piece of motion that CSS cannot switch off, because
 * it is a value changing rather than a property transitioning. Under reduced
 * motion it has to be skipped, not shortened: a duration of zero still walks
 * from zero to the value and still reads as a flash.
 */

interface FakeMedia {
  matches: boolean;
  listeners: Set<(event: MediaQueryListEvent) => void>;
}

function stubMatchMedia(matches: boolean): FakeMedia {
  const media: FakeMedia = { matches, listeners: new Set() };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? media.matches : false,
    media: query,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      media.listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      media.listeners.delete(listener),
  }));
  return media;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the count-up under reduced motion', () => {
  it('lands on the final value in one frame and never animates', async () => {
    stubMatchMedia(true);
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');

    await act(async () => {
      render(<DisplayNumber countUp value={5000} />);
    });

    expect(screen.getByTestId('display-number').textContent).toBe('5,000');
    expect(frames).not.toHaveBeenCalled();
  });

  it('shows no intermediate value on the way there', async () => {
    stubMatchMedia(true);
    const host = document.createElement('div');
    document.body.append(host);

    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      seen.push(host.textContent ?? '');
    });
    observer.observe(host, { characterData: true, childList: true, subtree: true });

    await act(async () => {
      render(<DisplayNumber countUp value={5000} />, { container: host });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    observer.disconnect();

    // The only text this element ever held is the final value. Nothing walked
    // up to it, and nothing flashed a zero on the way.
    for (const text of seen) expect(text).toBe('5,000');
    expect(host.textContent).toBe('5,000');
  });

  it('animates when the preference is not set', async () => {
    stubMatchMedia(false);
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');

    await act(async () => {
      render(<DisplayNumber countUp value={5000} />);
    });

    expect(frames).toHaveBeenCalled();
  });

  it('takes the forced flag as though the preference were set', async () => {
    stubMatchMedia(false);
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');

    await act(async () => {
      render(<DisplayNumber countUp forceReducedMotion value={2500} />);
    });

    expect(screen.getByTestId('display-number').textContent).toBe('2,500');
    expect(frames).not.toHaveBeenCalled();
  });
});

describe('the preference is watched, not read once', () => {
  it('follows a change made while the page is open', async () => {
    const media = stubMatchMedia(false);

    await act(async () => {
      render(<DisplayNumber value={5000} />);
    });
    expect(media.listeners.size).toBe(1);

    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');
    await act(async () => {
      media.matches = true;
      for (const listener of media.listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(frames).not.toHaveBeenCalled();
    expect(screen.getByTestId('display-number').textContent).toBe('5,000');
  });

  it('unsubscribes when it goes away', async () => {
    const media = stubMatchMedia(false);
    const view = await act(async () => render(<DisplayNumber value={5000} />));
    expect(media.listeners.size).toBe(1);
    await act(async () => {
      view.unmount();
    });
    expect(media.listeners.size).toBe(0);
  });
});

describe('the negative display value', () => {
  it('uses the ASCII hyphen-minus', async () => {
    stubMatchMedia(false);
    await act(async () => {
      render(<DisplayNumber size="display-l" value={-7500} />);
    });
    const text = screen.getByTestId('display-number').textContent ?? '';
    expect(text).toBe('-7,500');
    expect(text.charCodeAt(0)).toBe(0x002d);
  });
});
