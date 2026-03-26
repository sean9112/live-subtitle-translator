import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);
const requiredFiles = [
  path.join(projectRoot, 'build/entitlements.mac.plist'),
  path.join(projectRoot, 'scripts/after-pack.cjs'),
];

for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing required packaging file: ${filePath}`);
    process.exit(1);
  }
}

const checks = [
  ['node', ['--check', path.join(projectRoot, 'src/main.js')]],
  ['node', ['-c', path.join(projectRoot, 'src/preload.cjs')]],
  ['node', ['--check', path.join(projectRoot, 'src/renderer.js')]],
  ['node', ['--check', path.join(projectRoot, 'src/control-ui.js')]],
  ['node', ['--check', path.join(projectRoot, 'src/overlay.js')]],
  ['node', ['--check', path.join(projectRoot, 'src/pcm-capture.js')]],
  ['node', ['--check', path.join(projectRoot, 'src/pcm-capture-worklet.js')]],
  ['node', ['--check', path.join(projectRoot, 'src/translation-service.js')]],
  ['node', ['--check', path.join(projectRoot, 'src/bridge-client.js')]],
  ['node', ['--check', path.join(projectRoot, 'src/logger.js')]],
  ['node', ['--check', path.join(projectRoot, 'scripts/after-pack.cjs')]],
  ['python3', ['-m', 'py_compile', path.join(projectRoot, 'scripts/generate-icons.py')]],
  ['node', [path.join(projectRoot, 'scripts/pcm-utils-test.mjs')]],
  ['node', [path.join(projectRoot, 'scripts/smoke.mjs')]],
];

for (const [command, args] of checks) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('All checks passed.');
