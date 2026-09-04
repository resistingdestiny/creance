import { describe, expect, it } from 'vitest';

import { describeWorkspace, summary, workspaceName } from '../src/index.js';

describe('@creance/web', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/web');
    expect(describeWorkspace()).toBe(`@creance/web: ${summary}`);
  });
});
