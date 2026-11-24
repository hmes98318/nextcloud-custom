// Terminal output helpers: colors, status markers, and durations.

import { stripVTControlCharacters, styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];

const MARKERS = {
  step: '▶',
  success: '✔',
  failure: '✖',
  warning: '⚠',
  skipped: '○',
  child: '│',
} as const;

/**
 * Colors text for a stream. `styleText` returns the text unchanged when the
 * stream is not a terminal or when `NO_COLOR` is set, and honors `FORCE_COLOR`.
 */
function paint(
  style: Style,
  text: string,
  stream: NodeJS.WriteStream = process.stdout,
): string {
  return styleText(style, text, { stream });
}

/** Prints a section heading separated from the previous output. */
export function printHeading(text: string): void {
  console.log(`\n${paint(['bold', 'cyan'], `━━ ${text}`)}`);
}

/** Prints a heading one level below `printHeading`, for the parts of a step. */
export function printSubheading(text: string): void {
  console.log(`\n${paint('cyan', `── ${text}`)}`);
}

export interface Steps {
  /** Prints the heading of a step, such as `[2/4] Title detail`. */
  begin(title: string, detail?: string): void;
}

/**
 * Lists the steps that a run will go through, in order, so that every heading
 * shows its position and the total. Leave out a step that the run skips, and
 * the numbers stay contiguous. A position depends on the title only, so a
 * step that follows a failure, such as the cleanup, keeps its number.
 */
export function createSteps(titles: readonly string[]): Steps {
  return {
    begin(title: string, detail?: string): void {
      const index = titles.indexOf(title);

      if (index === -1) {
        throw new Error(`Step "${title}" is not in the list of steps`);
      }

      const position = `[${String(index + 1)}/${String(titles.length)}]`;

      printHeading(
        [position, title, detail].filter(part => part !== undefined).join(' '),
      );
    },
  };
}

/** Prints the start of a step. */
export function printStep(text: string): void {
  console.log(`${paint('blue', MARKERS.step)} ${text}`);
}

/** Prints plain informational text. */
export function printInfo(text: string): void {
  console.log(text);
}

/** Prints secondary text, such as hints, in a dim style. */
export function printDetail(text: string, indent = 2): void {
  console.log(paint('dim', `${' '.repeat(indent)}${text}`));
}

/** Prints a success message. */
export function printSuccess(text: string): void {
  console.log(`${paint('green', MARKERS.success)} ${text}`);
}

/** Prints a warning message. */
export function printWarning(text: string): void {
  console.warn(
    `${paint('yellow', MARKERS.warning, process.stderr)} ${paint('yellow', text, process.stderr)}`,
  );
}

/** Prints an error message to standard error. */
export function printError(text: string): void {
  console.error(
    `${paint('red', MARKERS.failure, process.stderr)} ${paint('red', text, process.stderr)}`,
  );
}

/** Prints one result line of a test case: pass, fail, or skipped. */
export function printCaseResult(
  outcome: 'passed' | 'failed' | 'skipped',
  name: string,
  durationMs: number,
): void {
  const duration = paint('dim', `(${formatDuration(durationMs)})`);

  if (outcome === 'passed') {
    console.log(`  ${paint('green', MARKERS.success)} ${name} ${duration}`);
  } else if (outcome === 'failed') {
    console.log(`  ${paint('red', MARKERS.failure)} ${name} ${duration}`);
  } else {
    console.log(`  ${paint('dim', `${MARKERS.skipped} ${name} (skipped)`)}`);
  }
}

/**
 * Prints one line of output from a child process. Docker and other tools may
 * emit their own ANSI sequences, so the line is stripped of control sequences
 * and re-styled to keep the terminal colors under this script's control.
 */
export function printChildLine(line: string): void {
  const clean = stripVTControlCharacters(line).trimEnd();

  if (clean === '') {
    return;
  }

  console.log(paint('dim', `  ${MARKERS.child} ${clean}`));
}

/** Prints the lines of a failure message, indented under a failed case. */
export function printFailureDetail(message: string): void {
  for (const line of message.split('\n')) {
    console.log(paint('red', `      ${line}`));
  }
}

/** Formats a duration in milliseconds, such as `850ms`, `12.3s`, or `2m 05s`. */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${String(Math.round(durationMs))}ms`;
  }

  const seconds = durationMs / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);

  return `${String(minutes)}m ${String(rest).padStart(2, '0')}s`;
}

/** Prints the totals of a test flow. */
export function printSummary(totals: {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}): void {
  const parts = [
    paint('green', `${String(totals.passed)} passed`),
    totals.failed > 0
      ? paint(['bold', 'red'], `${String(totals.failed)} failed`)
      : paint('dim', '0 failed'),
    paint('dim', `${String(totals.skipped)} skipped`),
  ];

  printHeading('Summary');
  console.log(
    `  ${parts.join(', ')} ${paint('dim', `in ${formatDuration(totals.durationMs)}`)}`,
  );
}

/**
 * Restores the default terminal attributes. Docker can leave colors or other
 * attributes set when it is interrupted or when it writes to the terminal
 * directly, which would tint everything printed afterwards.
 */
export function resetTerminal(): void {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream.isTTY) {
      stream.write('\u001B[0m');
    }
  }
}
