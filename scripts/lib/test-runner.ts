// Runs suites of test cases in order and reports the outcome.

import { describeError } from './cli.ts';
import {
  formatDuration,
  printCaseResult,
  printFailureDetail,
  printSubheading,
  printInfo,
} from './terminal.ts';
import type { TestEnvironment } from './test-environment.ts';

const DEFAULT_CASE_TIMEOUT_MS = 120_000;

export interface TestCase {
  /** The behavior and its expected outcome, for example "login succeeds". */
  name: string;
  /** Throws when the behavior is not as expected. */
  run(env: TestEnvironment): Promise<void>;
  timeoutMs?: number;
}

export interface Suite {
  name: string;
  /** What the suite checks and through which seam, in one line. */
  summary: string;
  /** The flow stops when a case of a critical suite fails. */
  critical?: boolean;
  cases: TestCase[];
}

export interface FlowResult {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: Array<{ suite: string; name: string; message: string }>;
}

/** Runs one case with a timeout, so that a hung request cannot stall the flow. */
async function runWithTimeout(
  testCase: TestCase,
  env: TestEnvironment,
): Promise<void> {
  const timeoutMs = testCase.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${formatDuration(timeoutMs)}`));
    }, timeoutMs);
  });

  try {
    await Promise.race([testCase.run(env), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tells whether the flow was aborted. A function keeps TypeScript from
 * assuming that the flag stays false across an `await`.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Runs the suites in the given order against one environment. When the
 * signal aborts, the runner stops at once and reports nothing more, because
 * the environment is being removed under the running case.
 */
export async function runSuites(
  suites: Suite[],
  env: TestEnvironment,
  signal: AbortSignal,
): Promise<FlowResult> {
  const started = Date.now();
  const result: FlowResult = {
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    failures: [],
  };
  let stopped = false;

  for (const [index, suite] of suites.entries()) {
    const position = `(${String(index + 1)}/${String(suites.length)})`;

    printSubheading(`${suite.name} ${position} — ${suite.summary}`);

    for (const testCase of suite.cases) {
      if (isAborted(signal)) {
        return result;
      }

      if (stopped) {
        printCaseResult('skipped', testCase.name, 0);
        result.skipped++;
        continue;
      }

      const caseStarted = Date.now();

      try {
        await runWithTimeout(testCase, env);
        printCaseResult('passed', testCase.name, Date.now() - caseStarted);
        result.passed++;
      } catch (error: unknown) {
        if (isAborted(signal)) {
          return result;
        }

        const message = describeError(error);

        printCaseResult('failed', testCase.name, Date.now() - caseStarted);
        printFailureDetail(message);
        result.failed++;
        result.failures.push({
          suite: suite.name,
          name: testCase.name,
          message,
        });

        if (suite.critical === true) {
          stopped = true;
          printInfo('  The remaining cases cannot run without this one.');
        }
      }
    }
  }

  result.durationMs = Date.now() - started;

  return result;
}
