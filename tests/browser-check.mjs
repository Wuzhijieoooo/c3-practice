import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_MODULE;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browserType = process.env.BROWSER_ENGINE || 'chromium';
const browser = await playwright[browserType].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.TEST_URL || 'http://localhost:4173/';
const { questions } = JSON.parse(readFileSync(new URL('../public/questions.json', import.meta.url)));
const snapshots = new URL(`../tmp/browser/${browserType}/`, import.meta.url);
mkdirSync(snapshots, { recursive: true });
const shot = name => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, snapshots)), fullPage: true });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
const oneScreen = async () => {
  await page.waitForFunction(() => parseFloat(document.documentElement.style.getPropertyValue('--viewport-height')) === window.innerHeight);
  const metrics = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, viewport: window.innerHeight }));
  assert.ok(metrics.scrollHeight <= metrics.viewport + 1, `页面不应滚动: ${metrics.scrollHeight} > ${metrics.viewport}`);
};
const visibleAction = async () => {
  const rect = await page.locator('.quiz-actions .primary').boundingBox();
  assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= page.viewportSize().height, '答题按钮必须留在屏幕内');
};
const setState = async state => { await page.evaluate(state => localStorage.setItem('c3-practice-v1', JSON.stringify(state)), state); await page.reload(); await page.waitForSelector('.start-card'); };

