// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MiniKit } from '@worldcoin/minikit-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Providers } from '../src/app/providers';
import { detectSurface, useSurface } from '../src/lib/surface';

/// Surface detection, both branches, and the provider that publishes it.
///
/// Nothing here is a mock of World App: `window.WorldApp` is the object World
/// App itself injects and the only thing MiniKit reads to know where it is, so
/// setting it is how the SDK is asked the question in a browser. What cannot be
/// tested without a phone is what World App does after that, and no test here
/// claims to.

function Probe() {
  return <p data-testid="surface">{useSurface()}</p>;
}

/** The shape World App injects, with the fields MiniKit reads at install. */
const WORLD_APP = {
  world_app_version: 2500000,
  device_os: 'ios',
  supported_commands: [],
  is_optional_analytics: false,
  safe_area_insets: { top: 47, right: 0, bottom: 34, left: 0 },
};

describe('the surface helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>)['WorldApp'];
    delete (window as unknown as Record<string, unknown>)['MiniKit'];
  });

  it('is a browser when World App has injected nothing', () => {
    expect(detectSurface()).toBe('browser');
  });

  it('asks isInWorldApp before isInstalled, so a browser gets no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const installed = vi.spyOn(MiniKit, 'isInstalled');

    expect(detectSurface()).toBe('browser');

    expect(installed).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('is World App once the SDK has installed inside it', () => {
    (window as unknown as Record<string, unknown>)['WorldApp'] = WORLD_APP;
    MiniKit.install();

    expect(detectSurface()).toBe('world-app');
  });

  it('is a browser inside World App before install has run', () => {
    (window as unknown as Record<string, unknown>)['WorldApp'] = WORLD_APP;
    vi.spyOn(MiniKit, 'isInstalled').mockReturnValue(false);

    expect(detectSurface()).toBe('browser');
  });
});

describe('the MiniKit provider', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>)['WorldApp'];
    delete (window as unknown as Record<string, unknown>)['MiniKit'];
  });

  it('leaves a browser as a browser', () => {
    render(
      <Providers>
        <Probe />
      </Providers>,
    );

    expect(screen.getByTestId('surface').textContent).toBe('browser');
  });

  it('publishes the World App surface to the tree once install has run', () => {
    (window as unknown as Record<string, unknown>)['WorldApp'] = WORLD_APP;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <Providers>
        <Probe />
      </Providers>,
    );

    expect(screen.getByTestId('surface').textContent).toBe('world-app');
  });

  it('reads browser with no provider above it, which is what the server renders', () => {
    render(<Probe />);

    expect(screen.getByTestId('surface').textContent).toBe('browser');
  });
});
