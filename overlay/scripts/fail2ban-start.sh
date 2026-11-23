#!/bin/sh
# Start fail2ban once the Nextcloud log file exists.
#
# fail2ban refuses to start a jail whose logpath does not exist, and Nextcloud
# only creates nextcloud.log after it has been installed. Without this wait,
# fail2ban would hit FATAL on the first boot (supervisord does not retry).

set -eu

readonly JAIL_FILE='/etc/fail2ban/jail.d/nextcloud.local'
LOG_FILE="$(sed -n 's/^[[:space:]]*logpath[[:space:]]*=[[:space:]]*//p' "${JAIL_FILE}" | head -n 1)"
readonly LOG_FILE

if [ -z "${LOG_FILE}" ]; then
  echo "fail2ban-start: logpath not found in ${JAIL_FILE}" >&2
  exit 1
fi

waited=0
while [ ! -f "${LOG_FILE}" ]; do
  if [ $((waited % 60)) -eq 0 ]; then
    echo "fail2ban-start: waiting for ${LOG_FILE} (Nextcloud not installed yet?)"
  fi
  waited=$((waited + 5))
  sleep 5
done

exec /usr/bin/fail2ban-server -f
