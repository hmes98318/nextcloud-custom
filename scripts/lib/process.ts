// Running child processes without a shell, on every platform.

import { spawn } from 'node:child_process';
import { constants } from 'node:os';

import { resetTerminal } from './terminal.ts';

export interface RunOptions {
  /** Working directory. Defaults to the current directory. */
  cwd?: string;
  /** Environment variables added to the current environment. */
  env?: Record<string, string>;
  /** Text written to the standard input of the process. */
  input?: string;
  /** Called for every complete line of standard output and standard error. */
  onLine?: (line: string) => void;
  /** Kills the process after this time. */
  timeoutMs?: number;
}

export interface RunResult {
  /** Exit code, or -1 when the process was killed by the timeout. */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Builds the environment of a child process. Colors are turned off so that
 * tools such as Docker print plain text that this tooling can style itself.
 */
function childEnvironment(
  extra: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };

  delete env.FORCE_COLOR;
  env.NO_COLOR = '1';

  return env;
}

/** Splits streamed text into complete lines and reports each one. */
function createLineSplitter(onLine: (line: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let pending = '';

  return {
    push(chunk: string): void {
      pending += chunk;

      const lines = pending.split(/\r?\n|\r/);

      pending = lines.pop() ?? '';

      for (const line of lines) {
        onLine(line);
      }
    },
    flush(): void {
      if (pending !== '') {
        onLine(pending);
      }

      pending = '';
    },
  };
}

/**
 * Runs a program and collects its output. The promise resolves with the exit
 * code, even when it is not zero, and rejects only when the program cannot be
 * started.
 */
export function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: childEnvironment(options.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const report = options.onLine ?? ((): void => undefined);
    const outLines = createLineSplitter(report);
    const errLines = createLineSplitter(report);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      outLines.push(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      errLines.push(chunk);
    });

    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeoutMs);

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);

      if (error.code === 'ENOENT') {
        reject(new Error(`Command not found: ${command}`));
      } else {
        reject(error);
      }
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      outLines.flush();
      errLines.flush();
      resolve({ code: timedOut ? -1 : (code ?? -1), stdout, stderr });
    });

    // A program that exits early closes its input; that is not an error here.
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input);
  });
}

/** Runs a program and throws when it exits with a non-zero code. */
export async function runChecked(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const result = await run(command, args, options);

  if (result.code !== 0) {
    const output = (result.stderr || result.stdout).trim();
    const tail = output.split('\n').slice(-12).join('\n');

    throw new Error(
      `${command} ${args.join(' ')} exited with code ${String(result.code)}\n${tail}`,
    );
  }

  return result;
}

/**
 * Runs a program attached to the terminal, for interactive use such as a
 * shell or a log stream. Resolves with the exit code of the program.
 */
export function runInteractive(
  command: string,
  args: string[],
  options: Pick<RunOptions, 'cwd' | 'env'> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`Command not found: ${command}`));
      } else {
        reject(error);
      }
    });

    // A signal that reaches only this process, for example from `kill`,
    // would otherwise leave the program running without its parent.
    const forward = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };

    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
      resetTerminal();
      resolve(code ?? (signal === null ? 1 : 128 + constants.signals[signal]));
    });
  });
}
