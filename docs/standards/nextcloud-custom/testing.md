# Testing

## Policy

| Surface | Requirement |
| --- | --- |
| Image behavior and security configuration: the `Dockerfile`, the `overlay/` configuration files, and the test environment in `tests/` | Covered by the image test flow (`npm test`), described in `docs/testing.md` |
| Shell scripts under `overlay/` | No dedicated tests; the image test flow exercises them through the running container |
| `docker-compose.yml` and `deployment.yaml` | Not required |
| TypeScript tooling under `scripts/` | No unit tests; checked by `npm run verify` and by running the entrypoints |

## Change Obligations

- A change that alters behavior or security configuration that the image test flow covers updates the flow in the same change, and runs it before the change is finished.
- Do not add a unit-test framework or unit tests for the tooling under `scripts/`, the shell scripts, or the example manifests unless the task explicitly requires it.
- This does not disable the configured formatting, linting, build, and CI checks, which still apply.

## Test Design

- Test what the image adds: the container, its web stack (nginx, PHP-FPM, cron, fail2ban), and their configuration. Use Nextcloud as the workload that proves the stack serves it, and do not test Nextcloud's own behavior, such as how its application handles hostile input, which is the responsibility of upstream.
- Test through public seams only: the HTTP interface of the running container, the `occ` command, and commands run inside the container that observe its configuration, processes, and files. Do not read the database or other internal state as a side channel to verify behavior.
- Run every flow from an uninitialized instance on the freshly built image, and remove all containers, networks, and volumes when the flow ends or is interrupted.
- Use the real services (MariaDB, Redis, nginx, PHP-FPM) in Docker, never mocks. Keep test credentials and configuration inside `tests/`, and never depend on the maintainer's environment, ports, or stored data.
- Write cases as vertical slices: one behavior through one seam, named after the behavior and its expected outcome. Drive new behavior with the failing case first, then change the image only as far as the case requires.
- Derive security assertions from the Nextcloud hardening guide and from Nextcloud's own setup checks, and cite the guide section in a comment when a case enforces a specific recommendation.
- Order cases so that destructive ones (brute-force throttling and bans) run last, and always lift their effects before the flow ends.
