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

## License

Copyright (C) 2025  [hmes98318](https://github.com/hmes98318)  

Source: https://github.com/nextcloud/docker  

The custom Nextcloud image is licensed under the **GNU General Public License v3.0**, see the [LICENSE](./LICENSE) file for details.  
