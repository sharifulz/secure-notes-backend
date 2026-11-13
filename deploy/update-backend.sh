#!/usr/bin/env bash
# Backend-only update for the existing combined deployment. Invoked by npm run deploy.
set -Eeuo pipefail
umask 077

if [[ $# -ne 3 || $EUID -ne 0 ]]; then
  echo 'Run as root with: update-backend.sh ARCHIVE RELEASE SHA256' >&2
  exit 1
fi

archive=$1
release=$2
expected_hash=$3
app=/opt/secure-notes-api
service=secure-notes-api

if [[ ! $release =~ ^[0-9]+-[a-f0-9]{8}$ || ! $expected_hash =~ ^[a-f0-9]{64}$ || $archive != "/tmp/secure-notes-backend-${release}.tar.gz" ]]; then
  echo 'Invalid deployment arguments; no application files changed.' >&2
  exit 1
fi
if [[ ! -d $app || ! -f $app/.env ]]; then
  echo 'Existing /opt/secure-notes-api and its .env are required. Complete initial setup first.' >&2
  exit 1
fi
for command in flock tar sha256sum npm curl systemctl; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
systemctl cat "$service" >/dev/null

# Prevent simultaneous updates from swapping each other's application files.
exec 9>/run/lock/secure-notes-api-deploy.lock
flock -n 9 || { echo 'Another backend deployment is already running.' >&2; exit 1; }
printf '%s  %s\n' "$expected_hash" "$archive" | sha256sum --check --status

deploy_root=$app/.deploy
stage=$deploy_root/$release
backup=$deploy_root/$release.previous
install -d -m 700 "$deploy_root"
mkdir "$stage"
tar -tzf "$archive" > "$stage/contents.txt"
while IFS= read -r path; do
  case "$path" in
    dist|dist/|dist/*|package.json|package-lock.json) ;;
    *) echo "Unexpected archive entry: $path" >&2; exit 1 ;;
  esac
  case "/$path/" in
    */../*|*/./*) echo 'Unsafe archive path.' >&2; exit 1 ;;
  esac
done < "$stage/contents.txt"
tar -xzf "$archive" -C "$stage" --no-same-owner
[[ -f $stage/dist/server.js && -f $stage/package.json && -f $stage/package-lock.json ]]

# Prepare dependencies before stopping the currently running application.
echo 'Installing runtime dependencies; existing API is still running.'
(umask 022; cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
# The private staging directory is root-only; installed runtime children must be
# readable by the existing non-root systemd user after moving into the app root.
chmod -R a+rX -- "$stage/dist" "$stage/node_modules"
chmod a+r -- "$stage/package.json" "$stage/package-lock.json"
mkdir "$backup"
was_active=0
if systemctl is-active --quiet "$service"; then was_active=1; fi
old_moved=()
new_moved=()

rollback() {
  local status=$?
  trap - ERR
  set +e
  echo 'Deployment failed. Restoring previous backend files.' >&2
  systemctl stop "$service"
  for item in "${new_moved[@]}"; do
    mv -- "$app/$item" "$stage/failed-$item"
  done
  for item in "${old_moved[@]}"; do
    mv -- "$backup/$item" "$app/$item"
  done
  if [[ $was_active -eq 1 ]]; then
    systemctl reset-failed "$service"
    systemctl start "$service"
  fi
  journalctl -u "$service" -n 25 --no-pager >&2
  echo "Inspect logs and retained deployment files in $stage before retrying." >&2
  exit "$status"
}
trap rollback ERR

echo 'Switching backend runtime files and restarting the API.'
systemctl stop "$service"
for item in dist node_modules package.json package-lock.json; do
  if [[ -e $app/$item ]]; then
    mv -- "$app/$item" "$backup/$item"
    old_moved+=("$item")
  fi
  mv -- "$stage/$item" "$app/$item"
  new_moved+=("$item")
done
systemctl reset-failed "$service"
systemctl start "$service"

healthy=0
for attempt in {1..30}; do
  if systemctl is-active --quiet "$service" && \
    curl --fail --silent --max-time 2 http://127.0.0.1:8787/health | grep -q '"status":"ok"'; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ $healthy -ne 1 ]]; then
  echo 'New backend did not pass its health check.' >&2
  false
fi
trap - ERR
echo "Backend deployed successfully. Previous runtime retained at $backup"
echo 'Server .env, frontend, Nginx, SSH tunnel, and database were not changed.'
