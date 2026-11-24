# Testing

## Policy

| Surface | Requirement |
| --- | --- |
| Shell scripts under `overlay/` | Not required |
| Image build and runtime configuration: the `Dockerfile`, the `overlay/` configuration files, `docker-compose.yml`, and `deployment.yaml` | Not required |

## Change Obligations

- Changes to these surfaces carry no standing obligation to add or update dedicated automated tests, and agents must not introduce a test framework or test files for them unless the task explicitly requires it.
- This does not disable the configured formatting, linting, build, and CI checks, which still apply.
