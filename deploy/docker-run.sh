#!/usr/bin/env bash
# Started by docker-compose.yml inside the "app" container: sets the owner password, starts a daily backup, runs the website.
DATA_DIR="$(dirname "${DB_FILE:-/data/myrightmyride.db}")"
PW_FILE="$DATA_DIR/admin-password.txt"
mkdir -p "$DATA_DIR/backups"
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  [ -s "$PW_FILE" ] || head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20 > "$PW_FILE"
  chmod 600 "$PW_FILE"
  ADMIN_PASSWORD="$(cat "$PW_FILE")"; export ADMIN_PASSWORD
fi
echo "=================================================="
echo " OWNER PANEL PASSWORD:  $ADMIN_PASSWORD"
echo " Owner panel:  https://${DOMAIN:-myrightmyride.com}/admin"
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
