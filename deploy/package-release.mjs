import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run package:release');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [npmCli, 'run', 'build']);
// Explicit allowlist: never include .env, node_modules, or private certificates.
run('tar', [
  '-czf', 'deploy/secure-notes-api.tar.gz',
  'dist', 'package.json', 'package-lock.json', 'README.md',
  'deploy/README.md', 'deploy/.env.server.example',
  'deploy/secure-notes-api.service', 'deploy/package-release.mjs',
]);
console.log('Release ready: deploy/secure-notes-api.tar.gz');
