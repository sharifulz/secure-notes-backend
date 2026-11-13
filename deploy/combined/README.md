# Frontend + backend on 160.25.5.68, database on samiulenterprise.com

```text
Browser -> Nginx on 160.25.5.68:80
             |-- static frontend
             `-- /api/v1 and /health -> Express on 127.0.0.1:8787
                                           |
                                    SSH tunnel on 127.0.0.1:27018
                                           |
                             existing MongoDB on samiulenterprise.com:27017
```

Node/Express runs on the new VPS; MongoDB does not. Keep the old MongoDB database, users, indexes, replica set, and data unchanged. No `mongod` installation or `rs.initiate()` is needed on the new VPS, so its missing AVX support is not used by a local MongoDB process. Node itself must run successfully; check `node --version` before proceeding.

The instructions below use root SSH access already established by the user. All Linux commands run on **160.25.5.68**, except where explicitly stated otherwise. The tunnel uses a dedicated SSH key, not a password saved in a service file. The key grants access to the old server: keep it root-owned and private. Nothing here stops or changes the old JAR application.

## 1. Package and upload from Windows

```powershell
cd E:\PROJECTS\MongoDb\SecureNotes
npm run package:combined
scp .\deploy\secure-notes-combined.tar.gz root@160.25.5.68:/root/
ssh root@160.25.5.68
```

Packaging reads the sibling `SecureNoteFrontEnd` folder and includes its four public files. Only the packaged copy of `app.js` is changed to use the same origin's `/api/v1`; your local frontend files are preserved. Override the source folder if needed: `npm run package:combined -- E:\path\to\frontend`.

The archive excludes actual `.env` files, SSH keys, real certificates, `node_modules`, and database initialization files. It contains compiled backend JavaScript, frontend static files, and deployment configurations.

## 2. Prerequisites and extraction (new VPS)

```bash
apt-get update
apt-get install -y nginx openssh-client ca-certificates curl
node --version
npm --version
```

Use system-wide Node.js 24 or another compatible version at least 22.12.0. If missing:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
apt-get install -y nodejs
```

Confirm `command -v node` reports `/usr/bin/node`, matching the supplied service. If Node itself reports `Illegal instruction`, stop and inspect CPU compatibility before deployment; do not assume a MongoDB-only hardware limitation guarantees every Node binary will work.

```bash
id securenotes >/dev/null 2>&1 || useradd --system --user-group --home-dir /opt/secure-notes-api --shell /usr/sbin/nologin securenotes
install -d -m 755 /opt/secure-notes-api
tar -xzf /root/secure-notes-combined.tar.gz -C /opt/secure-notes-api
cd /opt/secure-notes-api
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
```

## 3. Set up unattended SSH authentication (new VPS)

Create a dedicated key only if one does not already exist:

```bash
install -d -m 700 /root/.ssh
if [ ! -f /root/.ssh/secure-notes-db ]; then
  ssh-keygen -t ed25519 -f /root/.ssh/secure-notes-db -N '' -C secure-notes-db-160-25-5-68
fi
chmod 600 /root/.ssh/secure-notes-db
ssh-copy-id -i /root/.ssh/secure-notes-db.pub root@samiulenterprise.com
```

At `ssh-copy-id`, verify the old server's host key and enter its Linux root SSH password. This is a one-time key installation. Do not disable host-key checking. Test that the key works without asking for a password:

```bash
ssh -i /root/.ssh/secure-notes-db -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes root@samiulenterprise.com true
```

The test should finish without a password prompt or an error. Do not continue if it reports `Permission denied`, `Host key verification failed`, or a networking error. Do not copy the private key to your frontend folder or an archive.

For a tighter key policy, an administrator on the old VPS can restrict this specific key's `authorized_keys` entry to source `160.25.5.68`, deny shell commands, and permit forwarding only to the database destination. Verify any restriction with the tunnel itself; do not edit unrelated keys or global SSH configuration during this deployment.

## 4. Start the persistent tunnel (new VPS)

```bash
cd /opt/secure-notes-api
install -m 644 deploy/combined/secure-notes-db-tunnel.service /etc/systemd/system/secure-notes-db-tunnel.service
systemctl daemon-reload
systemctl enable --now secure-notes-db-tunnel
systemctl status secure-notes-db-tunnel --no-pager
ss -ltnp 'sport = :27018'
```

