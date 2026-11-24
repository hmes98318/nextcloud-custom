// Calendar and contacts over CalDAV and CardDAV, and their discovery URLs.

import assert from 'node:assert/strict';

import { fetchUrl } from '../lib/http.ts';
import type { Suite } from '../lib/test-runner.ts';
import { listedNames, propfind } from '../lib/webdav.ts';

const EVENT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//nextcloud-custom//test//EN',
  'BEGIN:VEVENT',
  'UID:test-event-1@nextcloud-custom',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260102T090000Z',
  'DTEND:20260102T100000Z',
  'SUMMARY:Image test event',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const CONTACT = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:test-contact-1@nextcloud-custom',
  'FN:Test Person',
  'N:Person;Test;;;',
  'EMAIL:test.person@example.com',
  'END:VCARD',
  '',
].join('\r\n');

export const groupwareSuite: Suite = {
  name: 'groupware',
  summary: 'store a calendar event and a contact over CalDAV and CardDAV',
  cases: [
    {
      name: 'the default calendar and address book exist for a user',
      async run(env) {
        const alice = env.client(env.users.alice);
        const user = env.users.alice.user;
        const calendars = await propfind(
          alice,
          `${alice.baseUrl}/remote.php/dav/calendars/${user}/`,
        );
        const books = await propfind(
          alice,
          `${alice.baseUrl}/remote.php/dav/addressbooks/users/${user}/`,
        );

        assert.equal(calendars.status, 207);
        assert.ok(
          listedNames(calendars.text()).includes('personal'),
          'the personal calendar exists',
        );
        assert.equal(books.status, 207);
        assert.ok(
          listedNames(books.text()).includes('contacts'),
          'the contacts address book exists',
        );
      },
    },
    {
      name: 'a calendar event is stored and read back',
      async run(env) {
        const alice = env.client(env.users.alice);
        const url = `${alice.baseUrl}/remote.php/dav/calendars/${env.users.alice.user}/personal/test-event.ics`;
        const created = await alice.request(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
          body: EVENT,
        });
        const read = await alice.request(url);

        assert.equal(created.status, 201);
        assert.equal(read.status, 200);
        assert.match(read.text(), /SUMMARY:Image test event/);
      },
    },
    {
      name: 'a contact is stored and read back',
      async run(env) {
        const alice = env.client(env.users.alice);
        const url = `${alice.baseUrl}/remote.php/dav/addressbooks/users/${env.users.alice.user}/contacts/test-contact.vcf`;
        const created = await alice.request(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
          body: CONTACT,
        });
        const read = await alice.request(url);

        assert.equal(created.status, 201);
        assert.equal(read.status, 200);
        assert.match(read.text(), /FN:Test Person/);
      },
    },
    {
      name: 'the well-known URLs send CalDAV and CardDAV clients to the DAV endpoint',
      async run(env) {
        for (const service of ['caldav', 'carddav']) {
          const response = await fetchUrl(
            `${env.httpsUrl}/.well-known/${service}`,
          );

          assert.equal(response.status, 301, service);
          assert.equal(
            response.header('location'),
            '/remote.php/dav/',
            service,
          );
        }
      },
    },
  ],
};
