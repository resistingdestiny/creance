import { describe, expect, it } from 'vitest';

import { describeWorkspace, summary, workspaceName } from '../src/index.js';

describe('@creance/adjuster', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/adjuster');
    expect(describeWorkspace()).toBe(`@creance/adjuster: ${summary}`);
  });
});
