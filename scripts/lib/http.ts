// A small HTTP client for the test environment, built on Node.js core modules.
//
// The test stack serves a self-signed certificate, so certificate checks are
// off. Redirects are never followed, because tests assert on them.

import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import { urlToHttpOptions } from 'node:url';

import { parseJson } from './json.ts';

const DEFAULT_TIMEOUT_MS = 120_000;
const RAW_TIMEOUT_MS = 10_000;

export interface BasicAuth {
  user: string;
  password: string;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** A stream needs a `Content-Length` header, to avoid chunked encoding. */
  body?: string | Uint8Array | Readable;
  basicAuth?: BasicAuth;
  /** Maximum idle time of the connection. */
  timeoutMs?: number;
  /** How many redirects to follow. By default none, so tests can see them. */
  maxRedirects?: number;
  /**
   * The request target to send byte for byte, in place of the path of the
   * URL. A URL object resolves `.` and `..` segments, so a traversal attempt
   * has to be given here to reach the server unchanged.
   */
  rawPath?: string;
}

export interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /** The body decoded as UTF-8 text. */
  text(): string;
  /** The body parsed as JSON, typed `unknown` so that callers validate it. */
  json(): unknown;
  /** One header as a single string; list headers are joined with a comma. */
  header(name: string): string | undefined;
}

export interface HttpDigest {
  status: number;
  headers: IncomingHttpHeaders;
  bytes: number;
  /** SHA-256 of the body, as lowercase hex. */
  sha256: string;
}

/** Sends a request and resolves when the response headers have arrived. */
function send(
  url: string,
  options: HttpRequestOptions,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const headers: Record<string, string> = { ...options.headers };

    if (options.basicAuth !== undefined) {
      const { user, password } = options.basicAuth;
      const token = Buffer.from(`${user}:${password}`).toString('base64');

      headers.Authorization = `Basic ${token}`;
    }

    const { body } = options;
    const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;

    if (payload instanceof Uint8Array) {
      headers['Content-Length'] = String(payload.byteLength);
    }

    const settings = {
      ...urlToHttpOptions(target),
      method: options.method ?? 'GET',
      headers,
      agent: false,
    };

    if (options.rawPath !== undefined) {
      settings.path = options.rawPath;
    }

    const onResponse = (response: IncomingMessage): void => {
      resolve(response);
    };
    const request =
      target.protocol === 'https:'
        ? httpsRequest({ ...settings, rejectUnauthorized: false }, onResponse)
        : httpRequest(settings, onResponse);

    request.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out: ${url}`));
    });
    request.on('error', reject);

    if (payload === undefined) {
      request.end();
    } else if (payload instanceof Uint8Array) {
      request.end(payload);
    } else {
      payload.on('error', reject);
      payload.pipe(request);
    }
  });
}

/** Reads a response body completely. */
function readBody(response: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    response.on('error', reject);
  });
}

/** Sends one request and returns the complete response. */
async function fetchOnce(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const response = await send(url, options);
  const body = await readBody(response);
  const { headers } = response;

  return {
    status: response.statusCode ?? 0,
    headers,
    body,
    text: () => body.toString('utf8'),
    json: () => parseJson(body.toString('utf8')),
    header(name: string): string | undefined {
      const value = headers[name.toLowerCase()];

      return Array.isArray(value) ? value.join(', ') : value;
    },
  };
}

/** Sends a request and returns the complete response. */
export async function fetchUrl(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  let target = url;
  let response = await fetchOnce(target, options);

  for (let followed = 0; followed < (options.maxRedirects ?? 0); followed++) {
    const location = response.header('location');

    if (response.status < 300 || response.status >= 400 || !location) {
      break;
    }

    target = new URL(location, target).toString();
    response = await fetchOnce(target, {
      ...options,
      method: 'GET',
      body: undefined,
    });
  }

  return response;
}

/**
 * Sends a request and returns only the size and SHA-256 of the body, so that
 * large downloads are verified without holding them in memory.
 */
export async function fetchDigest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpDigest> {
  const response = await send(url, options);

  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let bytes = 0;

    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    response.on('end', () => {
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        bytes,
        sha256: hash.digest('hex'),
      });
    });
    response.on('error', reject);
  });
}

/** What a server sent back for bytes written to a socket. */
export interface RawResponse {
  /** The status code, or undefined when no status line arrived. */
  status: number | undefined;
  /** The status line and the headers, as text. */
  head: string;
  /** Everything after the headers, undecoded. */
  body: string;
  /**
   * How the exchange ended: the server closed the connection, or it was
   * still waiting when the time ran out.
   */
  ended: 'closed' | 'timeout';
}

/** Splits what a socket received into the parts of a response. */
function parseRawResponse(
  text: string,
  ended: RawResponse['ended'],
): RawResponse {
  const separator = text.indexOf('\r\n\r\n');
  const head = separator === -1 ? text : text.slice(0, separator);
  const body = separator === -1 ? '' : text.slice(separator + 4);
  const code = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(head)?.[1];

  return {
    status: code === undefined ? undefined : Number(code),
    head,
    body,
    ended,
  };
}

/**
 * Writes bytes to a connection as they are and returns what the server sends
 * back, so that tests can send requests that no HTTP client would produce.
 * Rejects when the connection cannot be made.
 */
export function sendRaw(
  url: string,
  payload: string | Uint8Array,
  timeoutMs: number = RAW_TIMEOUT_MS,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const secure = target.protocol === 'https:';
    const options = {
      host: target.hostname,
      port: Number(target.port) || (secure ? 443 : 80),
    };
    const chunks: Buffer[] = [];
    let connected = false;
    let finished = false;

    // The listener runs once the connection, including TLS, is ready.
    const onConnect = (): void => {
      connected = true;
      socket.write(payload);
    };
    const socket: Socket = secure
      ? tlsConnect({ ...options, rejectUnauthorized: false }, onConnect)
      : netConnect(options, onConnect);
    const finish = (ended: RawResponse['ended']): void => {
      if (!finished) {
        finished = true;
        socket.destroy();
        resolve(
          parseRawResponse(Buffer.concat(chunks).toString('latin1'), ended),
        );
      }
    };

    socket.setTimeout(timeoutMs, () => {
      finish('timeout');
    });
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('end', () => {
      finish('closed');
    });
    socket.on('close', () => {
      finish('closed');
    });
    socket.on('error', (error: Error) => {
      // A reset after the request went out is how a server refuses it.
      if (connected) {
        finish('closed');
      } else if (!finished) {
        finished = true;
        reject(error);
      }
    });
  });
}
