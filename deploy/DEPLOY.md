# Deploying Glow Tape

One $6/month DigitalOcean droplet runs everything: PocketBase (data, auth,
files, reminders) serving the built web app, behind Caddy for automatic HTTPS.
The server configures itself from `cloud-init.yaml` — you never have to
hand-install anything.

## 1. Create the droplet (once, ~10 minutes)

1. Sign up at digitalocean.com.
2. **Create → Droplets**:
   - Region: **San Francisco (SFO3)**
   - Image: **Ubuntu 24.04 LTS**
   - Size: **Basic → Regular → $6/mo** (1 GB RAM / 25 GB disk — plenty)
   - Backups: **enable weekly backups** (+~$1.20/mo; this is the whole-server
     safety net on top of our nightly data backups)
   - Authentication: SSH key if you have one, otherwise password
   - **Advanced Options → check "Add Initialization scripts (free)"** and paste
     the entire contents of [`cloud-init.yaml`](cloud-init.yaml) into the box
3. Create. The droplet boots and installs everything itself (5–10 minutes).
   Progress log, if you're curious: `/var/log/glowtape-setup.log` on the server.

> If the GitHub repo is private, first edit the clone URL in the pasted
> cloud-init as noted in that file's comment.

## 2. Point the domain (Squarespace)

In Squarespace → Domains → glowtape.net → DNS settings:

| Type | Host | Value |
|---|---|---|
| A | @ | the droplet's IP address |
| A | www | the droplet's IP address |

DNS usually propagates in minutes. Caddy fetches the HTTPS certificate
automatically the first time the domain resolves to the server.

## 3. First-run configuration (in the browser)

1. Open `https://glowtape.net/_/` — create the **superuser** account
   (this is the admin dashboard login; keep it to yourself).
2. **Settings → Application**: set Application URL to `https://glowtape.net`
   (calendar-feed links use this).
3. **Settings → Mail settings**: enter SMTP credentials so sign-in codes and
   mirrored emails send. Free options: Brevo (300 emails/day free) or Amazon
   SES. Until this is set, codes only appear in the server logs.
4. Create an `orgs` record for the first theater and a `productions` record
   for the first show. Join code + default channels appear automatically.
5. Walk the verification checklist in [`../backend/README.md`](../backend/README.md).

## 4. SMS (later, when Twilio is approved)

Add credentials to `/etc/glowtape/env` on the server:

```sh
GLOWTAPE_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM=+18335550123
```

Then `systemctl restart glowtape`. Reminders and text sign-in switch on.

## 5. Updating the app

SSH in (or use the Console button in the DigitalOcean dashboard) and run:

```sh
glowtape-update
```

Pulls the latest `main`, rebuilds, restarts. A few seconds of downtime.

## 6. Backups & restore

- **Nightly** (automatic): `glowtape-backup` archives `pb_data/` to
  `/var/backups/glowtape/`, keeping 14 days. To also copy offsite, install
  rclone (`apt install rclone`), run `rclone config`, name the remote
  `offsite` (Backblaze B2's 10 GB free tier is ideal) — the nightly job picks
  it up automatically.
- **Weekly** (DigitalOcean): whole-droplet image, restorable from their dashboard.
- **Restore**: stop the service, unpack the archive, start:
  ```sh
  systemctl stop glowtape
  rm -rf /opt/glowtape/backend/pb_data
  tar xzf /var/backups/glowtape/pb_data-YYYY-MM-DD.tgz -C /opt/glowtape/backend
  chown -R glowtape:glowtape /opt/glowtape/backend
  systemctl start glowtape
  ```

## Costs

| Item | Monthly |
|---|---|
| Droplet | $6.00 |
| Droplet backups | ~$1.20 |
| Offsite backup (B2 free tier) | $0 |
| SMTP free tier | $0 |
| **Total** | **~$7.20** + domain (~$1/mo) |
