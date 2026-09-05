export const workspaceName = '@creance/client';

export const summary = 'TypeScript client for the API including an x402 payer helper';

/** One line describing what this workspace is for. */
export function describeWorkspace(): string {
  return `${workspaceName}: ${summary}`;
}

export * from './audit.js';
export * from './claim.js';
export * from './hedera/keys.js';
export * from './hedera/mirror.js';
export * from './hedera/schedule.js';
export * from './units.js';
export * from './x402/payer.js';
