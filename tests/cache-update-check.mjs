import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_MODULE;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const root = new URL('../public/', import.meta.url);
const index = readFileSync(new URL('index.html', root), 'utf8');
const app = readFileSync(new URL('app.js', root), 'utf8');
const staleEngine = readFileSync(new URL('engine.js', root), 'utf8').replace('export function roundSummary', 'function roundSummary');
const appURL = index.match(/type="module" src="([^"]+)"/)[1];
const engineURL = app.match(/from '([^']+)'/)[1];
const cacheName = readFileSync(new URL('sw.js', root), 'utf8').match(/const CACHE = '([^']+)'/)[1];
const oldFiles = {
  '/index.html': '<main id="app"></main><script type="module" src="./app.js"></script>',
  '/app.js': "import { legacy } from './engine.js'; document.querySelector('#app').textContent = legacy; navigator.serviceWorker.register('./sw.js');",
  '/engine.js': "export const legacy = '旧版';",
  '/sw.js': `const CACHE = 'c3-practice-v4';
    self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./', './index.html', './app.js', './engine.js'])).then(() => self.skipWaiting())));
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request))));`
};
let upgraded = false;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? '/index.html' : path;
  try {
    const body = upgraded ? readFileSync(new URL(`.${file}`, root)) : oldFiles[file];
    if (!body) throw new Error('Not found');
    const mime = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') || file.endsWith('.webmanifest') ? 'application/json' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    // Keep the old worker active long enough to reproduce the broken import.
    if (upgraded && file === '/sw.js') setTimeout(() => res.end(body), 200);
    else res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const progress = { cursor: 12, records: { 1: { correct: false, attempts: 1 } }, favorites: [1], session: null };
  // Reproduce new app.js beside an old engine.js, including an unrelated stale cache.
  await page.evaluate(async ({ index, app, appURL, engineURL, engine, progress }) => {
    localStorage.setItem('c3-practice-v1', JSON.stringify(progress));
    const old = await caches.open('c3-practice-v4');
    await old.put('./', new Response(index, { headers: { 'Content-Type': 'text/html' } }));
    await old.put(appURL, new Response(app, { headers: { 'Content-Type': 'text/javascript' } }));
    const stale = await caches.open('unrelated-old-assets');
    await stale.put(engineURL, new Response(engine, { headers: { 'Content-Type': 'text/javascript' } }));
  }, { index, app, appURL, engineURL, engine: staleEngine, progress });
  upgraded = true;
  await page.reload();
  await page.getByRole('button', { name: '● 离线可用', exact: true }).waitFor();
  assert.ok(errors.some(error => error.includes('roundSummary')), '必须先复现旧缓存导致的导出缺失');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('c3-practice-v1'))), progress, '自动更新不得删除或修改答题进度');
  assert.ok(await page.evaluate(cacheName => caches.has(cacheName), cacheName));
  assert.equal(await page.evaluate(() => caches.has('c3-practice-v4')), false);
  await page.getByRole('button', { name: '更多练习', exact: false }).click();
  assert.equal(await page.locator('.practice-row').count(), 7);
  errors.length = 0;
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '更多练习', exact: false }).click();
  assert.equal(await page.locator('.practice-row').count(), 7);
  assert.deepEqual(errors, []);
  console.log('cache update: broken legacy import recovered automatically, current cache isolated, progress preserved, offline reload PASS');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
