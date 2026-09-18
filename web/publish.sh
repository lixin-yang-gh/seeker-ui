#!/usr/bin/env bash
# Publish allowed static assets from this directory to the VPS web root.
# Allowed extensions: .html .css .ico .png .jpg .svg
# Destination files are overwritten in place (hard replacement).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_USER_HOST="sa@seeker-ui.app"
REMOTE_DIR="/var/www/seeker-ui.app/html"

cd "${SCRIPT_DIR}"

shopt -s nullglob
files=( *.html *.css *.ico *.png *.jpg *.svg )

if [[ ${#files[@]} -eq 0 ]]; then
  echo "publish.sh: no .html/.css/.ico/.png/.jpg/.svg files found in ${SCRIPT_DIR}" >&2
  exit 1
fi

echo "Publishing ${#files[@]} file(s) from ${SCRIPT_DIR}"
echo "Target: ${REMOTE_USER_HOST}:${REMOTE_DIR}"
printf '  %s\n' "${files[@]}"

scp -o BatchMode=yes "${files[@]}" "${REMOTE_USER_HOST}:${REMOTE_DIR}"

echo "Publish complete."
