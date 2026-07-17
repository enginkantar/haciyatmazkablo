#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const origin = 'https://www.haciyatmazkablo.com';
const errors = [];
const ignoredDirectories = new Set(['.git', '.wrangler', '.agents', '.claude', 'node_modules', 'assets', 'functions', 'scripts']);

async function collectHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await collectHtml(join(directory, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

function canonicalFromHtml(html) {
  return html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1];
}

function fileForPath(pathname) {
  if (pathname === '/') return join(root, 'index.html');
  if (pathname.endsWith('/')) return join(root, pathname.slice(1), 'index.html');
  return join(root, pathname.slice(1));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const key = (await readFile(join(root, 'indexnow-key.txt'), 'utf8')).trim();
if (!/^[a-f0-9]{32}$/i.test(key)) errors.push('indexnow-key.txt must contain a 32-character hexadecimal key.');

const robots = await readFile(join(root, 'robots.txt'), 'utf8');
for (const bot of ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'Bingbot']) {
  if (!robots.includes(`User-agent: ${bot}`)) errors.push(`robots.txt is missing ${bot}.`);
}
if (!robots.includes('Sitemap: https://www.haciyatmazkablo.com/sitemap.xml')) errors.push('robots.txt is missing the sitemap declaration.');

const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
if (!sitemapUrls.length) errors.push('sitemap.xml contains no URLs.');
if (sitemapUrls.some((url) => url.includes('#'))) errors.push('sitemap.xml must not contain fragment URLs.');
if (sitemapUrls.some((url) => url.endsWith('/google-feed.xml'))) errors.push('google-feed.xml must not be listed in sitemap.xml.');
if (new Set(sitemapUrls).size !== sitemapUrls.length) errors.push('sitemap.xml contains duplicate URLs.');

const pages = await collectHtml(root);
const canonicalOwners = new Map();
for (const file of pages) {
  const html = await readFile(file, 'utf8');
  const canonical = canonicalFromHtml(html);
  if (!canonical) continue;
  const url = new URL(canonical, origin);
  if (url.origin !== origin) errors.push(`${file}: canonical points outside the site.`);
  for (const match of html.matchAll(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(match[1].trim());
    } catch {
      errors.push(`${file}: invalid JSON-LD block.`);
    }
  }
  const owner = canonicalOwners.get(url.pathname);
  if (owner) errors.push(`Duplicate canonical ${url.pathname}: ${owner} and ${file}.`);
  canonicalOwners.set(url.pathname, file);

  for (const match of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    const target = new URL(href, url);
    if (target.origin !== origin) continue;
    const targetFile = fileForPath(decodeURIComponent(target.pathname));
    if (!(await exists(targetFile))) errors.push(`${file}: broken internal link ${href}`);
  }
}

for (const url of sitemapUrls) {
  const parsed = new URL(url);
  if (parsed.origin !== origin || parsed.hash || parsed.search) errors.push(`Invalid sitemap URL: ${url}`);
  const targetFile = fileForPath(parsed.pathname);
  if (!(await exists(targetFile))) errors.push(`Sitemap URL has no local page: ${url}`);
  if (canonicalOwners.get(parsed.pathname)) {
    const html = await readFile(canonicalOwners.get(parsed.pathname), 'utf8');
    const canonical = new URL(canonicalFromHtml(html), origin).toString();
    if (canonical !== url) errors.push(`Sitemap/canonical mismatch: ${url}`);
  }
}

const homepage = await readFile(join(root, 'index.html'), 'utf8');
for (const marker of ['<title>', 'name="description"', 'rel="canonical"', '"@type": "WebSite"', '"@type": "Product"']) {
  if (!homepage.includes(marker)) errors.push(`Homepage is missing ${marker}.`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`SEO checks passed: ${pages.length} HTML files, ${sitemapUrls.length} sitemap URLs.`);
