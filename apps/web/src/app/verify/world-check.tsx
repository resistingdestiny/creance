'use client';

import {
  deviceLegacy,
  IDKitRequestWidget,
  orbLegacy,
  proofOfHuman,
  selfieCheckLegacy,
  type IDKitErrorCodes,
  type IDKitResult,
  type Preset,
} from '@worldcoin/idkit';

import type { WorldRequestContextView } from '../../lib/worker-api';

/**
 * The IDKit request widget, with the configuration the API signed.
 *
 * It is its own module so that the screen around it stays a plain component and
 * so the whole SDK only enters a bundle where a check actually runs.
 *
 * `handleVerify` is where our own verification goes. If it throws, the widget
 * reports `failed_by_host_app` and never calls `onSuccess`, so the success path
 * is genuinely gated on the API's answer rather than on World's alone. That is
 * the behaviour this component depends on.
 *
 * `open` and `autoClose` are left at their defaults, as are the polling values.
 *
 * https://docs.world.org/world-id/idkit/reference
 */

const PRESETS: Record<string, (opts: { signal: string }) => Preset> = {
  selfieCheckLegacy,
  proofOfHuman,
  orbLegacy,
  deviceLegacy,
};

export function presetFor(name: string, signal: string): Preset {
  const build = PRESETS[name] ?? selfieCheckLegacy;
  return build({ signal });
}

export function WorldCheck({
  context,
  open,
  onOpenChange,
  handleVerify,
  onSuccess,
  onError,
}: {
  context: WorldRequestContextView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handleVerify: (result: IDKitResult) => Promise<void>;
  onSuccess: () => void;
  onError: (code: IDKitErrorCodes) => void;
}) {
  return (
    <IDKitRequestWidget
      app_id={context.app_id as `app_${string}`}
      action={context.action}
      rp_context={{
        rp_id: context.rp_id,
        nonce: context.nonce,
        created_at: context.created_at,
        expires_at: context.expires_at,
        signature: context.signature,
      }}
      // The credentials page's own example omits this, its parameter table
      // calls it required for request flows, and the React page passes true.
      // It cannot hurt on a preset that only returns 3.0 proofs.
      allow_legacy_proofs
      require_user_presence={context.require_user_presence}
      environment={context.environment as 'production' | 'staging' | 'sandbox'}
      preset={presetFor(context.preset, context.signal)}
      open={open}
      onOpenChange={onOpenChange}
      handleVerify={handleVerify}
      onSuccess={onSuccess}
      onError={onError}
    />
  );
}
