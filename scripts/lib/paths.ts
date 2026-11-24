// Locations and names shared by the development scripts.

import { resolve } from 'node:path';

/** The repository root, which is also the Docker build context. */
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** The Compose file of the test environment. */
export const TEST_COMPOSE_FILE = resolve(
  REPO_ROOT,
  'tests',
  'docker-compose.yml',
);

/** The tag of the image built for development and tests. */
export const DEFAULT_IMAGE = 'nextcloud-custom:dev';

/**
 * The label that `npm run build` puts on every image it builds. A rebuild
 * moves the tag to the new image and leaves the old one without a tag, and
 * the label is how `npm run clean` still finds it.
 */
export const IMAGE_LABEL = 'io.github.hmes98318.nextcloud-custom.build=local';

/** The Compose project of the persistent development stack. */
export const DEV_PROJECT_NAME = 'nextcloud-custom-dev';

/** The Compose project of a test run is this prefix and a random hex suffix. */
export const TEST_PROJECT_PREFIX = 'nextcloud-custom-test-';
