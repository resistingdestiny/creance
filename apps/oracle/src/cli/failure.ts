import { QaFailed } from '../run.js';

/**
 * What a command prints when the QA gates refuse a window.
 *
 * The gates run over the whole window before anything is published, so the
 * first line a reader needs is that nothing was sent. The second is what to do
 * about it, and that depends on which case this is.
 *
 * A window that spans a legitimate source anomaly has a longest usable prefix.
 * April 2020 is the case this build meets: every white collar group moves past
 * five standard deviations, the jump gate is right to stop, and the operator
 * wants the months before it rather than an argument about the gate. Printing
 * the exact `--to` saves them working it out from a stack of gate output.
 *
 * A window whose very first period fails has no prefix, and the honest answer
 * is that a human looks at the source before anything is replayed at all.
 */
export function reportQaFailure(
  error: QaFailed,
  command: string,
  log: (line: string) => void = (line) => console.error(line),
): void {
  log('');
  log(`the run failed closed at ${error.report.period}`);
  log('nothing was published and nothing was submitted');
  log('');
  for (const gate of error.report.failures) {
    log(`  ${gate.gate}: ${gate.detail}`);
  }
  log('');
  if (error.lastPassing === null) {
    log('the first period in the window fails, so there is no usable prefix.');
    log('docs/INDEX-SPEC.md section 8: a failed gate is a bug or a source anomaly,');
    log('and either way a human looks before anything reaches the topic.');
    return;
  }
  log(`every period up to ${error.lastPassing} passes. To replay that window:`);
  log('');
  log(`  ${command} --to ${error.lastPassing}`);
  log('');
  log('The gates are not overridable. A month that fails one is not published,');
  log('because the first value published for a period settles it forever.');
}
