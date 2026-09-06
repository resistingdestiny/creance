// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeroAmount } from '../src/components/landing/hero-amount.js';
import { HeroCardStack } from '../src/components/landing/hero-card-stack.js';

/**
 * The two pieces of the landing hero that a stylesheet cannot decide.
 *
 * Both follow the same rule from the ticket: animation is enhancement and never
 * the source of truth. The amount has to read 5,000 whether or not a frame ever
 * fires, and the card has to be square on and still whenever it is not being
 * pointed at with a fine pointer.
 */

interface Frames {
  /** Runs the frames queued so far at the given timestamp. */
  flush: (at: number) => void;
  calls: () => number;
}

/** requestAnimationFrame under test control, so "a frame fires" is a choice. */
function stubFrames(): Frames {
  let queue: FrameRequestCallback[] = [];
  let count = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    count += 1;
    queue.push(callback);
    return count;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return {
    flush: (at: number) => {
      const due = queue;
      queue = [];
      for (const callback of due) callback(at);
    },
    calls: () => count,
  };
}

function stubMatchMedia({ reduced = false, fine = true }: { reduced?: boolean; fine?: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion')
      ? reduced
      : query.includes('pointer: fine')
        ? fine
        : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function stubHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  stubHidden(false);
});

describe('the cover amount counts up without ever being the source of truth', () => {
  it('is the true value before a single frame has run', async () => {
    stubMatchMedia({});
    stubFrames();

    await act(async () => {
      render(<HeroAmount value={5000} />);
    });

    // The server sent this and the first client render kept it. The count-up
    // has been scheduled but has not run.
    expect(document.body.textContent).toBe('5,000');
  });

  it('walks up from zero once frames start, and lands on the true value', async () => {
    stubMatchMedia({});
    const frames = stubFrames();
    vi.spyOn(performance, 'now').mockReturnValue(0);

    await act(async () => {
      render(<HeroAmount value={5000} />);
    });
    await act(async () => {
      frames.flush(0);
    });
    const first = document.body.textContent;
    await act(async () => {
      frames.flush(10_000);
    });

    expect(first).toBe('0');
    expect(document.body.textContent).toBe('5,000');
  });

  it('never paints a negative figure when a frame arrives before it started', async () => {
    // The timestamp a frame callback is given is the moment that frame's work
    // began, which can precede the performance.now() the effect took. Elapsed
    // time is negative there, and an unclamped cubic ease turns that into a
    // negative multiplier: the card paints -52 for one frame on the way up.
    stubMatchMedia({});
    const frames = stubFrames();
    vi.spyOn(performance, 'now').mockReturnValue(20);

    await act(async () => {
      render(<HeroAmount value={5000} />);
    });
    await act(async () => {
      frames.flush(4);
    });
    const first = document.body.textContent;
    await act(async () => {
      frames.flush(200);
    });

    expect(first).toBe('0');
    expect(first).not.toContain('-');
    expect(document.body.textContent).not.toContain('-');
  });

  it('never asks for a frame in a background tab, and keeps the figure', async () => {
    stubMatchMedia({});
    const frames = stubFrames();
    stubHidden(true);

    await act(async () => {
      render(<HeroAmount value={5000} />);
    });

    // A counter that shows zero because its animation never started is a
    // defect. Nothing was started, so there is nothing to show a zero.
    expect(frames.calls()).toBe(0);
    expect(document.body.textContent).toBe('5,000');
  });

  it('finishes on the spot when the tab is hidden part way through', async () => {
    stubMatchMedia({});
    const frames = stubFrames();
    vi.spyOn(performance, 'now').mockReturnValue(0);

    await act(async () => {
      render(<HeroAmount value={5000} />);
    });
    await act(async () => {
      frames.flush(0);
    });
    expect(document.body.textContent).toBe('0');

    stubHidden(true);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(document.body.textContent).toBe('5,000');
  });

  it('skips the count-up entirely under reduced motion', async () => {
    stubMatchMedia({ reduced: true });
    const frames = stubFrames();

    await act(async () => {
      render(<HeroAmount value={5000} />);
    });

    expect(frames.calls()).toBe(0);
    expect(document.body.textContent).toBe('5,000');
  });
});

describe('the hero card takes an angle only where an angle means something', () => {
  function stack() {
    return render(
      <HeroCardStack>
        <div data-testid="card" />
      </HeroCardStack>,
    );
  }

  /** The element the rotation is written to. */
  function sheet(): HTMLElement {
    return screen.getByTestId('card').parentElement as HTMLElement;
  }

  it('drifts on a fine pointer, gently and without being touched', async () => {
    stubMatchMedia({ fine: true });
    const frames = stubFrames();
    vi.spyOn(performance, 'now').mockReturnValue(0);

    await act(async () => {
      stack();
    });
    await act(async () => {
      frames.flush(1000);
    });

    expect(sheet().style.transform).toMatch(/^rotateX\(-?\d/);
    expect(sheet().className).toBe('cover-card-tilt');
  });

  it('is simply still on a coarse pointer', async () => {
    stubMatchMedia({ fine: false });
    const frames = stubFrames();

    await act(async () => {
      stack();
    });

    expect(frames.calls()).toBe(0);
    expect(sheet().style.transform).toBe('');
  });

  it('is simply still under reduced motion, whatever the pointer is', async () => {
    stubMatchMedia({ fine: true, reduced: true });
    const frames = stubFrames();

    await act(async () => {
      stack();
    });

    expect(frames.calls()).toBe(0);
    expect(sheet().style.transform).toBe('');
  });

  it('eases back rather than snapping when the pointer leaves', async () => {
    stubMatchMedia({ fine: true });
    const frames = stubFrames();
    vi.spyOn(performance, 'now').mockReturnValue(0);

    const { container } = await act(async () => stack());
    const root = container.firstElementChild as HTMLElement;

    await act(async () => {
      root.dispatchEvent(new Event('pointerenter'));
    });
    expect(root.className).toContain('is-tracking');

    await act(async () => {
      root.dispatchEvent(new Event('pointerleave'));
    });

    // The transform is cleared and the stylesheet's half second transition
    // carries the card home. Nothing here animates it back frame by frame, and
    // nothing snaps it.
    expect(root.className).not.toContain('is-tracking');
    expect(sheet().style.transform).toBe('');
    expect(frames.calls()).toBeGreaterThan(0);
  });
});
