import { describe, expect, it, vi } from 'vitest';

/**
 * The deep link's landing route, `/cover/index/<group>`.
 *
 * This is the path the API publishes as the Mini App's occupation index entry,
 * spelled out here because the two live in different workspaces and a rename on
 * one side has to fail on the other.
 *
 * The framework's own `redirect` throws to unwind the render, so the stub throws
 * too. A stub that returned would let a rejected occupation fall through to the
 * second redirect, which is exactly the bug worth catching.
 */

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));

const { default: OccupationIndexEntry } = await import('../src/app/cover/index/[group]/page.js');

function open(group: string) {
  return OccupationIndexEntry({ params: Promise.resolve({ group }) });
}

describe('the occupation index entry', () => {
  it('opens the index tab on the occupation named in the path', async () => {
    await expect(open('computer_math')).rejects.toThrow(
      'redirect:/cover/index?group=computer_math',
    );
  });

  it('works for an occupation with no cover behind it', async () => {
    await expect(open('legal')).rejects.toThrow('redirect:/cover/index?group=legal');
  });

  it('sends an occupation the index does not cover home', async () => {
    await expect(open('astronaut')).rejects.toThrow('redirect:/');
  });
});
