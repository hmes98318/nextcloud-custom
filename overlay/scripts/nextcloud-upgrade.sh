#!/bin/bash
# Run Nextcloud database/application migrations and post-upgrade maintenance.

set -euo pipefail

readonly NEXTCLOUD_DIR='/var/www/html'
readonly NEXTCLOUD_USER='www-data'
readonly PHP_BIN='/usr/local/bin/php'
readonly CRON_RUNS=3

readonly OCC="${NEXTCLOUD_DIR}/occ"
readonly CRON="${NEXTCLOUD_DIR}/cron.php"

log() {
  echo
  echo '================================================================'
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo '================================================================'
}

err() {
  echo "ERROR: $*" >&2
}

log_cmd() {
  printf '[CMD] '
  printf '%q ' "$@"
  printf '\n'
}

# Runs a command and logs its command line and exit status.
run_cmd() {
  log_cmd "$@"

  local exit_code

  if "$@"; then
    exit_code=0
  else
    exit_code=$?
  fi

  echo "[EXIT] ${exit_code}"
  return "${exit_code}"
}

# Runs a Nextcloud OCC command as the www-data user.
run_occ() {
  run_cmd \
    sudo -E -u "${NEXTCLOUD_USER}" \
    "${PHP_BIN}" \
    "${OCC}" \
    "$@"
}

# Runs Nextcloud cron.php as the www-data user.
run_cron() {
  run_cmd \
    sudo -E -u "${NEXTCLOUD_USER}" \
    "${PHP_BIN}" \
    -d apc.enable_cli=1 \
    -f "${CRON}"
}

# Preconditions
check_preconditions() {
  if (( EUID != 0 )); then
    err 'This script must be executed as root.'
    return 1
  fi

  if [[ ! -f "${OCC}" ]]; then
    err "Nextcloud occ not found: ${OCC}"
    return 1
  fi

  if [[ ! -f "${CRON}" ]]; then
    err "Nextcloud cron.php not found: ${CRON}"
    return 1
  fi

  if [[ ! -x "${PHP_BIN}" ]]; then
    err "PHP not found or not executable: ${PHP_BIN}"
    return 1
  fi

  if ! id "${NEXTCLOUD_USER}" >/dev/null 2>&1; then
    err "User not found: ${NEXTCLOUD_USER}"
    return 1
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    err 'sudo command not found.'
    return 1
  fi
}

main() {
  local -i i

  check_preconditions

  log 'PHP version'
  run_cmd "${PHP_BIN}" --version

  log 'Nextcloud status before upgrade'
  run_occ status

  log 'Running Nextcloud upgrade'
  run_occ upgrade

  log 'Adding missing database columns'
  run_occ db:add-missing-columns

  log 'Adding missing database indices'
  run_occ db:add-missing-indices

  log 'Adding missing database primary keys'
  run_occ db:add-missing-primary-keys

  log "Running Nextcloud cron.php ${CRON_RUNS} times"

  for (( i = 1; i <= CRON_RUNS; i++ )); do
    echo
    echo ">>> cron.php run ${i}/${CRON_RUNS}"
    run_cron
  done

  log 'Nextcloud status after upgrade'
  run_occ status
  run_occ status -e

  log 'Nextcloud application status'
  run_occ app:list

  log 'Upgrade completed successfully'

  cat <<'NEXT_STEPS'

Next steps:
  1. Open Nextcloud Administration settings -> Overview
  2. Check for remaining database/background-job warnings
  3. Check Nextcloud logs
  4. Verify installed applications
NEXT_STEPS
}

main "$@"
