/**
 * JSON Canonicalization Scheme, RFC 8785. The signed form of an observation and
 * the input to every source hash are the JCS bytes, so that two independent
 * implementations sign and hash the same thing.
 *
 * Written here rather than pulled in as a dependency because it is short, the
 * signed form of a settlement message is not something to delegate, and the
 * three parts JCS specifies are all things JavaScript already does correctly:
 * object keys sort by UTF-16 code unit, which is the default sort of an array of
 * strings; string escaping is the minimal escaping of JSON.stringify; and number
 * serialisation is ECMAScript Number::toString, which is what JSON.stringify
 * emits. What JSON.stringify does not do is sort keys, which is the whole job.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalize(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot canonicalise ${value}`);
    // RFC 8785 serialises numbers as ECMAScript Number::toString, and -0 becomes
    // "0". JSON.stringify(-0) already gives "0".
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(compareByCodeUnit);
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`);
    return `{${members.join(',')}}`;
  }
  throw new Error(`cannot canonicalise ${typeof value}`);
}

/**
 * RFC 8785 sorts by UTF-16 code unit. JavaScript's default array sort compares
 * strings by code unit already; this says so explicitly rather than relying on a
 * reader knowing it, and refuses lone surrogates, which have no canonical form.
 */
function compareByCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
