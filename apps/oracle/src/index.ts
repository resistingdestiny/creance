export const workspaceName = '@creance/oracle';

export const summary = 'Index worker: BLS fetch, ODI, HCS publish and replay';

/** One line describing what this workspace is for. */
export function describeWorkspace(): string {
  return `${workspaceName}: ${summary}`;
}
