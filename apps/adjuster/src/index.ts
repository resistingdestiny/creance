export const workspaceName = '@creance/adjuster';

export const summary = 'Claims agent: packet checks, decision records and the review queue';

/** One line describing what this workspace is for. */
export function describeWorkspace(): string {
  return `${workspaceName}: ${summary}`;
}

export * from './adapt.js';
export * from './confidence.js';
export * from './decide.js';
export * from './extraction.js';
export * from './normalise.js';
export * from './prompt.js';
export * from './reasons.js';
export * from './record.js';
export * from './rules.js';
