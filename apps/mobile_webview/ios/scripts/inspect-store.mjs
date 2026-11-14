// Read-only release identity/build checks. Never output tokens or review credentials.
import crypto from 'node:crypto';
import fs from 'node:fs';
const appId = '6824547106';
const expectedBundle = 'kz.modernsecure.modernSecure';
try {
  const now = Math.floor(Date.now() / 1000);
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = encoded({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }) + '.'
    + encoded({ iss: process.env.ASC_ISSUER_ID, iat: now - 20, exp: now + 600, aud: 'appstoreconnect-v1' });
  const key = Buffer.from(process.env.ASC_PRIVATE_KEY_P8_BASE64 || '', 'base64');
  const token = message + '.' + crypto.sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  async function get(resource) {
    const response = await fetch(`https://api.appstoreconnect.apple.com/v1/${resource}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error(`Apple read request failed: HTTP ${response.status}`);
    return response.json();
  }
  const app = (await get(`apps/${appId}?fields[apps]=name,bundleId`)).data;
  if (app.attributes.bundleId !== expectedBundle) throw Error('App identity mismatch');
  const versions = (await get(`apps/${appId}/appStoreVersions?limit=50`)).data;
  const builds = (await get(`builds?filter[app]=${appId}&sort=-uploadedDate&limit=20`)).data;
  const requested = process.env.IOS_BUILD_NUMBER;
  if (requested && builds.some(build => build.attributes.version === requested)) throw Error('Build number already exists; choose a new number');
  const snapshot = { checkedAt: new Date().toISOString(), appId, bundleId: app.attributes.bundleId,
    versions: versions.map(v => ({ version: v.attributes.versionString, state: v.attributes.appStoreState })),
    recentBuilds: builds.map(b => ({ build: b.attributes.version, state: b.attributes.processingState, uploadedDate: b.attributes.uploadedDate })),
  };
  fs.mkdirSync('apps/mobile_webview/ios/build', { recursive: true });
  fs.writeFileSync('apps/mobile_webview/ios/build/store-status.json', JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify(snapshot, null, 2));
} catch (error) {
  console.error(error.message?.startsWith('Apple read') || error.message?.includes('number already') || error.message === 'App identity mismatch' ? error.message : 'Could not verify Apple release identity; private values omitted.');
  process.exitCode = 1;
}
