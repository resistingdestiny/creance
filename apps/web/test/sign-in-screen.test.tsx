// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Getting back into a cover.
 *
 * Two ways in, and the tests are about what the ticket says they must be:
 * neither is a fallback, a World check that finds nothing is an empty state and
 * not an error, and the whole screen works from the keyboard alone.
 *
 * The IDKit widget is the SDK's and opens a QR code, so it is stubbed here the
 * same way the purchase Verify screen stubs it. The stub keeps the props it was
 * handed, so a test can play the part of the widget and call them back, which
 * is the only contract this screen has with it.
 */

const widget = vi.hoisted(() => ({
  props: null as {
    handleVerify: (result: unknown) => Promise<void>;
    onSuccess: () => void;
    onError: (code: string) => void;
  } | null,
}));

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  redirect: vi.fn(),
}));

// The hook's default actions are the purchase flow's, so the module has to
// answer for those too even though this screen passes its own three.
vi.mock('../src/app/purchase-actions.js', () => ({
  connectWallet: vi.fn(),
  useDemoWallet: vi.fn(),
  completeWorldCheck: vi.fn(),
  openWithCoverKey: vi.fn(),
  signInWithWorld: vi.fn(),
  startSignInCheck: vi.fn(),
  startWorldCheck: vi.fn(),
  verifyPerson: vi.fn(),
}));

vi.mock('../src/app/verify/world-check.js', () => ({
  WorldCheck: (props: typeof widget.props) => {
    widget.props = props;
    return null;
  },
}));

const { SignInScreen } = await import('../src/app/home/sign-in-screen.js');
const { openWithCoverKey, signInWithWorld, startSignInCheck } = await import(
  '../src/app/purchase-actions.js'
);

const CONTEXT = {
  app_id: 'app_8569aa8d1bbfb24b1243e86d4fc34adc',
  action: 'occupation-cover-eligibility',
  environment: 'staging',
  preset: 'selfieCheckLegacy',
  signal: '0.0.10366401',
  require_user_presence: false,
  rp_id: 'rp_d6ae9b4ff2018a15',
  nonce: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  created_at: 1_757_000_000,
  expires_at: 1_757_000_300,
  signature: '0xabc',
};

afterEach(() => {
  cleanup();
  widget.props = null;
  vi.clearAllMocks();
});

/** Press the World button and wait for the widget to be mounted with a context. */
async function openTheWidget(): Promise<void> {
  vi.mocked(startSignInCheck).mockResolvedValue(CONTEXT);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with World ID' }));
  await waitFor(() => expect(widget.props).not.toBeNull());
}

/**
 * Play the widget: hand the screen a completed result. It throws when the
 * answer was a refusal, which is what stops the real widget calling onSuccess.
 */
async function completeTheCheck(): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await widget.props?.handleVerify({});
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

