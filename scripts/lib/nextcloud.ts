// Calling a Nextcloud server over HTTP: the web installer, OCS, and WebDAV.

import { fetchUrl } from './http.ts';
import type { BasicAuth, HttpRequestOptions, HttpResponse } from './http.ts';
import {
  expectNumber,
  expectRecord,
  expectString,
  getPath,
  parseJson,
} from './json.ts';

/** The data directory of this image, preset in the web installer. */
export const DATA_DIRECTORY = '/var/www/html/nextclouddata';

/**
 * Reads the initial state that Nextcloud embeds in a page as base64 JSON in
 * a hidden input, such as `core-config` on the installer page.
 */
export function readInitialState(html: string, key: string): unknown {
  const pattern = new RegExp(`id="initial-state-${key}" value="([^"]+)"`);
  const encoded = expectString(pattern.exec(html)?.[1], `initial state ${key}`);

  return parseJson(Buffer.from(encoded, 'base64').toString('utf8'));
}

export interface DatabaseSettings {
  user: string;
  password: string;
  name: string;
  host: string;
}

export interface InstallSettings {
  admin: BasicAuth;
  database: DatabaseSettings;
  dataDirectory: string;
}

/**
 * Initializes an empty Nextcloud through the web installer, the same way the
 * browser does: one form POST to the start page.
 */
export function installNextcloud(
  baseUrl: string,
  settings: InstallSettings,
): Promise<HttpResponse> {
  const form = new URLSearchParams({
    install: 'true',
    adminlogin: settings.admin.user,
    adminpass: settings.admin.password,
    directory: settings.dataDirectory,
    dbtype: 'mysql',
    dbuser: settings.database.user,
    dbpass: settings.database.password,
    dbname: settings.database.name,
    dbhost: settings.database.host,
  });

  return fetchUrl(`${baseUrl}/index.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    // The installer creates the database schema before it answers.
    timeoutMs: 600_000,
  });
}

/** The parsed envelope of an OCS API response. */
export interface OcsResult {
  http: HttpResponse;
  /** The OCS status code of the response body, such as 200 for success. */
  statusCode: number;
  data: unknown;
}

export interface NextcloudClient {
  readonly baseUrl: string;
  readonly auth: BasicAuth;
  /** Sends an authenticated request to a path or a full URL of the server. */
  request(path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  /** Calls the OCS API (version 2) and parses its JSON envelope. */
  ocs(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    form?: Record<string, string>,
  ): Promise<OcsResult>;
  /** The WebDAV URL of a file or folder in the files of the user. */
  fileUrl(path: string, user?: string): string;
}

/** Encodes each segment of a slash-separated path. */
function encodePath(path: string): string {
  return path
    .split('/')
    .filter(segment => segment !== '')
    .map(encodeURIComponent)
    .join('/');
}

/** Creates a client that authenticates every request with HTTP Basic auth. */
export function createClient(
  baseUrl: string,
  auth: BasicAuth,
): NextcloudClient {
  const request = (
    path: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse> =>
    fetchUrl(path.startsWith('http') ? path : `${baseUrl}${path}`, {
      ...options,
      basicAuth: auth,
      headers: { 'OCS-APIRequest': 'true', ...options.headers },
    });

  return {
    baseUrl,
    auth,
    request,

    async ocs(method, path, form): Promise<OcsResult> {
      const separator = path.includes('?') ? '&' : '?';
      const options: HttpRequestOptions = {
        method,
        headers: { accept: 'application/json' },
      };

      if (form !== undefined) {
        options.headers = {
          ...options.headers,
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        options.body = new URLSearchParams(form).toString();
      }

      const http = await request(
        `/ocs/v2.php${path}${separator}format=json`,
        options,
      );
      const envelope = expectRecord(http.json(), 'the OCS response');
      const statusCode = expectNumber(
        getPath(envelope, 'ocs', 'meta', 'statuscode'),
        'ocs.meta.statuscode',
      );

      return { http, statusCode, data: getPath(envelope, 'ocs', 'data') };
    },

    fileUrl(path: string, user: string = auth.user): string {
      const encoded = encodePath(path);

      return `${baseUrl}/remote.php/dav/files/${encodeURIComponent(user)}/${encoded}`;
    },
  };
}
