# Development

## Image Build

- Pin every build input to an explicit version: the Nextcloud and nginx versions and base image tags are declared as `ARG` values at the top of the `Dockerfile`, and PHP extensions installed with PIE name an exact version. Never use floating tags such as `latest` for build inputs. The nginx Brotli module (`ngx_brotli`) is the one exception and tracks the upstream default branch.
- Keep the image buildable and runnable on both `linux/amd64` and `linux/arm64`. Do not add architecture-specific or host-specific compiler flags, such as `-m64`, `-march=native`, or `-mtune=native`, or architecture-specific package names or paths.
- Install packages with `--no-install-recommends` and run `apt-get update` in every `RUN` that installs packages, and remove the apt package lists once, at the end of the last `RUN` that uses apt. Use one `RUN` per category (system packages, nginx, PHP extensions) so a failure points to its category and a change rebuilds only that layer. Apply the pending Debian updates with `apt-get upgrade` in the first of them.
- Keep downloads and build-only tooling in separate build stages, and copy only the results into the runtime stage.
- Install runtime configuration through the `Dockerfile` from the `overlay/` directory. Do not edit files inside the image by other means, and remove packaged defaults that would shadow the overlay configuration. Keep example files out of the image with `.dockerignore`.
- Never put a private key, certificate, or other secret in the image. The TLS certificate is mounted at `/etc/nginx/ssl` or generated when the container starts.
- Run every long-lived process through `overlay/supervisord.conf`. A process that depends on state created at runtime must wait for that state itself instead of failing when it starts early.
- Send nginx logs to stdout and stderr instead of files inside the container.

## Nextcloud Data Directory

- The Nextcloud data directory is `/var/www/html/nextclouddata`, not the upstream default `/var/www/html/data`. Keep every path that refers to it consistent: the `Dockerfile`, the nginx rules that block it, the fail2ban `logpath`, the volume mounts in both manifests, and `overlay/config/autoconfig.php`, which presets the directory in the web installer. Installing with `occ` must pass `--data-dir`.

## Supported Dependency Versions

Choose the database, Redis, PHP, and operating system versions from the system requirements of the Nextcloud release the image carries: <https://docs.nextcloud.com/server/stable/admin_manual/installation/system_requirements.html>. The `stable` path always shows the newest release; replace it with the major version in the image, for example `32`, to see the requirements of that release.

The Compose stack runs MariaDB 11.8, the newest version that the admin setup check of Nextcloud 32 accepts. The Nextcloud 32 requirements page lists MariaDB only up to 11.4, while later releases recommend 11.8, and `stable` already recommends 12.3, which the Nextcloud 32 setup check warns about. Verify a fresh installation and an upgrade whenever the database or Nextcloud version changes.

## Deployment Manifests

`docker-compose.yml` and `deployment.yaml` are examples that other people copy and adapt, so neither may depend on the maintainer's environment: no site-specific addresses, host names, or storage. Keep both consistent with the image: container paths, mounted configuration, and runtime privileges the image needs must match in both files.

- `docker-compose.yml` is a self-contained stack of Nextcloud, MariaDB, and Redis that runs from the file alone with the published image, so it has no `build` section. State lives in named volumes, nothing is mounted from the repository, and the Redis server configuration and the Nextcloud Redis settings are generated inline with Compose `configs`, which needs Docker Compose 2.23.1 or later. Passwords default to placeholders and are overridden through environment variables or a `.env` file. MariaDB runs with the settings the Nextcloud database guide specifies (`READ-COMMITTED` isolation, `ROW` binary log format, and the `utf8mb4` character set with the `utf8mb4_bin` collation), and the MariaDB and Redis image tags are pinned.
- `deployment.yaml` deploys Nextcloud and Redis to Kubernetes and expects an external MariaDB. Site-specific values, such as the storage server address, the export paths, and the load balancer address, are placeholders marked in comments. The data directory `/var/www/html/nextclouddata` is a PersistentVolume that mounts an NFS export of a storage server, and the export must be writable by `www-data` (uid and gid 33).
- Keep `deployment.yaml` uniform. Name a workload after its component (`nextcloud`, `redis`) and every other object after its component, purpose, and kind (`nextcloud-data-pvc`, `redis-secret`, `redis-configmap`, `nextcloud-service`), so a name never reads like a path or a setting. Group the objects by component, indent block sequences under their key, quote the values a user edits and the resource quantities, and put a `CHANGE` comment on every value a user must adapt.
- Expose only the Nextcloud ports. MariaDB and Redis publish no ports in Compose, and Redis has a `ClusterIP` Service in Kubernetes, so they are reachable only from inside the Compose network or the cluster.
- Grant a container capability only when a process in the image requires it, and state the reason in a comment next to it in each manifest.
- Keep the real client address visible to the container, because fail2ban bans by the `remoteAddr` that Nextcloud logs: the Kubernetes Service uses `externalTrafficPolicy: Local`, and the trusted proxy ranges in `overlay/nginx/conf.d/real-ip.conf` must cover the load balancer.

## CI/CD

- Build each platform on a runner of that platform, not under emulation, and publish a release as one multi-arch manifest created from the per-platform digests.
- Build caches are written by builds of the main branch only. Release builds rebuild the runtime stage without cache so that they include the latest Debian updates.

## Documentation

- Keep `README.md` a project introduction. Do not put change logs or explanations of individual flags or options in it.
