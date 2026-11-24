#!/bin/bash
# Start fail2ban once the Nextcloud log file exists.
#
# fail2ban refuses to start a jail whose logpath does not exist, and Nextcloud
# only creates nextcloud.log after it has been installed. Without this wait,
# fail2ban would hit FATAL on the first boot (supervisord does not retry).

set -euo pipefail

readonly JAIL_FILE='/etc/fail2ban/jail.d/nextcloud.local'
readonly POLL_INTERVAL=5
readonly LOG_INTERVAL=60

# Prints the logpath configured in the Nextcloud jail.
get_log_file() {
  sed -n 's/^[[:space:]]*logpath[[:space:]]*=[[:space:]]*//p' "${JAIL_FILE}" \
    | head -n 1
}

main() {
  local log_file
  local -i waited=0

  log_file="$(get_log_file)"

  if [[ -z "${log_file}" ]]; then
    echo "fail2ban-start: logpath not found in ${JAIL_FILE}" >&2
    return 1
  fi

  while [[ ! -f "${log_file}" ]]; do
    if ((waited % LOG_INTERVAL == 0)); then
      echo "fail2ban-start: waiting for ${log_file} (Nextcloud not installed yet?)"
    fi
    waited=$((waited + POLL_INTERVAL))
    sleep "${POLL_INTERVAL}"
  done

  exec /usr/bin/fail2ban-server -f
}

main "$@"
