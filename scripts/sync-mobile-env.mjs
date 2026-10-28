import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { publicMobileConfig } from './mobile-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { combinedEnv } = nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
const config = publicMobileConfig(combinedEnv);
const destination = path.join(root, 'apps/client_mobile/config/supabase.public.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(config, null, 2) + '\n');
console.log('Flutter public configuration synchronized with the website environment.');
console.log('Server secrets are excluded.');
