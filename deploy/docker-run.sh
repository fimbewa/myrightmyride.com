#!/usr/bin/env bash
# Started by docker-compose.yml inside the "app" container: sets the owner password, starts a daily backup, runs the website.
DATA_DIR="$(dirname "${DB_FILE:-/data/myrightmyride.db}")"
PW_FILE="$DATA_DIR/admin-password.txt"
mkdir -p "$DATA_DIR/backups"
# ADMIN_PASSWORD (if set, from docker-compose / the project's Environment section) always wins over the stored one.
ADMIN_PASSWORD="$(printf '%s' "${ADMIN_PASSWORD:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
echo "=================================================="
if [ -n "$ADMIN_PASSWORD" ]; then
  export ADMIN_PASSWORD
  echo " Owner password: the one you set in ADMIN_PASSWORD (${#ADMIN_PASSWORD} characters)."
  [ "${#ADMIN_PASSWORD}" -lt 8 ] && echo " WARNING: it must be at least 8 characters, or owner login will not work."
else
  [ -s "$PW_FILE" ] || head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20 > "$PW_FILE"
  chmod 600 "$PW_FILE"
  ADMIN_PASSWORD="$(cat "$PW_FILE")"; export ADMIN_PASSWORD
  echo " OWNER PANEL PASSWORD (created for you):  $ADMIN_PASSWORD"
  echo " To use your own instead, set ADMIN_PASSWORD and redeploy."
fi
echo " Owner pages:  https://${DOMAIN:-myrightmyride.com}/admin  and  https://${SITE2_DOMAIN:-qindiaglobal.com}/admin"
echo "=================================================="

# Daily backup of the database, keeping 30 days, in the same data volume.
(
  sleep 120
  while true; do
    node -e "require('better-sqlite3')(process.env.DB_FILE || '/data/myrightmyride.db', { fileMustExist: true })
      .backup('$DATA_DIR/backups/myrightmyride-' + new Date().toISOString().slice(0, 10) + '.db').then(() => console.log('Backup saved.'))" \
      || echo "Backup failed."
    find "$DATA_DIR/backups" -name 'myrightmyride-*.db' -mtime +30 -delete
    sleep 86400
  done
) &

exec node server/index.js
