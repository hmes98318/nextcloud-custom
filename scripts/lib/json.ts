// Type guards for data that arrives as `unknown`, such as parsed JSON.

/** True for a plain object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a nested property, following object keys and array indexes. Returns
 * `undefined` when any step does not exist.
 */
export function getPath(
  value: unknown,
  ...path: Array<string | number>
): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(current)) {
        return undefined;
      }

      current = current[key];
    } else {
      if (!isRecord(current)) {
        return undefined;
      }

      current = current[key];
    }
  }

  return current;
}

/** Returns the value as a string, or throws a description of what is wrong. */
export function expectString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `Expected ${what} to be a string, got ${describe(value)}`,
    );
  }

  return value;
}

/** Returns the value as a number, or throws a description of what is wrong. */
export function expectNumber(value: unknown, what: string): number {
  if (typeof value !== 'number') {
    throw new TypeError(
      `Expected ${what} to be a number, got ${describe(value)}`,
    );
  }

  return value;
}

/** Returns the value as an array, or throws a description of what is wrong. */
export function expectArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `Expected ${what} to be an array, got ${describe(value)}`,
    );
  }

  return value;
}

/** Returns the value as an object, or throws a description of what is wrong. */
export function expectRecord(
  value: unknown,
  what: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(
      `Expected ${what} to be an object, got ${describe(value)}`,
    );
  }

  return value;
}

/** Parses JSON text into `unknown` so that callers must validate it. */
export function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);

  return value;
}

/** Short description of a value for error messages. */
function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'an array';
  }

  return typeof value;
}
