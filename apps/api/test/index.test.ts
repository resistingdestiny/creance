import { describe, expect, it } from 'vitest';

import { describeWorkspace, summary, workspaceName } from '../src/index.js';

describe('@creance/api', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/api');
    expect(describeWorkspace()).toBe(`@creance/api: ${summary}`);
  });
});
