// Command-line parsing and the main wrapper shared by the entrypoints.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';

import { printError, resetTerminal } from './terminal.ts';

/** Reads the Usage and Options text from the header comment of a script. */
function readUsage(sourceFile: string): string {
  const source = readFileSync(sourceFile, 'utf8');
  const header = /\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? '';

  return header
    .split('\n')
    .map(line => line.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();
}

/** Prints the usage text of a script and exits. */
function exitWithUsage(sourceFile: string, code: number): never {
  console.log(readUsage(sourceFile));
  process.exit(code);
}

/**
 * Parses the command line against the declared options. `--help` and `-h`
 * print the header comment of the entrypoint, so the usage is written once.
 * Invalid options print the problem and exit with code 2.
 */
export function parseCommandLine<const T extends ParseArgsConfig>(
  sourceFile: string,
  config: T,
): ReturnType<typeof parseArgs<T>> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    exitWithUsage(sourceFile, 0);
  }

  try {
    return parseArgs(config);
  } catch (error: unknown) {
    printError(describeError(error));
    console.error('Run with --help to see the usage.');
    process.exit(2);
  }
}

/** Returns the message of an error, or a description of any other value. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the main function of an entrypoint. It becomes the exit code of the
 * process, and an error is reported in one line instead of a stack trace.
 */
export async function runMain(
  main: () => Promise<number | undefined>,
): Promise<void> {
  try {
    process.exitCode = (await main()) ?? 0;
  } catch (error: unknown) {
    printError(describeError(error));
    process.exitCode = 1;
  } finally {
    resetTerminal();
  }
}
