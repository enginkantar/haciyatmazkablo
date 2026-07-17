#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const origin = 'https://www.haciyatmazkablo.com';
const outputPath = join(root, 'sitemap.xml');
const checkOnly = process.argv.includes('--check');
const excludedPaths = new Set([
  '/odeme-basarili.html',
  '/odeme-hatasi.html',
  '/tasarim-a.html',
  '/tasarim-b.html',
  '/test-hero.html',
  '/secim.html',
  '/mesafeli-satis-sozlesmesi.html',
  '/on-bilgilendirme-formu.html',
  '/gizlilik-politikasi.html',
]);
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

function isNoindex(html) {
  return /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
}

function lastModified(file) {
  const filePath = relative(root, file).split('\\').join('/');
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', filePath], { cwd: root, encoding: 'utf8' }).trim()
      || new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function metadataFor(pathname) {
  const isHomepage = pathname === '/';
  const isHub = /^\/(blog|cihazlar|kablo|kullanim|rehber)\/$/.test(pathname);
  const isComparison = pathname === '/en-iyi-type-c-kablo/';
  return {
    changefreq: isHomepage || isHub ? 'weekly' : 'monthly',
    priority: isHomepage ? '1.0' : (isHub || isComparison ? '0.9' : '0.8'),
  };
}

const pages = [];
for (const file of await collectHtml(root)) {
  const html = await readFile(file, 'utf8');
  const canonical = canonicalFromHtml(html);
  if (!canonical || isNoindex(html)) continue;

  const url = new URL(canonical, origin);
  if (url.origin !== origin || url.hash || url.search || excludedPaths.has(url.pathname)) continue;

  pages.push({
    file,
    pathname: url.pathname,
    lastmod: lastModified(file),
  });
}

const uniquePages = [...new Map(pages.map((page) => [page.pathname, page])).values()]
  .sort((a, b) => a.pathname === '/' ? -1 : b.pathname === '/' ? 1 : a.pathname.localeCompare(b.pathname));

const body = uniquePages.map(({ pathname, lastmod }) => {
  const metadata = metadataFor(pathname);
  return [
    '  <url>',
    `    <loc>${escapeXml(`${origin}${pathname}`)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${metadata.changefreq}</changefreq>`,
    `    <priority>${metadata.priority}</priority>`,
    '  </url>',
  ].join('\n');
}).join('\n');

const output = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

if (checkOnly) {
  const current = await readFile(outputPath, 'utf8');
  if (current !== output) {
    console.error('sitemap.xml is stale. Run: npm run seo:sitemap');
    process.exit(1);
  }
  console.log(`sitemap.xml is current (${uniquePages.length} URLs).`);
} else {
  await writeFile(outputPath, output);
  console.log(`sitemap.xml generated (${uniquePages.length} URLs).`);
}
