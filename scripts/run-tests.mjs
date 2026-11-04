import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] ?? 'local';
if (!['local', 'live'].includes(mode)) throw new Error('Use local or live');
const files = readdirSync(new URL('.', import.meta.url)).filter(name => /^test-.*\.mjs$/.test(name)).filter(name => {
  // This journey is isolated by default; its read-only production probe requires an explicit flag.
  const live = name !== 'test-onboarding-journey.mjs' && /\.env\.(local|db\.local)/.test(readFileSync(new URL(name, import.meta.url), 'utf8'));
  return mode === 'live' ? live : !live;
}).sort();
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', fileURLToPath(new URL(file, import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, TEST_BASE_URL: process.env.TEST_BASE_URL ?? 'http://localhost:3000' },
  });
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${file}`);
  if (result.status !== 0) { failures++; console.error(result.stdout + result.stderr); }
}
console.log(`${files.length - failures}/${files.length} ${mode} scripts passed`);
process.exitCode = failures ? 1 : 0;
