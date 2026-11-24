# Testing

## Purpose

The image bundles nginx, PHP-FPM, supervisord, cron, and fail2ban around a stock Nextcloud release, and none of that wiring is covered by Nextcloud's own tests. The image test flow checks what this project adds: that a freshly built image installs, serves the everyday Nextcloud operations through its web stack, and keeps its security configuration. It is a black-box check. It uses only the interfaces a user or administrator has (HTTP, `occ`, and commands run inside the containers) and never inspects the database.

## Running the flow

All commands run from the repository root and need Node.js 24 or later, `npm install`, and Docker with Compose 2.23.1 or later. They work on Linux, macOS, and Windows. Each entrypoint prints its usage and options with `--help`.

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the image as `nextcloud-custom:dev`. |
| `npm test` | Build the image, run the complete flow, and remove everything afterwards. |
| `npm run dev -- up` | Start a persistent stack with fixed addresses and an installed instance, and print its login. `--build` builds the image first. |
| `npm run dev -- down` | Remove the development stack and its volumes. |
| `npm run dev -- logs\|shell\|occ` | Follow the logs, open a shell, or run `occ` inside the development stack. |
| `npm run clean` | Remove leftover test environments and the images that the scripts built. See [Cleaning up](#cleaning-up). |

`npm test -- --skip-build` reuses an existing image, `--suite <name>` runs selected suites (the installation always runs first), `--list` shows the suites, and `--keep` leaves the environment running for inspection until `npm run clean` removes it. `npm run verify` checks the formatting, lint rules, and types of the scripts, as described in [the development standards](./standards/nextcloud-custom/development.md).

## Test environment

The environment is defined in `tests/`. `tests/docker-compose.yml` runs the locally built image with MariaDB and Redis, using the same database settings as the example `docker-compose.yml`, and publishes its ports on the loopback address only. Two more services of the same image serve the tests:

- `client` runs next to the web container with an address of its own. Requests that must look like they come from another machine, such as the failed logins of the `abuse` suite, are sent from it, so the address of the test host is never throttled or banned. Its `openssl` also probes protocol versions that Node.js no longer offers.
- `cloud-mounted` is the image without Nextcloud, started on demand with a certificate that the test wrote into a shared volume, to check that a mounted certificate is served and left alone.

Nextcloud settings that only the tests need live in `tests/config/*.config.php`. Nextcloud loads every `*.config.php` file after `config.php` and lets later files win, so the overrides neither edit the generated `config.php` nor leak into the example stack. They point server-side requests at the HTTPS port inside the container, silence setup warnings that every administrator decides for themselves, and switch off the update checker and internet connectivity. The last two keep the flow independent of the internet: without them, cron waits for external servers and takes minutes. As a consequence the flow does not exercise the app store or update notifications.

Every `npm test` run uses its own Compose project with throwaway named volumes and random published ports, so runs never share state and never collide with a development stack or with ports in use. Docker may assign other host ports when the web container restarts, so suites read the addresses from the environment object rather than keeping them. The flow removes the project when it finishes, fails, or receives an interrupt. The development stack uses a project of its own with fixed ports (18080 and 18443) and fixed credentials, which `up` prints, so that it can be started again and reused.

## Flow

1. Build the image, unless `--skip-build` is given.
2. Start the stack and wait until the web container reports healthy.
3. Run the suites in order, each starting from the state the previous ones left. The first suite initializes Nextcloud through the web installer, so every run exercises a first start with an empty data directory.
4. Remove the environment, unless `--keep` is given, and print the summary.

Each step prints a heading with its position and the total, such as `[2/4]`. A step that the run skips, such as the build with `--skip-build`, is not counted, so the numbers stay contiguous, and the removal keeps its number when an earlier step fails or the run is interrupted. The suites are numbered the same way inside the third step, as `(2/11)`. The summary comes last, so that it is what remains on screen.

A failed case does not stop its suite, because later cases usually still say something useful. A failed installation stops the flow, since nothing after it can run. The order puts suites that change the environment last: `container` restarts the web container, and `abuse` bans an address until the case restores it.

## Cleaning up

A run that ends normally removes its own environment, and one that receives SIGINT or SIGTERM does as well. `npm run clean` removes what is left when that did not happen: a run that was killed, or one that used `--keep`. It also removes the images that the scripts built, which are large.

`clean` recognizes its targets instead of removing everything that Docker lists. Test environments are the Compose projects named `nextcloud-custom-test-` with a hexadecimal suffix. Images are the default tag `nextcloud-custom:dev` and every image that carries the label the build script sets, which also covers an older build that a rebuild left without a tag. Tags that the scripts did not build, such as an image from a manual `docker build`, stay unless `--image <tag>` names them. The MariaDB and Redis images and the Docker build cache are shared with other projects and are never touched.

The development stack holds the data of manual work, so `clean` keeps it unless `--dev` is given. An image stays while a container uses it, and `clean` then exits with 1 and says which container. `--dry-run` lists what would be removed. Do not run it while `npm test` is running, because it would remove that run's environment.

## Suites

Each suite tests at one seam. The first six cover the everyday operations through the HTTP API.

| Suite | Seam | Verifies |
| --- | --- | --- |
| `install` | HTTP | The web installer shows the preset data directory and no problem, installs the version the Dockerfile pins, creates the administrator, and a wrong password gets 401. |
| `users` | OCS | Users and a group are created and read back, a regular user logs in but cannot provision, a disabled user is locked out, app passwords work until revoked, and requests without credentials are refused. |
| `files` | WebDAV | Folders and files, names with spaces and Chinese characters, versions, move and copy, trash and restore, range requests, and image previews. |
| `uploads` | WebDAV | A 128 MiB upload in one request and a chunked upload, each downloaded and compared by SHA-256. |
| `sharing` | OCS and public WebDAV | Public links with and without a password, shares with users, read-only enforcement, and revoking a share. |
| `groupware` | CalDAV and CardDAV | The default calendar and address book, an event and a contact stored and read back, and the `.well-known` redirects. |
| `edge-security` | HTTP, HTTPS, and TLS | The HTTP to HTTPS redirect, TLS versions, cipher policy, and certificate, the security headers on every kind of response, blocked paths, no PHP source or version disclosure, no directory listing, authentication on DAV and OCS, untrusted host rejection, and an ignored forged `X-Forwarded-For`. |
| `malicious-requests` | raw HTTP over TLS | Path traversal in raw and encoded forms against the blocked paths, a data file that holds PHP code addressed as a script, requests with ambiguous framing or invalid syntax, oversized headers, unusual methods, and line breaks in the request target. Nginx itself refuses each one with an error page of its own, nothing is read or run, and the server keeps serving. |
| `container` | commands in the containers | The pinned nginx and PHP versions, supervisord programs, the user of each worker process, the effective nginx and PHP settings, PHP extensions, permissions of the configuration, data, session, and key paths, no private key in the image, a generated or mounted certificate, cron, nginx logging to the container output, the time zone, and persistence across a restart. |
| `occ-checks` | `occ` and the admin setup checks | `occ status`, `occ integrity:check-core`, and the setup checks (through `occ` and the admin HTTP endpoint) report no error beyond a short list of known warnings, the checks that depend on the web stack must succeed, `nextcloud-upgrade` runs through, and maintenance mode answers 503. |
| `abuse` | HTTP from the `client` container | Failed logins throttle their own address only, the fail2ban filter matches the log lines that Nextcloud writes, and fail2ban cuts off an address after repeated failures and lets it back in after an unban. |

### Crafted requests

The `malicious-requests` suite tests the nginx configuration, not Nextcloud. Every case requires that nginx itself refuses the request: the status is one of the set that nginx uses for that kind of refusal, and the body is an error page that nginx generates. A refusal by PHP-FPM or Nextcloud, which should never have received the request, fails the case even when the status looks right. The body must also hold none of the markers of a leaked configuration or system file, and a later request must still be served.

An HTTP client normalizes what it sends: a URL object resolves `..` segments, and Node.js refuses a request target with a space or a line break. The suite therefore sends the request target byte for byte, and writes the bytes of invalid requests straight to a socket.

Two layers guard a data file against being run as a script: nginx rewrites every `.php` path outside the known entry points to `index.php`, and the PHP location answers 404 when the script file does not exist. The probe file is named `index-probe.png` so that its requests get past the rewrite and test the second layer.

## Security sources

Nextcloud's public Security Scan at scan.nextcloud.com cannot scan a stack on the developer's machine, so the flow reimplements what that scan and the [hardening guide](https://docs.nextcloud.com/server/stable/admin_manual/installation/harden_server.html) check: reachable internal paths, security headers, HTTPS, and the version and brute-force hardening. It adds checks the scan does not do, such as the TLS policy, the effective nginx configuration, and crafted requests. Nextcloud's own checks, which the admin Overview page shows, run through `occ setupchecks` and its HTTP endpoint, so they follow the release that the Dockerfile pins. Run the public scan, and optionally `testssl.sh`, against a deployment that is reachable from the internet before a release.

## Limits

The flow drives the HTTP API, so it does not exercise the browser UI or JavaScript. Large-file cases use sizes that finish in seconds, not the 100 GB limit of the image. The crafted requests are a fixed set of samples, not a fuzzer, and nothing in the image filters requests by content: nginx refuses what it cannot parse and what its location rules block, and fail2ban reacts to failed logins. How Nextcloud treats hostile input that nginx passes on, such as a `..` in a DAV path or injection strings in its parameters, is the responsibility of upstream and is not tested. Slow connections, such as slow headers or bodies, depend on the nginx timeouts and are not exercised. The `abuse` suite needs `NET_ADMIN` and iptables inside the container, as fail2ban does in production. The scripts under `scripts/` have no tests of their own: the flow exercises them, and a failure in them shows up as a failure of the flow.
