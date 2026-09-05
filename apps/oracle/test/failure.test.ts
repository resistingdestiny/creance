import { describe, expect, it } from 'vitest';

import { reportQaFailure } from '../src/cli/failure.js';
import { QaFailed } from '../src/run.js';
import type { QaReport } from '../src/qa.js';

const JUMP: QaReport = {
  period: '2020-04',
  passed: false,
  gates: [],
  failures: [
    {
      gate: 'jump',
      passed: false,
      detail: 'service moved 4.03 against 0.99',
    },
  ],
};

function lines(error: QaFailed, command = 'pnpm oracle:replay --from 2019-01'): string {
  const out: string[] = [];
  reportQaFailure(error, command, (line) => out.push(line));
  return out.join('\n');
}

describe('what a command prints when the gates refuse a window', () => {
  it('leads with the period and with the fact that nothing was sent', () => {
    const text = lines(new QaFailed(JUMP, '2020-03'));
    expect(text).toContain('failed closed at 2020-04');
    expect(text).toContain('nothing was published and nothing was submitted');
    expect(text).toContain('jump: service moved 4.03 against 0.99');
  });

  it('hands back a command that can be pasted', () => {
    const text = lines(new QaFailed(JUMP, '2020-03'));
    expect(text).toContain('every period up to 2020-03 passes');
    expect(text).toContain('pnpm oracle:replay --from 2019-01 --to 2020-03');
  });

  it('says there is no prefix when the first period is the one that fails', () => {
    const text = lines(new QaFailed(JUMP, null));
    expect(text).toContain('no usable prefix');
    expect(text).not.toContain('--to');
  });

  it('never offers a way to publish a month that failed a gate', () => {
    for (const error of [new QaFailed(JUMP, '2020-03'), new QaFailed(JUMP, null)]) {
      const text = lines(error);
      expect(text).not.toMatch(/--force|--skip|--ignore|--override|--allow/);
    }
    expect(lines(new QaFailed(JUMP, '2020-03'))).toContain('not overridable');
  });
});