The listener should be on `127.0.0.1:27018`. systemd maintains the SSH process and restarts it after disconnects. `BatchMode` prevents hidden password prompts; keepalives detect a broken connection. The old MongoDB port remains private. [OpenSSH options](https://man.openbsd.org/ssh_config)

If another process already owns 27018, identify it rather than killing it blindly. Tunnel logs:

```bash
journalctl -u secure-notes-db-tunnel -n 50 --no-pager
```

Opening the local forwarding port does not guarantee remote MongoDB is healthy. The backend authentication and index check below verifies the actual database connection.

## 5. Configure the backend (new VPS)

```bash
cd /opt/secure-notes-api
if [ -f .env ]; then cp -p .env .env.before-combined; else cp deploy/combined/.env.example .env; fi
node -e 'console.log(require("node:crypto").randomBytes(48).toString("hex"))'
nano .env
```

Use the **existing working MongoDB application password from the old server**:

```dotenv
NODE_ENV=production
PORT=8787
API_HOST=127.0.0.1
TRUST_PROXY=loopback
MONGODB_URI=mongodb://secure_notes_app:ACTUAL_ENCODED_DB_PASSWORD@127.0.0.1:27018/secure_notes_db?authSource=secure_notes_db&replicaSet=rs0&directConnection=true
JWT_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
JWT_ISSUER=secure-notes-api
JWT_AUDIENCE=secure-notes-client
CORS_ORIGIN=http://160.25.5.68
```

Percent-encode special characters in the database password. Retain the old backend JWT secret if you intentionally want tokens from the old backend to remain valid; otherwise use the generated random secret. Preserve a valid existing secret on normal updates.

Remove **both** `TLS_PFX_PATH` and `TLS_PFX_PASSWORD`: Express uses HTTP behind Nginx in this setup. No old P12 is required by the new Express process. HTTPS can be added at Nginx later.

```bash
chown root:securenotes .env
chmod 640 .env
node dist/scripts/check-indexes.js
```

The index check reads the existing remote database and does not create, delete, or reseed anything. Code 18 means the application username/password/authSource is wrong; connection refusal/timeout means check the tunnel and the old MongoDB service. Do not reset a working account or initialize a new database to resolve a tunnel problem.

## 6. Start Express with its tunnel dependency (new VPS)

```bash
cd /opt/secure-notes-api
install -m 644 deploy/secure-notes-api.service /etc/systemd/system/secure-notes-api.service
install -d -m 755 /etc/systemd/system/secure-notes-api.service.d
install -m 644 deploy/combined/database-tunnel.conf /etc/systemd/system/secure-notes-api.service.d/database-tunnel.conf
systemctl daemon-reload
systemctl enable --now secure-notes-api
systemctl status secure-notes-api --no-pager
curl --fail http://127.0.0.1:8787/health
```

If an existing custom unit is present, inspect it before replacing it. The provided unit starts the Node process as `securenotes`; the SSH process uses its separate root-owned key. Boot ordering starts the tunnel first, and the API retries if the forwarding connection is not ready yet. Authentication failures remain visible in logs; retries do not fix invalid credentials.

`API_HOST=127.0.0.1` keeps Express off the public network. `TRUST_PROXY=loopback` trusts client-IP headers only from the local Nginx proxy, so rate limiting distinguishes visitors. Nginx overwrites forwarded client-IP headers rather than trusting values supplied by the browser.

## 7. Install the frontend and Nginx route (new VPS)

The existing website already uses `/etc/nginx/conf.d/secure-notes.conf`. Back it up and replace this specific file; do not create a second duplicate server block for the same IP.

```bash
cd /opt/secure-notes-api
install -d -m 755 /var/www/secure-notes
install -m 644 frontend/index.html frontend/styles.css frontend/app.js frontend/utils.js /var/www/secure-notes/
if [ -f /etc/nginx/conf.d/secure-notes.conf ]; then
  cp -p /etc/nginx/conf.d/secure-notes.conf /etc/nginx/conf.d/secure-notes.conf.before-combined
fi
install -m 644 deploy/combined/nginx.conf /etc/nginx/conf.d/secure-notes.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx
curl --fail http://127.0.0.1/health -H 'Host: 160.25.5.68'
```

Run the enable/reload steps only after `nginx -t` succeeds. If other files define the same IP/server name, inspect them first. Do not delete unrelated Nginx configurations. Nginx retains the `/api/v1` path when forwarding to Express. [Nginx reverse proxy behavior](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)

## 8. Open the website

Open **http://160.25.5.68**. Frontend and API now share an origin:

- Frontend: `http://160.25.5.68/`
- API: `http://160.25.5.68/api/v1`
- Health: `http://160.25.5.68/health`

If you previously saved the old backend URL in the frontend, expand **API connection**, set `http://160.25.5.68/api/v1`, and click **Save connection**. Then hard-refresh the page and sign in using your existing API account. The packaged default is automatically the same-origin API for new visitors. The old saved browser setting is not changed without user action.

Only web ports 80 (and later 443) need public ingress on this VPS. Express 8787 and the database tunnel 27018 remain loopback-only. Keep SSH access permitted. Ensure new-VPS outbound SSH to the old server on port 22 is allowed, and the old server accepts that connection. No public MongoDB firewall rule is required.

Existing notes, API accounts, and posts stay in the old database and remain available. The previous Express instance can keep running during verification; stop only that old API service if desired after verifying the new deployment. Leave its MongoDB and JAR services running.

## Logs and restarts

```bash
journalctl -u secure-notes-db-tunnel -n 50 --no-pager
journalctl -u secure-notes-api -n 50 --no-pager
systemctl restart secure-notes-db-tunnel
systemctl restart secure-notes-api
```

A tunnel failure can interrupt database operations; systemd retries the tunnel. An API process that failed initial connection retries until the connection is restored. HTTP is for initial verification; use HTTPS at Nginx before production logins with sensitive data. This does not require the expired certificate from the old VPS.
