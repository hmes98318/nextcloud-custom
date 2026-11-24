#!/bin/bash
# Run busybox crond in the foreground so supervisord can manage it.

set -euo pipefail

main() {
  exec busybox crond -f -L /dev/stdout
}

main "$@"
