// Reads only the dedicated demo access already saved in App Store Connect.
// Never print the response or place credentials in an artifact or source file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

try {
  const now = Math.floor(Date.now() / 1000);
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = encoded({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }) + '.'
    + encoded({ iss: process.env.ASC_ISSUER_ID, iat: now - 20, exp: now + 600, aud: 'appstoreconnect-v1' });
  const key = Buffer.from(process.env.ASC_PRIVATE_KEY_P8_BASE64 || '', 'base64');
  const token = message + '.' + crypto.sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const response = await fetch('https://api.appstoreconnect.apple.com/v1/appStoreVersions/a03b3ba5-b32e-4dbd-b5ec-6c9739455d88/appStoreReviewDetail', {
    headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('Review access unavailable');
  const { data } = await response.json();
  const email = data?.attributes?.demoAccountName;
  const password = data?.attributes?.demoAccountPassword;
  // Refuse a personal/staff account even if review details change later.
  if (email !== 'apple-review-modernsecure@example.test' || !password) throw Error('Dedicated demo access required');
  console.log('::add-mask::' + password);
  const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build/screenshot-access.local.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ email, password }), { mode: 0o600 });
  console.log('Dedicated synthetic-case review access loaded; values omitted.');
} catch {
  console.error('Unable to load dedicated App Review access; private values omitted.');
  process.exitCode = 1;
}
