#!/usr/bin/env bash
# Glow Tape server setup — Ubuntu 24.04, run as root, repo at /opt/glowtape.
# Idempotent: safe to re-run after a failure or to apply deploy/ changes.
set -euo pipefail

REPO_DIR=/opt/glowtape
cd "$REPO_DIR"

echo "== swap (node builds are tight on a 1GB droplet) =="
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== base packages =="
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl git unzip ufw ca-certificates gnupg \
  debian-keyring debian-archive-keyring apt-transport-https

echo "== node 22 =="
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== caddy =="
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "== service user =="
id -u glowtape >/dev/null 2>&1 || useradd -r -m -d /var/lib/glowtape -s /usr/sbin/nologin glowtape

echo "== build frontend =="
npm ci --no-audit --no-fund
npm run build

echo "== pocketbase =="
[ -x backend/pocketbase ] || bash scripts/get-pocketbase.sh

echo "== publish frontend through pocketbase =="
rm -rf backend/pb_public
mkdir -p backend/pb_public
cp -r dist/* backend/pb_public/
chown -R glowtape:glowtape backend

echo "== env file for optional SMS credentials =="
mkdir -p /etc/glowtape
touch /etc/glowtape/env
chmod 640 /etc/glowtape/env
chown root:glowtape /etc/glowtape/env

echo "== systemd units =="
cp deploy/glowtape.service /etc/systemd/system/
cp deploy/glowtape-backup.service /etc/systemd/system/
cp deploy/glowtape-backup.timer /etc/systemd/system/
install -m 0755 deploy/glowtape-update /usr/local/bin/glowtape-update
install -m 0755 deploy/glowtape-backup /usr/local/bin/glowtape-backup
mkdir -p /var/backups/glowtape
systemctl daemon-reload
systemctl enable --now glowtape
systemctl enable --now glowtape-backup.timer

echo "== caddy config =="
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "== firewall =="
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== done =="
echo "Next: point glowtape.net's A record at this server, then open"
echo "https://glowtape.net/_/ to create the superuser account."
