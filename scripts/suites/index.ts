// The suites of the image test flow, in the order they run.

import type { Suite } from '../lib/test-runner.ts';
import { abuseSuite } from './abuse.ts';
import { containerSuite } from './container.ts';
import { edgeSecuritySuite } from './edge-security.ts';
import { filesSuite } from './files.ts';
import { groupwareSuite } from './groupware.ts';
import { installSuite } from './install.ts';
import { maliciousRequestsSuite } from './malicious-requests.ts';
import { occChecksSuite } from './occ-checks.ts';
import { sharingSuite } from './sharing.ts';
import { uploadsSuite } from './uploads.ts';
import { usersSuite } from './users.ts';

/**
 * Every suite starts from the state the previous ones left, so the order
 * matters: initialization comes first and destructive suites come last.
 */
export const SUITES: Suite[] = [
  installSuite,
  usersSuite,
  filesSuite,
  uploadsSuite,
  sharingSuite,
  groupwareSuite,
  edgeSecuritySuite,
  maliciousRequestsSuite,
  containerSuite,
  occChecksSuite,
  abuseSuite,
];
