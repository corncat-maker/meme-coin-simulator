import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const target = process.argv[2] || 'http://127.0.0.1:5223/';
const offline = !/^https?:/.test(target);
const url = offline ? pathToFileURL(path.resolve(target)).href : target;
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`, args: ['--no-sandbox'] });
let passed = 0;
const check = (value, label) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`); };
const errors = [];
const backgrounds = {};
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, offline });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url, { waitUntil: offline ? 'load' : 'networkidle' });
    await page.getByTestId('start-game-btn').click();
    for (const button of await page.locator('.modal-close:visible').all()) await button.click();
    await page.getByTestId('home-settings-btn').click();
    const toggle = page.locator('.settings-modal .theme-toggle-container .theme-toggle-slider');
    if (!(await toggle.getAttribute('class')).split(' ').includes(theme)) await toggle.click();
    await page.locator('.settings-modal .modal-close').click();
    await page.getByTestId('system-tab-wallet').click();
    check(await page.locator(`.theme-${theme}`).count() > 0, `${theme} applied through real settings`);
    await page.getByTestId('wallet-action-swap').click();
    const colors = await page.locator('.wallet-amount-card').first().evaluate(el => {
      const style = getComputedStyle(el);
      const text = getComputedStyle(document.querySelector('.wallet-output')).color;
      return { background: style.backgroundColor, text };
    });
    backgrounds[theme] = colors.background;
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = value => rgb(value).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [.2126, .7152, .0722][i], 0);
    const [lighter, darker] = [luminance(colors.background), luminance(colors.text)].sort((a, b) => b - a);
    const contrast = (lighter + .05) / (darker + .05);
    check(contrast >= 4.5, `${theme} primary amount contrast ${contrast.toFixed(2)}:1`);
    for (const view of ['swap', 'add', 'remove']) {
      if (view === 'add') {
        await page.getByTestId('wallet-back-btn').click();
        await page.getByTestId('wallet-action-liquidity').click();
      }
      if (view === 'remove') await page.getByTestId('wallet-liquidity-tab-remove').click();
      for (const width of [320, 390, 430, 768]) {
        await page.setViewportSize({ width, height: 844 });
        const layout = await page.getByTestId('wallet-view').evaluate(root => {
          const bad = [...root.querySelectorAll('button,input,output')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
          }).map(el => el.dataset.testid || el.className);
          return { bad, overflow: root.scrollWidth - root.clientWidth };
        });
        check(layout.bad.length === 0 && layout.overflow <= 1, `${theme} ${view} ${width}px fits ${JSON.stringify(layout)}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `/tmp/wallet-ux-${theme}-${view}.png`, fullPage: true });
    }
    await context.close();
  }
  check(backgrounds.dark !== backgrounds.light, `theme backgrounds differ ${JSON.stringify(backgrounds)}`);
  check(errors.length === 0, `pageErrors=0 ${JSON.stringify(errors)}`);
  console.log(`[wallet-theme] ${passed}/${passed} passed; ${offline ? 'offline production' : 'dev'}; DOM/color/geometry checks, not visual judgment`);
} finally { await browser.close(); }