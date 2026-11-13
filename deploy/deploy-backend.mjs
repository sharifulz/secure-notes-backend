import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Current deployment: Express on this VPS; MongoDB remains behind its existing tunnel.
const target = 'root@160.25.5.68';
const root = fileURLToPath(new URL('../', import.meta.url));
const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!['--prepare-only', '--skip-tests'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
}
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run npm run deploy or deploy-backend.cmd');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'}). Deployment stopped.`);
}

try {
  if (!flags.has('--skip-tests')) run(process.execPath, [npmCli, 'test']);
  run(process.execPath, [npmCli, 'run', 'build']);

  const release = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const output = join(root, '.cache', 'backend-deploy');
  mkdirSync(output, { recursive: true });
  const archiveName = `secure-notes-backend-${release}.tar.gz`;
  const helperName = `secure-notes-update-${release}.sh`;
  const archive = join(output, archiveName);
  const helper = join(output, helperName);

  // Only runtime files: never upload .env, database scripts, frontend, or services.
  run('tar', ['-czf', archive, 'dist', 'package.json', 'package-lock.json']);
  // Windows Git may check out .sh files with CRLF; normalize the upload copy.
  writeFileSync(helper, readFileSync(join(root, 'deploy', 'update-backend.sh'), 'utf8').replace(/\r\n/g, '\n'));
  const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
  console.log(`Prepared backend release: ${archive}`);

  if (flags.has('--prepare-only')) {
    console.log('Prepare-only: tests/build/archive complete. No server contacted.');
  } else {
    console.log(`Uploading backend to ${target} (SSH may ask for your VPS password).`);
    // Relative local paths avoid Windows drive letters being parsed as SCP hosts.
    const localPath = path => relative(root, path).replaceAll('\\', '/');
    run('scp', ['-o', 'ConnectTimeout=15', localPath(archive), localPath(helper), `${target}:/tmp/`]);
    run('ssh', ['-o', 'ConnectTimeout=15', target,
      `bash /tmp/${helperName} /tmp/${archiveName} ${release} ${checksum}`]);
    console.log('Backend deployment succeeded. Website: http://160.25.5.68');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