describe('getting back into a cover', () => {
  it('offers both ways in, and says which is which', () => {
    render(<SignInScreen world />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Get back into your cover');
    expect(
      screen.getByText(
        'World ID is how you get back in on your own phone. Your cover key is how you get back in anywhere.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with World ID' })).toBeTruthy();
    expect(screen.getByLabelText('Cover key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open my cover' })).toBeTruthy();
  });

  /**
   * A deployment with no World ID app cannot run the check, so it does not
   * offer a button that nothing can answer. The key is still there, which is
   * the point of the key.
   */
  it('drops the World button where there is no World app, and keeps the key', () => {
    render(<SignInScreen world={false} />);
    expect(screen.queryByRole('button', { name: 'Sign in with World ID' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open my cover' })).toBeTruthy();
  });

  it('sends the typed key to the server and says nothing else about it', async () => {
    vi.mocked(openWithCoverKey).mockResolvedValue({ found: true, error: null });
    render(<SignInScreen world />);
    fireEvent.change(screen.getByLabelText('Cover key'), {
      target: { value: '0000 1111 2222 3333 4444' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open my cover' }));
    await waitFor(() => expect(openWithCoverKey).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(openWithCoverKey).mock.calls[0]?.[0];
    expect(sent?.get('cover_key')).toBe('0000 1111 2222 3333 4444');
  });

  it('says one sentence when the key opens nothing', async () => {
    vi.mocked(openWithCoverKey).mockResolvedValue({
      found: false,
      error: "That key doesn't open a cover. Check it and try again.",
    });
    render(<SignInScreen world />);
    fireEvent.change(screen.getByLabelText('Cover key'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open my cover' }));
    await waitFor(() =>
      expect(
        screen.getByText("That key doesn't open a cover. Check it and try again."),
      ).toBeTruthy(),
    );
  });

  it('asks the API for a signed context when the World button is pressed', async () => {
    render(<SignInScreen world />);
    await openTheWidget();
    expect(startSignInCheck).toHaveBeenCalledTimes(1);
  });

  it('takes the cover it found and re-renders the dashboard behind it', async () => {
    vi.mocked(signInWithWorld).mockResolvedValue({ found: true, error: null });
    render(<SignInScreen world />);
    await openTheWidget();
    expect(await completeTheCheck()).toBeNull();
    await act(async () => {
      widget.props?.onSuccess();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /**
   * The acceptance: a nullifier with no cover gets a plain empty state rather
   * than an error. The person proved who they are and there is nothing here
   * yet, which is a different sentence from a check that failed.
   */
  it('gives a person with no cover an empty state and not a failure', async () => {
    vi.mocked(signInWithWorld).mockResolvedValue({ found: false, error: null });
    render(<SignInScreen world />);
    await openTheWidget();
    expect(await completeTheCheck()).not.toBeNull();

    expect(screen.getByTestId('no-cover')).toBeTruthy();
    expect(screen.getByText('No cover yet.')).toBeTruthy();
    expect(screen.getByText(/hasn't bought cover/)).toBeTruthy();
    expect(screen.queryByText(/We couldn't verify you/)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says a failed check failed, and points at the other way in', async () => {
    vi.mocked(signInWithWorld).mockResolvedValue({
      found: false,
      error: "We couldn't verify you.",
    });
    render(<SignInScreen world />);
    await openTheWidget();
    expect(await completeTheCheck()).not.toBeNull();

    expect(
      screen.getByText("We couldn't verify you. Try again, or use your cover key."),
    ).toBeTruthy();
    expect(screen.queryByTestId('no-cover')).toBeNull();
  });

  /**
   * A redirect from a server action resolves the call with nothing rather than
   * with a result, so the success path comes back here empty and must not be
   * read as an error.
   */
  it('shows no error when the key opened a cover and the server redirected', async () => {
    vi.mocked(openWithCoverKey).mockResolvedValue(undefined as never);
    render(<SignInScreen world />);
    fireEvent.change(screen.getByLabelText('Cover key'), { target: { value: '00001111222233334444' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open my cover' }));
    await waitFor(() => expect(openWithCoverKey).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/doesn't open a cover/)).toBeNull();
  });

  it('clears the last answer when the person tries again', async () => {
    vi.mocked(signInWithWorld).mockResolvedValue({ found: false, error: null });
    render(<SignInScreen world />);
    await openTheWidget();
    await completeTheCheck();
    expect(screen.getByTestId('no-cover')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with World ID' }));
    });
    expect(screen.queryByTestId('no-cover')).toBeNull();
  });

  it('completes the whole key form from the keyboard alone', async () => {
    vi.mocked(openWithCoverKey).mockResolvedValue({ found: true, error: null });
    render(<SignInScreen world />);
    const field = screen.getByLabelText('Cover key');
    field.focus();
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: '00001111222233334444' } });
    const submit = screen.getByRole('button', { name: 'Open my cover' });
    submit.focus();
    expect(document.activeElement).toBe(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(openWithCoverKey).toHaveBeenCalledTimes(1));
  });

  it('names the field for a screen reader, hint and all', () => {
    render(<SignInScreen world />);
    const field = screen.getByLabelText('Cover key');
    expect(field.getAttribute('aria-describedby')).toBe('cover-key-hint');
    expect(document.getElementById('cover-key-hint')?.textContent).toBe(
      'The twenty characters you were given when you bought your cover.',
    );
  });
});
