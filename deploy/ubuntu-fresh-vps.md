# Fresh VPS deployment: Ubuntu 24.04, 160.25.5.68

**Archived plan, not the active deployment.** This VPS lacked the CPU instructions required by MongoDB. Use `deploy/README.md` for the existing samiulenterprise.com server instead. The current application-update archive deliberately excludes the setup script and fresh MongoDB config referenced below; those files remain in the repository for a future compatible fresh host.

Target: root SSH access to `160.25.5.68`, Node.js 24, MongoDB 8.0, and HTTP API port **8787**. MongoDB stays on loopback port 27017. No old VPS, domain, SSH tunnel, or certificate is needed by the deployed app. This creates a new database with sample data; it does not migrate old VPS data or delete any database.

Follow these steps in order. PowerShell commands run on Windows, Bash commands on the VPS, and JavaScript inside `mongosh`. Stop if a command fails.

## 1. Package and upload (Windows PowerShell)

```powershell
cd E:\PROJECTS\MongoDb\SecureNotes
npm run package:release
scp .\deploy\secure-notes-api.tar.gz root@160.25.5.68:/root/
ssh root@160.25.5.68
```

The archive includes compiled JavaScript, manifests, the original database setup script, and deployment files. It excludes your `.env`, real passwords, private certificates, tests, and Windows `node_modules`.

## 2. Install Node.js and MongoDB (Bash, as root)

These commands are specifically for **Ubuntu 24.04 Noble**:

```bash
cat /etc/os-release
apt-get update
apt-get install -y ca-certificates curl gnupg openssl nano

curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
apt-get install -y nodejs

curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc -o /tmp/mongodb-server-8.0.asc
gpg --dearmor --output /usr/share/keyrings/mongodb-server-8.0.gpg /tmp/mongodb-server-8.0.asc
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list
apt-get update
apt-get install -y mongodb-org

node --version
npm --version
mongod --version
mongosh --version
```

Node should report v24 and `command -v node` should report `/usr/bin/node`, matching the service unit.

