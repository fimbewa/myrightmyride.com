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

# Automatic updates: every few minutes, check GitHub for new code. When there is some, download it and restart
# the website (a few seconds). So a change merged on GitHub goes live by itself, with no hPanel steps.
# Set AUTO_UPDATE_MINUTES=0 to switch this off.
APP_DIR="$(pwd)"
RUN_DIR="$(mktemp -d)"
EVERY="${AUTO_UPDATE_MINUTES:-3}"
if [ -d "$APP_DIR/.git" ] && [ "$EVERY" != "0" ]; then
  (
    while sleep "${AUTO_UPDATE_SECONDS:-$(( EVERY * 60 ))}"; do
      git -C "$APP_DIR" fetch -q origin 2>/dev/null || continue
      OLD="$(git -C "$APP_DIR" rev-parse HEAD)"; NEW="$(git -C "$APP_DIR" rev-parse '@{u}' 2>/dev/null)" || continue
      [ "$OLD" = "$NEW" ] && continue
      echo "Update found on GitHub: ${NEW:0:7}. Installing..."
      git -C "$APP_DIR" merge -q --ff-only '@{u}' || { echo "Update could not be applied; keeping the current version."; continue; }
      if ! (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error); then
        echo "Update failed to install; going back to the previous version."
        git -C "$APP_DIR" reset -q --hard "$OLD"; (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
        continue
      fi
      # If this start-up script itself changed, restart the whole container so the new script is used.
      git -C "$APP_DIR" diff --quiet "$OLD" HEAD -- deploy/docker-run.sh || touch "$RUN_DIR/full-restart"
      echo "Update installed. Restarting the website."
      kill -TERM "$(cat "$RUN_DIR/node.pid")" 2>/dev/null
    done
  ) &
fi

# Run the website, and start it again if it stops (after an update, or a crash).
trap 'kill -TERM "$(cat "$RUN_DIR/node.pid" 2>/dev/null)" 2>/dev/null; exit 0' TERM INT
while true; do
  node server/index.js &
  echo $! > "$RUN_DIR/node.pid"
  wait $!
  [ -f "$RUN_DIR/full-restart" ] && { echo "Restarting the container to use the new start-up script."; exit 0; }
  sleep 3
done
