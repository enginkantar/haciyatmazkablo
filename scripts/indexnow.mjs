#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const origin = (process.env.SITE_ORIGIN || 'https://www.haciyatmazkablo.com').replace(/\/$/, '');
const endpoint = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';
const sitemapPath = process.env.SITEMAP_PATH || join(root, 'sitemap.xml');
const keyPath = process.env.INDEXNOW_KEY_FILE || join(root, 'indexnow-key.txt');
const dryRun = process.argv.includes('--dry-run') || process.env.INDEXNOW_DRY_RUN === '1';

function readLocations(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

function normalizeUrls(locations) {
  return [...new Set(locations.flatMap((value) => {
    const url = new URL(value, origin);
    if (url.hash) return [];
    url.hash = '';
    return [url.toString()];
  }).filter((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === origin;
  }))];
}

const sitemap = await readFile(sitemapPath, 'utf8');
const key = (process.env.INDEXNOW_KEY || await readFile(keyPath, 'utf8')).trim();
const urlList = normalizeUrls([
  ...readLocations(sitemap),
  ...(process.env.INDEXNOW_URLS || '').split(',').map((value) => value.trim()).filter(Boolean),
]);

if (!key) {
  throw new Error('IndexNow key is empty. Set INDEXNOW_KEY or add indexnow-key.txt.');
}

if (!urlList.length) {
  throw new Error('No same-host URLs found in sitemap.xml.');
}

const payload = {
  host: new URL(origin).hostname,
  key,
  keyLocation: `${origin}/${key}.txt`,
  urlList,
};

if (dryRun) {
  console.log(JSON.stringify({
    endpoint,
    host: payload.host,
    keyLocation: payload.keyLocation,
    urlCount: urlList.length,
    urls: urlList,
  }, null, 2));
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});
const responseBody = await response.text();

if (!response.ok) {
  throw new Error(`IndexNow rejected the request (${response.status}): ${responseBody || 'empty response'}`);
}

console.log(`IndexNow accepted ${urlList.length} URLs (${response.status}).`);
