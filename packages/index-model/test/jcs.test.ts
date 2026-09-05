import { describe, expect, it } from 'vitest';

import { canonicalize } from '../src/jcs.js';
import { sha256Hex, sourceHash, type SourceRow } from '../src/hash.js';

describe('canonicalize', () => {
  it('sorts object keys by UTF-16 code unit', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    // Capitals sort before lower case because their code units are smaller.
    expect(canonicalize({ a: 1, A: 2 })).toBe('{"A":2,"a":1}');
    expect(canonicalize({ '\u00e4': 1, 'z': 2 })).toBe('{"z":2,"\u00e4":1}');
  });

  it('sorts by code unit and not by code point, so a surrogate pair sorts early', () => {
    // U+1F600 is the pair D83D DE00 and U+FB33 is a single unit. By code point
    // the emoji is the larger; by UTF-16 code unit D83D is smaller than FB33 and
    // the emoji sorts first, which is what RFC 8785 requires.
    const input = { '\u{1f600}': 'grinning face', '\ufb33': 'hebrew dalet with dagesh' };
    expect(canonicalize(input)).toBe(
      '{"\u{1f600}":"grinning face","\ufb33":"hebrew dalet with dagesh"}',
    );
  });

  it('escapes control characters below 0x20 and nothing above it', () => {
    expect(canonicalize({ a: '\r\n\t' })).toBe('{"a":"\\r\\n\\t"}');
    expect(canonicalize({ a: '\u0001' })).toBe('{"a":"\\u0001"}');
    expect(canonicalize({ a: 'quote " and backslash \\\\' })).toBe(
      '{"a":"quote \\" and backslash \\\\\\\\"}',
    );
    // U+0080 is not a JSON control character and stays literal.
    expect(canonicalize({ a: '\u0080' })).toBe('{"a":"\u0080"}');
  });

  it('leaves arrays in order and emits no whitespace', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize({ v: 2, values: ['a', 'b'] })).toBe('{"v":2,"values":["a","b"]}');
  });

  it('normalises negative zero and refuses non-finite numbers', () => {
    expect(canonicalize(-0)).toBe('0');
    expect(() => canonicalize(NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
  });

  it('canonicalises an observation message the way it will be signed', () => {
    const message = {
      v: 2,
      period: '2026-04',
      group: 'computer_math',
      odi: '0.30',
      ebar: '-0.60',
      open: true,
    };
    expect(canonicalize(message)).toBe(
      '{"ebar":"-0.60","group":"computer_math","odi":"0.30","open":true,"period":"2026-04","v":2}',
    );
  });
});

describe('sourceHash', () => {
  const rows: SourceRow[] = [
    { seriesID: 'LNU04034021', year: '2026', period: 'M04', value: '3.5', footnote_codes: [] },
    { seriesID: 'LNU04000000', year: '2026', period: 'M04', value: '4.0', footnote_codes: [] },
  ];

  it('does not depend on the order the rows arrived in', () => {
    expect(sourceHash(rows)).toBe(sourceHash([...rows].reverse()));
  });

  it('is the sha256 of the canonical form, so an outsider can repeat it', () => {
    const expected = sha256Hex(
      '[{"footnote_codes":[],"period":"M04","seriesID":"LNU04000000","value":"4.0","year":"2026"},' +
        '{"footnote_codes":[],"period":"M04","seriesID":"LNU04034021","value":"3.5","year":"2026"}]',
    );
    expect(sourceHash(rows)).toBe(expected);
  });

  it('changes when a value changes', () => {
    const changed = rows.map((r) =>
      r.seriesID === 'LNU04034021' ? { ...r, value: '3.6' } : r,
    );
    expect(sourceHash(changed)).not.toBe(sourceHash(rows));
  });
});