try {
  await page.goto(base);
  await page.getByRole('button', { name: '● 离线可用', exact: true }).waitFor();
  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await oneScreen(); await noOverflow();
    const wrong = await page.locator('.mode-card[data-mode="wrong"]').boundingBox();
    assert.ok(wrong.y + wrong.height <= viewport.height, '首页错题入口必须无需滚动即可看到');
    await shot(`home-${viewport.width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(); await shot('home');
  await page.getByRole('button', { name: '开始 10 题练习' }).click();
  await page.locator('[data-key="A"]').click();
  assert.match(await page.locator('.feedback').innerText(), /再记一次/);
  assert.match(await page.locator('.feedback').innerText(), /题库答案：D/);
  assert.equal(await page.locator('.feedback').evaluate(element => getComputedStyle(element).animationName), 'feedback-in');
  assert.equal(await page.locator('.feedback strong').evaluate(element => getComputedStyle(element).animationName), 'answer-shake');
  await oneScreen(); await visibleAction();
  await shot('incorrect');
  await page.reload();
  await page.getByRole('button', { name: '继续上次练习' }).click();
  assert.equal(await page.locator('.option:disabled').count(), 4);
  await page.getByRole('button', { name: '下一题' }).click();
  assert.equal(await page.locator('.question').evaluate(element => getComputedStyle(element).animationName), 'question-in');
  for (let index = 1; index < 10; index++) {
    await page.locator(`[data-key="${questions[index].answer[0]}"]`).click();
    await page.getByRole('button', { name: index === 9 ? '查看本组结果' : '下一题' }).click();
  }
  assert.match(await page.locator('.score').innerText(), /9.*10/s);
  await shot('result');
  await page.getByRole('button', { name: '今天先到这里' }).click();
  await page.locator('[data-mode="wrong"]').click();
  await page.locator('[data-key="D"]').click();
  await page.getByRole('button', { name: '查看本组结果' }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('c3-practice-v1')).records[1].correct), true);
  assert.equal(await page.locator('.celebration i').count(), 12);
  await page.waitForFunction(() => !document.querySelector('.celebration'));

  await setState({ cursor: 800, records: {}, session: null });
  await page.getByRole('button', { name: '开始 10 题练习' }).click();
  await page.locator('[data-key="A"]').click();
  await page.reload();
  await page.getByRole('button', { name: '继续上次练习' }).click();
  assert.equal(await page.locator('[data-key="A"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.feedback').count(), 0);
  for (const key of ['C','D','E']) await page.locator(`[data-key="${key}"]`).click();
  await page.getByRole('button', { name: '提交答案' }).click();
  assert.match(await page.locator('.feedback').innerText(), /答对了/);
  await noOverflow(); await shot('multiple');

  await setState({ cursor: 1035, records: {}, session: null });
  await page.getByRole('button', { name: '开始 10 题练习' }).click();
  await page.locator('[data-key="B"]').click();
  await page.getByRole('button', { name: '提交答案' }).click();
  assert.match(await page.locator('.feedback').innerText(), /PDF 仅高亮一个答案/);

  await setState({ cursor: 1200, records: {}, session: null });
  await page.getByRole('button', { name: '开始 10 题练习' }).click();
  assert.equal(await page.locator('.option').count(), 2);
  await page.locator('[data-key="A"]').click();
  assert.match(await page.locator('.feedback').innerText(), /答对了/);
  await page.locator('[data-action="home"]').click();
  await page.getByRole('button', { name: '安装与离线使用说明' }).click();
  assert.equal(await page.locator('dialog').isVisible(), true);
  await page.getByRole('button', { name: '知道了' }).click();

  const safari14Page = await context.newPage();
  await safari14Page.addInitScript(() => {
    if (window.HTMLDialogElement) {
      delete HTMLDialogElement.prototype.showModal;
      delete HTMLDialogElement.prototype.close;
    }
  });
  await safari14Page.goto(base);
  await safari14Page.getByRole('button', { name: '● 离线可用', exact: true }).waitFor();
  assert.equal(await safari14Page.locator('#install-dialog').isVisible(), false);
  await safari14Page.getByRole('button', { name: '安装与离线使用说明' }).click();
  assert.equal(await safari14Page.locator('#install-dialog').isVisible(), true);
  assert.equal(await safari14Page.locator('#install-backdrop').isVisible(), true);
  await safari14Page.getByRole('button', { name: '知道了' }).click();
  assert.equal(await safari14Page.locator('#install-dialog').isVisible(), false);
  await safari14Page.close();

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(base);
  await reducedPage.waitForSelector('.start-card');
  await reducedPage.evaluate(() => localStorage.setItem('c3-practice-v1', JSON.stringify({ cursor: 0, records: { 1: { correct: false, attempts: 1 } }, session: null })));
  await reducedPage.reload();
  await reducedPage.locator('.mode-card[data-mode="wrong"]').click();
  assert.equal(await reducedPage.locator('.question').evaluate(element => getComputedStyle(element).animationName), 'none');
  await reducedPage.locator('[data-key="D"]').click();
  assert.equal(await reducedPage.locator('.feedback').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.equal(await reducedPage.locator('.track i').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await reducedPage.getByRole('button', { name: '查看本组结果' }).click();
  assert.equal(await reducedPage.locator('.celebration').count(), 0);
  assert.equal(await reducedPage.locator('.result-icon').evaluate(element => getComputedStyle(element).animationName), 'none');
  await reduced.close();

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '继续上次练习' }).click();
  assert.match(await page.locator('.feedback').innerText(), /答对了/);
  await page.getByRole('button', { name: '下一题' }).click();
  await page.locator(`[data-key="${questions[1201].answer[0]}"]`).click();
  assert.match(await page.locator('.feedback').innerText(), /答对了/);
  await context.setOffline(false);

  // Long questions and narrow screens must wrap instead of overflowing.
  await setState({ cursor: 799, records: {}, session: null });
  await page.getByRole('button', { name: '开始 10 题练习' }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await oneScreen();
  await noOverflow(); await shot('long-question');
  await page.locator('.quiz-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('[data-key="C"]').click();
  await oneScreen(); await visibleAction();
  await shot('long-question-answered');
  await page.getByRole('button', { name: '下一题' }).click();
  assert.equal(await page.locator('.quiz-content').evaluate(element => element.scrollTop), 0);
  // A long multiple-choice draft must not jump back to the top on every tap.
  const longMultiple = questions.filter(q => q.type === 'multiple').sort((a,b) => (b.text.length + b.options.map(o => o.text).join('').length) - (a.text.length + a.options.map(o => o.text).join('').length))[0];
  await setState({ cursor: longMultiple.id - 1, records: {}, session: null });
  await page.getByRole('button', { name: '开始 10 题练习' }).click();
  await page.locator('.quiz-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const before = await page.locator('.quiz-content').evaluate(element => element.scrollTop);
  assert.ok(before > 0);
  await page.locator('.option').last().click();
  assert.equal(await page.locator('.quiz-content').evaluate(element => element.scrollTop), before);
  await visibleAction();
  await page.locator('[data-action="home"]').click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await noOverflow(); await shot('desktop');
  assert.deepEqual(errors, []);
  console.log(`${browserType}: mobile interactions, reload resume, multi-select draft, wrong review, original-answer notice, boolean questions, installation help, offline reload, narrow-screen wrapping, animations and reduced-motion PASS`);
} finally { await browser.close(); }
