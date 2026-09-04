import { describe, expect, it } from 'vitest';

import { describeWorkspace, summary, workspaceName } from '../src/index.js';

describe('@creance/contracts', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/contracts');
    expect(describeWorkspace()).toBe(`@creance/contracts: ${summary}`);
  });
});
