// WebDAV helpers: PROPFIND requests and reading the XML multistatus replies.
//
// Replies are matched with regular expressions on purpose: the tests only need
// a few properties, and an XML parser would be a dependency for little gain.

import type { HttpResponse } from './http.ts';
import type { NextcloudClient } from './nextcloud.ts';

const PROPFIND_BODY = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <oc:fileid/>
    <d:getcontentlength/>
    <d:getetag/>
  </d:prop>
</d:propfind>`;

/** Lists a collection (depth 1) or describes one resource (depth 0). */
export function propfind(
  client: NextcloudClient,
  url: string,
  depth: '0' | '1' = '1',
): Promise<HttpResponse> {
  return client.request(url, {
    method: 'PROPFIND',
    headers: { depth, 'Content-Type': 'application/xml' },
    body: PROPFIND_BODY,
  });
}

/** Replaces the five predefined XML entities. */
function decodeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** Returns the text of every `<tag>` element, such as `d:href` or `oc:fileid`. */
export function xmlValues(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');

  return [...xml.matchAll(pattern)].map(match => decodeXml(match[1] ?? ''));
}

/** Returns the decoded names that a PROPFIND reply lists, last segment only. */
export function listedNames(xml: string): string[] {
  return xmlValues(xml, 'd:href').map(href => {
    const segments = href.split('/').filter(segment => segment !== '');

    return decodeURIComponent(segments.at(-1) ?? '');
  });
}
