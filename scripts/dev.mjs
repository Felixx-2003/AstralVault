import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const wranglerCli = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const localVars = path.join(root, '.dev.vars');

if (!existsSync(localVars)) {
  console.error('Missing .dev.vars. Copy .dev.vars.example to .dev.vars and set a long random SESSION_SECRET.');
  process.exit(1);
}

function runOnce(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited with code ${code ?? 'unknown'}.`)));
  });
}

let watcher;
let worker;
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [worker, watcher]) if (child && child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 300);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

try {
  await runOnce(viteCli, ['build']);
  watcher = spawn(process.execPath, [viteCli, 'build', '--watch'], { cwd: root, stdio: 'inherit' });
  watcher.once('error', (error) => { console.error(error); stop(1); });
  watcher.once('exit', (code) => { if (!stopping && code !== 0) stop(code ?? 1); });
  await new Promise((resolve) => setTimeout(resolve, 700));
  worker = spawn(process.execPath, [wranglerCli, 'dev', '--ip', '127.0.0.1', '--port', '8787'], { cwd: root, stdio: 'inherit' });
  worker.once('error', (error) => { console.error(error); stop(1); });
  worker.once('exit', (code) => { if (!stopping) stop(code ?? 1); });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
}
