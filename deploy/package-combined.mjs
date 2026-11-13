import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontendSource = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../../SecureNoteFrontEnd/', import.meta.url));
const staging = join(root, '.cache', 'combined-frontend');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run npm run package:combined');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(join(staging, 'frontend'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'utils.js']) {
  copyFileSync(join(frontendSource, file), join(staging, 'frontend', file));
}
// Transform only the deployment copy. Preserve the user's local frontend files.
const appPath = join(staging, 'frontend', 'app.js');
const frontendApp = readFileSync(appPath, 'utf8');
if (!/^const DEFAULT_API = .+;$/m.test(frontendApp)) throw new Error('Cannot find the frontend API default; inspect app.js before packaging.');
writeFileSync(appPath, frontendApp.replace(/^const DEFAULT_API = .+;$/m, "const DEFAULT_API = new URL('/api/v1', location.origin).href;"));
run(process.execPath, [npmCli, 'run', 'build']);
// Explicit public/deployment allowlist; no .env credentials or SSH keys.
run('tar', [
  '-czf', join(root, 'deploy', 'secure-notes-combined.tar.gz'),
  'dist', 'package.json', 'package-lock.json', 'README.md',
  'deploy/combined/README.md', 'deploy/combined/.env.example',
  'deploy/combined/nginx.conf', 'deploy/combined/secure-notes-db-tunnel.service',
  'deploy/combined/database-tunnel.conf', 'deploy/secure-notes-api.service',
  '-C', staging, 'frontend',
]);
console.log('Combined release ready: deploy/secure-notes-combined.tar.gz');
