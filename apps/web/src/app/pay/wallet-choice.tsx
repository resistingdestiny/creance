'use client';

import { useState, useTransition } from 'react';

import { Check } from '../../components/icons';
import { useWallet } from '../../lib/use-wallet';
import type { WalletMode } from '../../lib/wallet';
import { useDemoWallet } from '../purchase-actions';

/**
 * "How do you want to pay?", the choice on the payment step.
 *
 * Two options, and the labels are the whole point of the ticket, so each one
 * says what is true of what shipped and nothing more. The cover bought with a
 * connected wallet is held in that wallet: the quote names it, the eligibility
 * credential binds to it and the policy NFT is minted to it. The premium is not
 * paid by it. src/lib/payer.ts still settles the x402 authorisation with a
 * server side key out of the service account, and that half is what the second
 * line of the recommended option says out loud.
 *
 * The demo wallet is the default and stays selected for anybody who does not
 * touch this. Choosing it is what the flow already did.
 *
 * Changing the wallet costs a check. DESIGN.md 3.6 binds a Selfie Check to the
 * wallet id and /v1/bind refuses a quote and a credential that name different
 * accounts, so a credential earned against one wallet is worthless to another.
 * The sentence under the group says so before the tap rather than after it,
 * which is the same rule the line above the pay button follows.
 *
 * The World App wallet is not a third option and its absence is not an
 * oversight. docs/DECISIONS.md, "No MiniKit command that touches World Chain is
 * called anywhere": a mini app is developed against live World Chain, there is
 * no test network for it and MISSION rule 1 forbids real funds. The one
 * sentence at the foot is that decision, said plainly.
 */

export const CHOICE_HEADING = 'How do you want to pay?';

export const OWN_WALLET_TITLE = 'Your own wallet';
export const OWN_WALLET_BODY =
  'The cover is held in your wallet. The monthly payment is still settled by us.';

export const DEMO_WALLET_TITLE = 'Demo wallet';
export const DEMO_WALLET_BODY = 'A Hedera testnet account we hold the key for. Nothing to install.';

export const RECOMMENDED = 'Recommended';

export const CHECK_AGAIN_NOTE =
  "Changing this asks you to confirm you're a real person again, because the check is tied to the wallet that holds the cover.";

export const WORLD_APP_NOTE = 'World App holds your ID, Hedera holds the money.';

export const NO_PROJECT_ID_NOTE =
  'This deployment has no WalletConnect project id, so only the demo wallet can be offered.';

export const CONNECTING = 'Waiting for your wallet';

export function WalletChoice({
  connectedAccount,
  onChanged,
}: {
  /** The account the session is bound to, from the server, or null for demo. */
  connectedAccount: string | null;
  /**
   * Told after a change has landed on the server. The step turns back to the
   * check, because the credential went with the old wallet.
   */
  onChanged: () => void;
}) {
  const wallet = useWallet();
  const [chosen, setChosen] = useState<WalletMode>(
    connectedAccount === null ? 'demo' : 'walletconnect',
  );
  const [leaving, startLeaving] = useTransition();

  const account = wallet.account?.accountId ?? connectedAccount;
  const connecting = wallet.status === 'connecting' || leaving;

  const chooseOwn = () => {
    if (connecting || !wallet.offersWalletConnect) return;
    void wallet.connect('walletconnect').then((connected) => {
      if (connected === null) return;
      setChosen('walletconnect');
      onChanged();
    });
  };

  const chooseDemo = () => {
    if (connecting || chosen === 'demo') return;
    startLeaving(async () => {
      await wallet.disconnect();
      await useDemoWallet();
      setChosen('demo');
      onChanged();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-body-lg text-ink">{CHOICE_HEADING}</h2>

      <div className="divide-y divide-hairline" role="radiogroup" aria-label={CHOICE_HEADING}>
        <ChoiceRow
          aria-checked={chosen === 'walletconnect'}
          body={OWN_WALLET_BODY}
          disabled={!wallet.offersWalletConnect || connecting}
          onSelect={chooseOwn}
          recommended
          title={OWN_WALLET_TITLE}
          value={
            connecting && chosen !== 'walletconnect'
              ? CONNECTING
              : chosen === 'walletconnect' && account !== null
                ? account
                : null
          }
        />
        <ChoiceRow
          aria-checked={chosen === 'demo'}
          body={DEMO_WALLET_BODY}
          disabled={connecting}
          onSelect={chooseDemo}
          title={DEMO_WALLET_TITLE}
          value={null}
        />
      </div>

      {wallet.status === 'error' && wallet.error !== null ? (
        <p className="text-secondary text-triggered" data-testid="wallet-choice-error" role="status">
          {wallet.error}
        </p>
      ) : null}

      {wallet.offersWalletConnect ? (
        <p className="text-caption text-ink-2">{CHECK_AGAIN_NOTE}</p>
      ) : (
        <p className="text-caption text-ink-2">{NO_PROJECT_ID_NOTE}</p>
      )}
      <p className="text-caption text-ink-2">{WORLD_APP_NOTE}</p>
    </section>
  );
}

/**
 * One option. A radio rather than a list row: two of these are one choice, and
 * a screen reader that reads them as two buttons does not say that.
 */
function ChoiceRow({
  body,
  disabled,
  onSelect,
  recommended = false,
  title,
  value,
  ...rest
}: {
  'aria-checked': boolean;
  body: string;
  disabled: boolean;
  onSelect: () => void;
  recommended?: boolean;
  title: string;
  value: string | null;
}) {
  return (
    <button
      className="flex w-full items-start justify-between gap-4 py-3 text-left disabled:opacity-60"
      disabled={disabled}
      onClick={onSelect}
      role="radio"
      type="button"
      {...rest}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="text-body text-ink">{title}</span>
          {recommended ? (
            <span className="rounded-full border border-hairline px-2 py-[3px] text-caption font-medium text-ink-2">
              {RECOMMENDED}
            </span>
          ) : null}
        </span>
        <span className="text-caption text-ink-2">{body}</span>
        {value === null ? null : (
          <span className="text-caption tabular-nums text-ink-2">{value}</span>
        )}
      </span>
      <span className="flex size-6 shrink-0 items-center justify-center">
        {rest['aria-checked'] ? <Check className="text-ink" /> : null}
      </span>
    </button>
  );
}
