# Existing VPS: samiulenterprise.com, port 8787

The deployment target is again `root@samiulenterprise.com`. Keep the existing MongoDB database, replica set, users, and the JAR on port 8282. Do not follow the fresh-server initialization instructions on this server. Do not overwrite `/etc/mongod.conf`, rerun `rs.initiate()`, or reset database passwords as part of an application update.

The release archive excludes `.env`, private certificates, `node_modules`, the database setup script, and fresh-server MongoDB configuration. Optional HTTPS remains supported in the application. The two previously observed issues on this server were MongoDB code 18 (authentication failure) and an expired served certificate; moving back does not itself fix them.

## 1. Check the existing database (Linux)

```bash
ssh root@samiulenterprise.com
systemctl status mongod --no-pager
```

Verify the application database account using its actual password:

```bash
mongosh "mongodb://127.0.0.1:27017/secure_notes_db?authSource=secure_notes_db&replicaSet=rs0&directConnection=true" \
  --username secure_notes_app --password
```

Inside mongosh, confirm:

```javascript
db.hello().isWritablePrimary
db.notes.countDocuments()
exit
```

If authentication fails, authenticate as the existing `mongo_admin` against **admin**, using its database password:

```bash
mongosh "mongodb://127.0.0.1:27017/admin?directConnection=true" \
  --username mongo_admin --password
```

Then inspect the application account without changing it:

```javascript
use secure_notes_db
db.getUser("secure_notes_app")
```

If you need to intentionally reset a forgotten application password, run `db.changeUserPassword("secure_notes_app", passwordPrompt())` in this authenticated shell and update the backend URI to match. Do not recreate a working account. Database, API login, SSH, and P12 passwords are different credentials.

## 2. Build and upload the update (Windows PowerShell)

```powershell
cd E:\PROJECTS\MongoDb\SecureNotes
npm run package:release
scp .\deploy\secure-notes-api.tar.gz root@samiulenterprise.com:/root/
```

## 3. Update only this app (Linux, as root)

```bash
systemctl stop secure-notes-api
cd /opt/secure-notes-api
cp -p .env .env.before-update
tar -xzf /root/secure-notes-api.tar.gz -C /opt/secure-notes-api
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
nano .env
```

Preserve the existing JWT secret and frontend origin. Confirm:

```dotenv
PORT=8787
MONGODB_URI=mongodb://secure_notes_app:ACTUAL_ENCODED_DB_PASSWORD@127.0.0.1:27017/secure_notes_db?authSource=secure_notes_db&replicaSet=rs0&directConnection=true
```

Use the password just verified in mongosh. Percent-encode special characters in the URI. The backend connects locally on the VPS, not through the Windows tunnel.

For an initial HTTP connectivity check, remove or comment out **both** `TLS_PFX_PATH` and `TLS_PFX_PASSWORD`. These can be restored after repairing the certificate below. Do not send real login credentials over public HTTP.

```bash
chown root:securenotes .env .env.before-update
chmod 640 .env .env.before-update
node dist/scripts/check-indexes.js
systemctl reset-failed secure-notes-api
systemctl start secure-notes-api
journalctl -u secure-notes-api --since "2 minutes ago" --no-pager
curl --fail http://127.0.0.1:8787/health
```

An existing systemd unit is assumed at `/etc/systemd/system/secure-notes-api.service`, with working directory `/opt/secure-notes-api` and user `securenotes`. Do not replace a customized unit blindly. The packaged unit remains available for a first install if needed. The service keeps running after SSH logout.

If it fails, check the newest log lines. Code 18 is a database authentication failure. If something else still listens on port 8787 after stopping this service, identify it with `ss -ltnp 'sport = :8787'` before proceeding. Do not stop unrelated processes.

## 4. Restore HTTPS with the correct certificate directory

Source: `/etc/letsencrypt/live/samiulenterprise.com/`, without `-0001`.

```bash
date -u
openssl x509 -in /etc/letsencrypt/live/samiulenterprise.com/cert.pem -noout -dates -subject
certbot certificates
```

If the PEM certificate is expired, use its actual name from `certbot certificates` with `certbot renew --cert-name CERTIFICATE_NAME`. If renewal fails, inspect its error before changing other web-server configuration. A current PEM does not guarantee that an old custom P12 has been regenerated.

After confirming the PEM is current, generate the backend's separate P12 copy:

```bash
systemctl stop secure-notes-api
install -d -o root -g securenotes -m 750 /etc/secure-notes-api
openssl pkcs12 -export \
  -out /etc/secure-notes-api/springboot.p12 \
  -inkey /etc/letsencrypt/live/samiulenterprise.com/privkey.pem \
  -in /etc/letsencrypt/live/samiulenterprise.com/cert.pem \
  -certfile /etc/letsencrypt/live/samiulenterprise.com/chain.pem \
  -name springboot
chown root:securenotes /etc/secure-notes-api/springboot.p12
chmod 640 /etc/secure-notes-api/springboot.p12
nano /opt/secure-notes-api/.env
```

Use the P12 export password you chose:

```dotenv
TLS_PFX_PATH=/etc/secure-notes-api/springboot.p12
TLS_PFX_PASSWORD=YOUR_P12_EXPORT_PASSWORD
```

Start and verify without bypassing certificate checks:

```bash
systemctl reset-failed secure-notes-api
systemctl start secure-notes-api
curl --fail --resolve samiulenterprise.com:8787:127.0.0.1 https://samiulenterprise.com:8787/health
```

The source JAR P12 is not overwritten. When PEM certificates are renewed, regenerate this copy and restart the API to load it. Port 8787 serves HTTPS only when both TLS settings are configured.

## 5. Postman and local development

With HTTPS enabled, use `https://samiulenterprise.com:8787/api/v1`. With TLS variables omitted for initial testing, use `http://samiulenterprise.com:8787/api/v1`. The firewall must permit TCP 8787. MongoDB port 27017 remains private.

If an API login account still has a null password hash, initialize it with the seed commands in the root README; do not rerun the database setup script.

For local development against the existing database, open the tunnel on Windows:

```powershell
ssh -N -L 27018:127.0.0.1:27017 root@samiulenterprise.com
```

Use the local `.env.example` URI shape with the current application database password. Your running deployed backend does not need an SSH tunnel.
