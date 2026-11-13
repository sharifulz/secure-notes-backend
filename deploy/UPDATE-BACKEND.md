# Backend updates from your desktop

Initial server setup must already be working: API service `secure-notes-api` in `/opt/secure-notes-api` on **160.25.5.68**, existing server `.env`, Nginx, and the MongoDB SSH tunnel. MongoDB remains on `samiulenterprise.com`.

After changing backend code, open PowerShell:

```powershell
cd E:\PROJECTS\MongoDb\SecureNotes
npm run deploy
```

Equivalent Windows command file:

```powershell
.\deploy-backend.cmd
```

The command:

1. Runs backend tests and the TypeScript build locally.
2. Packages only `dist`, `package.json`, and `package-lock.json`.
3. Uploads the archive and update helper using SCP to `root@160.25.5.68`.
4. Verifies the upload checksum and prepares runtime dependencies before stopping the API.
5. Backs up and replaces only backend runtime files, then starts `secure-notes-api`.
6. Checks `http://127.0.0.1:8787/health` on the VPS.
7. Restores the previous runtime files if activation or health verification fails. If the previous service was running, it attempts to start that version again. Database/network failures can also prevent the restored version from starting; inspect logs in that case.

Your SSH password may be requested during upload and execution unless your desktop already has a working SSH key for `root@160.25.5.68`. GitHub's `github-samiul` alias is unrelated to VPS authentication. No passwords are stored in these scripts.

There is a short API interruption during the file swap and startup. Other applications and the frontend keep running. `.env`, API secrets, Nginx config, systemd units, SSH keys/tunnel, and MongoDB are preserved. Runtime rollback does not reverse any database changes made by application code.

Deployment uses your **current local files**; it does not commit, pull, or push GitHub. Commit and push separately when you want to save your work in Git.

## Optional flags

Prepare and validate the update locally without contacting any server:

```powershell
npm run deploy -- --prepare-only
```

Skip the test run, but still build and verify startup:

```powershell
npm run deploy -- --skip-tests
```

The same flags work with `deploy-backend.cmd`.

## Troubleshooting

The script stops on a failed command and returns a nonzero exit code. Do not assume deployment succeeded unless its final success message appears.

```powershell
ssh root@160.25.5.68
```

On the server:

```bash
journalctl -u secure-notes-api -n 60 --no-pager
journalctl -u secure-notes-db-tunnel -n 40 --no-pager
```

Previous runtime files are retained under `/opt/secure-notes-api/.deploy/RELEASE.previous`; local generated uploads are under `.cache/backend-deploy`. These are not committed to Git. Retained backups consume disk space; keep the versions you need for recovery.

This command updates only an already-configured backend. For frontend changes or a fresh server, use the separate combined deployment workflow in `deploy/combined/README.md`.
