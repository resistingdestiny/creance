import { loadOracleConfig } from '../config.js';
import { oracleKeyHex } from '../keys.js';
import { addressOfKey } from '../message.js';
import { readString } from './args.js';
import { decodeMirrorMessage, readTopicMessages, verifyMessageBytes } from '../verify.js';

/**
 * `pnpm oracle:verify`. Read the index topic back through the mirror node and
 * check every message against the oracle's address.
 *
 * It exists so that "the observation is signed" is a statement a reviewer can
 * run rather than one they have to take on trust, and so that the verification
 * procedure T07's API will implement is written down as executable code. It
 * reads only public data: no key is needed unless the address is being derived
 * rather than given.
 */

interface Options {
  topicId: string | null;
  signer: string | null;
}

const USAGE = `usage: pnpm oracle:verify [options]

  --topic 0.0.x           the topic to read; defaults to HEDERA_TOPIC_INDEX
  --signer 0x...          the address to check against; defaults to the oracle key's
  -h, --help              this text`;

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = { topicId: null, signer: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--topic') options.topicId = readString(argv[++i], '--topic');
    else if (arg === '--signer') options.signer = readString(argv[++i], '--signer');
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg !== undefined) throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const config = loadOracleConfig();
  const topicId = options.topicId ?? config.topicId;
  const signer = options.signer ?? addressOfKey(oracleKeyHex());
  const log = (line: string): void => console.log(line);

  log(`topic      ${topicId}`);
  log(`signer     ${signer}`);
  log(`mirror     ${config.mirrorUrl}`);
  log('');

  const messages = await readTopicMessages(config.mirrorUrl, topicId);
  log(`${messages.length} messages on the topic`);
  log('');

  let bad = 0;
  for (const message of messages) {
    const result = verifyMessageBytes(
      decodeMirrorMessage(message),
      signer,
      message.sequence_number,
    );
    if (result.problem !== null) bad += 1;
    log(
      `${String(result.sequenceNumber).padStart(3)}  ${(result.period ?? '???').padEnd(8)}` +
        `${(result.status ?? '???').padEnd(21)}${result.open ? 'OPEN  ' : 'closed'}  ` +
        `${String(result.bytes).padStart(4)} bytes  ` +
        `${result.problem === null ? 'signature ok, canonical' : result.problem}`,
    );
  }

  log('');
  if (bad === 0) {
    log(`all ${messages.length} messages verify against ${signer}`);
  } else {
    log(`${bad} of ${messages.length} messages did not verify`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
