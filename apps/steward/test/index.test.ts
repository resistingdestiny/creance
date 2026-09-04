import { describe, expect, it } from 'vitest';

import { describeWorkspace, summary, workspaceName } from '../src/index.js';

describe('@creance/steward', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/steward');
    expect(describeWorkspace()).toBe(`@creance/steward: ${summary}`);
  });
});
