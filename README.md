# nextcloud-custom

A self-hosted Nextcloud image adapted from the [official Nextcloud Docker project](https://github.com/nextcloud/docker). It uses an Nginx + PHP-FPM architecture and is deployed on an on-premises Kubernetes cluster.

## Technology Stack

| Item | Details |
| --- | --- |
| Base image | Debian 12, PHP 8.3 (FPM) |
| Web services | Nginx, PHP-FPM, managed by supervisord |
| Database and cache | MariaDB, Redis |
| Platforms | linux/amd64, linux/arm64 |

## Quick Start

Start Nextcloud, MariaDB, and Redis with Docker Compose:

```bash
docker compose up -d
```

Deploy to Kubernetes, after adapting the placeholders in the example:

```bash
kubectl apply -f deployment.yaml
```

## Upgrade

After upgrading the Nextcloud version, run the upgrade script inside the container:

```bash
nextcloud-upgrade
```

## Development

Build the image, run the image tests, and start a development stack with npm scripts. They need Node.js 24 or later and Docker with Compose 2.23.1 or later:

```bash
npm install
npm test
```

`npm test` builds the image, installs Nextcloud in a throwaway Docker Compose stack, runs the functional and security checks, and removes the stack. `npm run build` builds the image alone, `npm run dev -- up` starts a persistent stack for manual work, and `npm run clean` removes what these leave behind in Docker. See [docs/testing.md](./docs/testing.md) for the commands, options, and what the tests cover.

## License

Copyright (C) 2025  [hmes98318](https://github.com/hmes98318)  

Source: https://github.com/nextcloud/docker  

The custom Nextcloud image is licensed under the **GNU General Public License v3.0**, see the [LICENSE](./LICENSE) file for details.  