Sources: [MongoDB installation](https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-ubuntu/), [NodeSource installation](https://nodesource.com/blog/Update-Node.js-versions-on-linux).

## 3. Extract the app and configure fresh MongoDB (Bash)

```bash
id securenotes >/dev/null 2>&1 || useradd --system --user-group --home-dir /opt/secure-notes-api --shell /usr/sbin/nologin securenotes
install -d -m 755 /opt/secure-notes-api
tar -xzf /root/secure-notes-api.tar.gz -C /opt/secure-notes-api
cd /opt/secure-notes-api
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
```

Create the internal replica-set key once; preserve it on later deployments:

```bash
if [ ! -f /etc/mongodb-keyfile ]; then
  (umask 077; openssl rand -base64 756 > /etc/mongodb-keyfile)
fi
chown mongodb:mongodb /etc/mongodb-keyfile
chmod 400 /etc/mongodb-keyfile
```

For this **fresh server**, preserve the original configuration and install the supplied configuration:

```bash
cp -n /etc/mongod.conf /etc/mongod.conf.before-secure-notes
install -o root -g root -m 644 deploy/mongod.conf /etc/mongod.conf
systemctl enable mongod
systemctl restart mongod
systemctl status mongod --no-pager
```

This enables `rs0`, keyfile authentication, and access control, listening only on `127.0.0.1`. If startup fails, inspect `journalctl -u mongod -n 60 --no-pager` and `/var/log/mongodb/mongod.log` before continuing. Do not apply this config to an existing multi-node deployment.

## 4. Initialize rs0 BEFORE creating users (mongosh)

From Bash:

```bash
mongosh "mongodb://127.0.0.1:27017/admin?directConnection=true"
```

Inside `mongosh`, for the new uninitialized replica set:

```javascript
rs.initiate({
  _id: "rs0",
  members: [{ _id: 0, host: "localhost:27017" }]
})
```

Wait until a primary is elected:

```javascript
for (let attempt = 0; attempt < 60 && !db.hello().isWritablePrimary; attempt++) {
  sleep(1000)
}
db.hello().isWritablePrimary
```

Continue only when it prints **true**. Creating users earlier fails with `NotWritablePrimary`. If initialization reports `AlreadyInitialized` on a retry, check `db.hello()` instead of reconfiguring or deleting anything.

The localhost exception allows initialization and first-admin creation on a fresh instance. It closes after the first user/role is created. [MongoDB localhost exception](https://www.mongodb.com/docs/manual/core/localhost-exception/)

## 5. Create and authenticate database accounts (mongosh)

```javascript
use admin

db.createUser({
  user: "mongo_admin",
  pwd: passwordPrompt(),
  roles: [{ role: "root", db: "admin" }]
})

db.auth("mongo_admin", passwordPrompt())
```

Choose an administrator password, then enter the same password at authentication. Authentication must return `{ ok: 1 }`. If the account already exists, authenticate with its existing password instead of creating it again. `mongo_admin` authenticates against **admin**, not `test` or `secure_notes_db`.

Now create the application account:

```javascript
use secure_notes_db

db.createUser({
  user: "secure_notes_app",
  pwd: passwordPrompt(),
  roles: [{ role: "readWrite", db: "secure_notes_db" }]
})

exit
```

Choose and save a separate application database password; it goes in the backend URI. This account authenticates against **secure_notes_db**. Neither account is an API login account or a Linux SSH account.

## 6. Initialize collections, indexes, and samples (Bash)

```bash
cd /opt/secure-notes-api
mongosh "mongodb://127.0.0.1:27017/admin?directConnection=true" \
  --username mongo_admin --password --file secure_notes_setup.js
```

Enter the database administrator password. The packaged original script selects `secure_notes_db` and creates three collections, five custom indexes, four sample users, notes, and posts. It uses upserts, with no collection drops. Sample API password hashes initially remain null.

Verify the application database login separately:

```bash
mongosh "mongodb://127.0.0.1:27017/secure_notes_db?authSource=secure_notes_db&replicaSet=rs0&directConnection=true" \
  --username secure_notes_app --password
```

After login, run `db.notes.countDocuments()` and then `exit`. Fix any authentication failure before configuring Express. Editing `.env` does not change stored MongoDB passwords.

## 7. Configure HTTP on 8787 (Bash)

```bash
cd /opt/secure-notes-api
if [ ! -f .env ]; then cp deploy/.env.server.example .env; fi
node -e 'console.log(require("node:crypto").randomBytes(48).toString("hex"))'
nano .env
```

Set the actual application database password and generated random JWT secret:

```dotenv
NODE_ENV=production
PORT=8787
MONGODB_URI=mongodb://secure_notes_app:YOUR_ENCODED_DB_PASSWORD@127.0.0.1:27017/secure_notes_db?authSource=secure_notes_db&replicaSet=rs0&directConnection=true
JWT_SECRET=YOUR_GENERATED_RANDOM_SECRET
JWT_ISSUER=secure-notes-api
JWT_AUDIENCE=secure-notes-client
CORS_ORIGIN=http://localhost:5173
```

Percent-encode special characters in the database password (`@` becomes `%40`, `#` becomes `%23`). Do not use the database name as the username. You can generate a hex password with `openssl rand -hex 24` before creating the database account to avoid URI special characters.

Leave **both** `TLS_PFX_PATH` and `TLS_PFX_PASSWORD` unset. Remove them if using an old `.env`. No PEM, P12, domain, or SSH tunnel is needed by this HTTP deployment.

```bash
chown root:securenotes .env
chmod 640 .env
node dist/scripts/check-indexes.js
```

Set `CORS_ORIGIN` to the actual frontend origin when deployed. Postman does not enforce browser CORS. Application startup never creates or drops indexes.

## 8. Initialize the API admin password (Bash)

Prompt for an API password without putting it in shell history (12+ characters, at most 72 UTF-8 bytes):

```bash
cd /opt/secure-notes-api
bash
read -r -s -p "Choose API admin password: " seed_api_password
echo
SEED_ADMIN_EMAIL=admin@notes.test SEED_ADMIN_PASSWORD="$seed_api_password" node dist/scripts/seed-admin.js
unset seed_api_password
```

The explicit `bash` command ensures the prompt works even if your default shell is zsh. This initializes the sample API admin's bcrypt hash and refuses to overwrite an existing hash. Other sample passwords can be initialized using `node dist/scripts/seed-password.js` with `SEED_USER_EMAIL` and `SEED_USER_PASSWORD`, or register a new ordinary user through the API after startup.

## 9. Start the persistent API service (Bash)

```bash
ss -ltnp 'sport = :8787'
install -m 644 deploy/secure-notes-api.service /etc/systemd/system/secure-notes-api.service
systemctl daemon-reload
systemctl enable --now secure-notes-api
systemctl status secure-notes-api --no-pager
curl --fail http://127.0.0.1:8787/health
```

If `ss` shows another listener, identify it before starting. Expected health response:

```json
{"success":true,"data":{"status":"ok"}}
```

The service runs as `securenotes`, starts at boot, and stays running after SSH logout. It connects directly to local MongoDB.

## 10. Firewall and Postman

Permit your SSH port and TCP **8787** in the VPS provider firewall. Keep MongoDB **27017 private**. Inspect UFW first:

```bash
ufw status
```

If UFW is active, allow the API port (or restrict the rule to your public IP):

```bash
ufw allow 8787/tcp
```

Do not reset firewall rules or enable UFW without first permitting the actual SSH port. No public MongoDB rule is required.

Postman base URL: `http://160.25.5.68:8787/api/v1`.

Health: `GET http://160.25.5.68:8787/health`.

Login: `POST http://160.25.5.68:8787/api/v1/auth/login`, Body > raw > JSON:

```json
{
  "email": "admin@notes.test",
  "password": "THE_API_ADMIN_PASSWORD_FROM_STEP_8"
}
```

Use `data.accessToken` as a Bearer token. Database/SSH passwords cannot log in to API endpoints. HTTP is for initial connectivity testing; add HTTPS before sending sensitive production data over the internet.

## Troubleshooting and updates

```bash
journalctl -u secure-notes-api -n 80 --no-pager
journalctl -u mongod -n 60 --no-pager
systemctl reset-failed secure-notes-api
systemctl restart secure-notes-api
```

- MongoDB code 18: verify the account/password/authSource using step 6's application-account mongosh command.
- NotWritablePrimary: wait for `db.hello().isWritablePrimary` to be true before writes.
- Local health works, remote fails: inspect provider firewall and UFW for TCP 8787.
- HTTPS/certificate errors: use `http://` and remove both TLS variables from server `.env`.
- API login fails: initialize its password hash; database credentials do not authenticate to the API.

For future releases, package and upload again, stop only `secure-notes-api`, extract, run `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`, and restart. Keep `.env`, MongoDB config, keyfile, users, and data. Do not repeat replica-set initialization or replace credentials on ordinary deployments.

For local development against the new database only:

```powershell
ssh -N -L 27018:127.0.0.1:27017 root@160.25.5.68
```

Use the local `.env.example` connection shape with the new database password. The deployed backend does not need this tunnel.
