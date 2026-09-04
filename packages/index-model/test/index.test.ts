import { describe, expect, it } from 'vitest';

import { describeWorkspace, summary, workspaceName } from '../src/index.js';

describe('@creance/index-model', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/index-model');
    expect(describeWorkspace()).toBe(`@creance/index-model: ${summary}`);
  });
});
