// Reading build arguments from the Dockerfile, the source of truth for the
// versions that the image installs.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './paths.ts';

/** Returns the default value of an `ARG` declared at the top of the Dockerfile. */
export function readDockerfileArg(name: string): string {
  const dockerfile = readFileSync(resolve(REPO_ROOT, 'Dockerfile'), 'utf8');
  const pattern = new RegExp(`^ARG ${name}=(\\S+)$`, 'm');
  const value = pattern.exec(dockerfile)?.[1];

  if (value === undefined) {
    throw new Error(`The Dockerfile declares no ARG ${name}`);
  }

  return value;
}
