#!/usr/bin/env bash
# myrightmyride.com one-command installer and updater for an Ubuntu server (tested target: Hostinger VPS, Ubuntu 24.04,
# with or without CloudPanel). Run it as root. Running it again later updates the website and keeps all data and settings.
#
#   curl -fsSL https://raw.githubusercontent.com/fimbewa/myrightmyride.com/main/deploy/install.sh | bash
#
# For a private repository, add a read-only GitHub token:  ... | GITHUB_TOKEN=github_pat_xxx bash
set -euo pipefail

DOMAIN="${DOMAIN:-myrightmyride.com}"
REPO="${REPO:-https://github.com/fimbewa/myrightmyride.com.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/myrightmyride}"
APP_USER="myride"
PORT="${PORT:-3100}"
BACKUP_DIR="/var/backups/myrightmyride"
PW_FILE="/root/myrightmyride-admin-password.txt"

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mXX  %s\033[0m\n' "$*"; exit 1; }
rand() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-20}"; }

[ "$(id -u)" = 0 ] || die "Please run this as root (Hostinger's browser terminal logs you in as root)."
export DEBIAN_FRONTEND=noninteractive

say "1/7 Installing the basics (git, sqlite, build tools)"
apt-get update -qq
apt-get install -y -qq curl git sqlite3 ca-certificates build-essential dnsutils >/dev/null

say "2/7 Installing Node.js 22"
if ! /usr/bin/node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
/usr/bin/node -v

say "3/7 Downloading the website code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
GIT_AUTH=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  GIT_AUTH=(-c "http.https://github.com/.extraheader=Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)")
fi
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" "${GIT_AUTH[@]}" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"   # .env and data/ are not in git, so they are kept
else
  mkdir -p "$APP_DIR"
  git "${GIT_AUTH[@]}" clone -q --branch "$BRANCH" "$REPO" "$APP_DIR.tmp" || die "Could not download the code. If the GitHub repository is private, add GITHUB_TOKEN (see the guide)."
  cp -a "$APP_DIR.tmp/." "$APP_DIR/" && rm -rf "$APP_DIR.tmp"
fi
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

say "4/7 Settings"
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/.env" ]; then
  ADMIN_PW="$(rand 20)"
  cat > "$APP_DIR/.env" <<ENV
PORT=$PORT
ADMIN_PASSWORD=$ADMIN_PW
# TEST MODE: no SMS is sent and the OTP is shown on the login screen.
# When your SMS company is ready, set SMS_PROVIDER=http, fill in SMS_HTTP_URL, set SHOW_OTP_ON_SCREEN=false,
# then run:  systemctl restart myrightmyride
SMS_PROVIDER=console
SHOW_OTP_ON_SCREEN=true
DB_FILE=$APP_DIR/data/myrightmyride.db
ENV
  printf 'Owner panel: https://%s/admin\nPassword: %s\n' "$DOMAIN" "$ADMIN_PW" > "$PW_FILE"
  chmod 600 "$PW_FILE"
fi
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2 || echo "$PORT")"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

say "5/7 Starting the website (restarts by itself after a crash or reboot)"
cat > /etc/systemd/system/myrightmyride.service <<UNIT
[Unit]
Description=myrightmyride.com website
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q myrightmyride
systemctl restart myrightmyride
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$PORT/api/config" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/api/config" >/dev/null || { journalctl -u myrightmyride -n 30 --no-pager; die "The website did not start. The lines above show why."; }
echo "Website is running on port $PORT."

say "6/7 Connecting $DOMAIN with HTTPS"
SERVER_IP="$(curl -4 -fs https://api.ipify.org || hostname -I | awk '{print $1}')"
DNS_IP="$(dig +short A "$DOMAIN" @1.1.1.1 | tail -n1)"
DNS_OK=no; [ "$DNS_IP" = "$SERVER_IP" ] && DNS_OK=yes
WWW_OK=no; [ "$(dig +short A "www.$DOMAIN" @1.1.1.1 | tail -n1)" = "$SERVER_IP" ] && WWW_OK=yes
HTTPS=no
if command -v clpctl >/dev/null 2>&1; then
  echo "CloudPanel found: adding $DOMAIN as a Node.js site in CloudPanel."
  if [ ! -e "/etc/nginx/sites-enabled/$DOMAIN.conf" ]; then
    SITE_PW="$(rand 24)"
    ok=no
    for v in 22 20 18; do
      if clpctl site:add:nodejs --domainName="$DOMAIN" --nodejsVersion="$v" --appPort="$PORT" --siteUser=myrightmyride --siteUserPassword="$SITE_PW" >/dev/null 2>&1; then ok=yes; break; fi
    done
    [ "$ok" = yes ] || warn "CloudPanel could not add the site. Open CloudPanel > + Add Site > Create a Node.js Site, domain $DOMAIN, app port $PORT."
  fi
  if [ "$DNS_OK" = yes ]; then
    if [ "$WWW_OK" = yes ] && clpctl lets-encrypt:install:certificate --domainName="$DOMAIN" --subjectAlternativeName="www.$DOMAIN" >/dev/null 2>&1; then HTTPS=yes
    elif clpctl lets-encrypt:install:certificate --domainName="$DOMAIN" >/dev/null 2>&1; then HTTPS=yes; fi
  fi
else
  echo "No CloudPanel: using Caddy, which gets and renews the HTTPS certificate by itself."
  if ss -ltnp 2>/dev/null | grep -E ':(80|443)\s' | grep -vq caddy; then
    ss -ltnp | grep -E ':(80|443)\s' || true
    die "Another program (shown above) is already using the web ports 80/443. Stop it, or install CloudPanel, then run this again."
  fi
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gpg >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN, www.$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:$PORT
}
CADDY
  systemctl reload caddy || systemctl restart caddy
  [ "$DNS_OK" = yes ] && HTTPS=yes
fi

say "7/7 Daily backup of all data"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"   # backups hold phone numbers: root only
cat > /usr/local/bin/myrightmyride-backup <<BK
#!/bin/sh
# Copies the whole database once a day and keeps the last 30 days.
sqlite3 "$APP_DIR/data/myrightmyride.db" ".backup '$BACKUP_DIR/myrightmyride-\$(date +%F).db'" && find "$BACKUP_DIR" -name 'myrightmyride-*.db' -mtime +30 -delete
BK
chmod 755 /usr/local/bin/myrightmyride-backup
echo "30 21 * * * root /usr/local/bin/myrightmyride-backup" > /etc/cron.d/myrightmyride-backup   # 21:30 UTC = 3:00 AM India time
/usr/local/bin/myrightmyride-backup || true

echo
echo "================================================================"
echo " myrightmyride.com is installed."
if [ "$HTTPS" = yes ]; then
  echo " Website:      https://$DOMAIN"
  echo " Owner panel:  https://$DOMAIN/admin"
else
  warn "HTTPS is not on yet: $DOMAIN points to ${DNS_IP:-nothing}, not to this server ($SERVER_IP)."
  echo " This is normal for up to a few hours after changing DNS at Hostinger."
  echo " Wait, then run the SAME install command again. It will switch on HTTPS."
fi
echo
[ -f "$PW_FILE" ] && { echo " Your owner panel password (also saved in $PW_FILE):"; grep '^Password' "$PW_FILE"; }
echo
echo " TEST MODE is on: login OTPs are shown on screen, no SMS is sent."
echo " Backups: $BACKUP_DIR (daily, last 30 days kept)"
echo " To update the website later, run the same install command again."
echo "================================================================"
