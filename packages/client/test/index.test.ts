import { describe, expect, it } from 'vitest';

import { describeWorkspace, summary, workspaceName } from '../src/index.js';

describe('@creance/client', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/client');
    expect(describeWorkspace()).toBe(`@creance/client: ${summary}`);
  });
});
