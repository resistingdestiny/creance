import { describe, expect, it } from 'vitest';

import { describeWorkspace, summary, workspaceName } from '../src/index.js';

describe('@creance/oracle', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/oracle');
    expect(describeWorkspace()).toBe(`@creance/oracle: ${summary}`);
  });
});
