'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readEnvFile() {
  const out = {};
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = Object.assign(readEnvFile(), process.env);

module.exports = {
  ROOT,
  PORT: Number(env.PORT || 3000),
  HOST: env.HOST || '0.0.0.0',
  SESSION_SECRET: env.SESSION_SECRET || 'opera-ai-reply-secret-change-me',
  GRAPH_API_VERSION: env.GRAPH_API_VERSION || 'v21.0',
  VERIFY_TOKEN: env.VERIFY_TOKEN || 'opera-ai-verify-token',
  META_APP_SECRET: env.META_APP_SECRET || '',
  WA_PHONE_NUMBER_ID: env.WA_PHONE_NUMBER_ID || '',
  WA_ACCESS_TOKEN: env.WA_ACCESS_TOKEN || '',
  MESSENGER_PAGE_TOKEN: env.MESSENGER_PAGE_TOKEN || '',
  GEMINI_API_KEY: env.GEMINI_API_KEY || '',
  GEMINI_MODEL: env.GEMINI_MODEL || 'gemini-2.5-flash',
  DB_PATH: path.join(ROOT, 'data', 'app.db'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
};
