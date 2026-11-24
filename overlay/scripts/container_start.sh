#!/bin/bash
# Container entry point: prepare the TLS certificate, then run supervisord.
#
# nginx needs a certificate at startup. A certificate mounted at SSL_DIR is
# used as is; otherwise a self-signed one is generated on every start, so no
# private key is shared through the image.
#
# Environment:
#   SSL_CERT_CN  Common name and DNS name of the generated certificate
#                (default: localhost).

set -euo pipefail

readonly SSL_DIR='/etc/nginx/ssl'
readonly CERT_FILE="${SSL_DIR}/nginx.crt"
readonly KEY_FILE="${SSL_DIR}/nginx.key"
readonly CERT_VALID_DAYS=3650
readonly SUPERVISORD_CONF='/etc/supervisor/conf.d/supervisord.conf'

# Generates a self-signed ECDSA certificate for SSL_CERT_CN and localhost.
generate_certificate() {
  local cn="${SSL_CERT_CN:-localhost}"
  local san="DNS:${cn}"

  if [[ "${cn}" != 'localhost' ]]; then
    san+=',DNS:localhost'
  fi

  echo "container-start: generating a self-signed TLS certificate for ${cn}"

  openssl req -x509 -nodes \
    -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -days "${CERT_VALID_DAYS}" \
    -keyout "${KEY_FILE}" -out "${CERT_FILE}" \
    -subj "/CN=${cn}" \
    -addext "subjectAltName=${san}"

  chmod 0600 "${KEY_FILE}"
  chmod 0644 "${CERT_FILE}"
}

main() {
  if [[ ! -s "${CERT_FILE}" || ! -s "${KEY_FILE}" ]]; then
    generate_certificate
  fi

  exec /usr/bin/supervisord -c "${SUPERVISORD_CONF}"
}

main "$@"
