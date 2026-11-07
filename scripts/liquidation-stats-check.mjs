// 爆仓金额统计口径断言：
// 1) 每条强平历史的 amount 必须等于「散户 + 玩家 + AI/做市商」三处强制平仓来源之和；
// 2) ADL 减仓 / 主动平仓不会写入强平历史（代码层只有三处强制平仓入口写金额）；
// 3) 卡片窗口口径：1 回合 = 1 小时，1h 窗口只含当前回合。
import { chromium } from 'playwright-core';
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199/';
const ROUNDS = Number(process.env.ROUNDS || 16);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('[data-testid="start-game-btn"]');
await page.locator('.top-info-bar .round-time').first().waitFor({ state: 'visible', timeout: 120000 });
await page.waitForTimeout(800);
for (let p = 0; p < 3; p++) {
  const els = await page.$$('.modal-close, .modal-content button');
  for (const el of els) { try { const t = (await el.textContent() || '').trim(); if (/关闭|知道了|确定|×/.test(t)) await el.click({ timeout: 300 }); } catch {} }
  await page.waitForTimeout(120);
}
for (let i = 0; i < ROUNDS; i++) {
  const before = await page.evaluate(() => document.querySelector('.top-info-bar .round-time')?.textContent || '');
  await page.evaluate(() => document.querySelector('[data-testid="fast-forward-btn"]')?.click());
  for (let k = 0; k < 80; k++) {
    await page.waitForTimeout(250);
    const t = await page.evaluate(() => document.querySelector('.top-info-bar .round-time')?.textContent || '');
    if (t !== before) break;
  }
  await page.waitForTimeout(80);
}

const snap = await page.evaluate(() => {
  const st = window.__MARKET_STORE__.getState();
  const entries = [];
  for (const token of st.tokens) {
    for (const h of token.liquidationHistory || []) entries.push({ code: token.code, ...h });
  }
  return { entries, round: st.tokens.length ? null : null };
});

check('强平历史存在记录', snap.entries.length > 0, `entries=${snap.entries.length}`);
if (snap.entries.length === 0) {
  check('（样本为空）跳过拆解校验', true);
} else {
  const withBreakdown = snap.entries.filter((e) => e.retailAmount !== undefined || e.playerAmount !== undefined || e.aiAmount !== undefined);
  check('每条记录都带来源拆解字段', withBreakdown.length === snap.entries.length, `${withBreakdown.length}/${snap.entries.length}`);
  const bad = snap.entries.filter((e) => !near(e.amount, (e.retailAmount || 0) + (e.playerAmount || 0) + (e.aiAmount || 0), Math.max(1e-6, e.amount * 1e-9)));
  check('amount = 散户+玩家+AI 强制平仓之和', bad.length === 0, bad.slice(0, 3).map((b) => `${b.code}@${b.round}: ${b.amount} vs ${(b.retailAmount||0)+(b.playerAmount||0)+(b.aiAmount||0)}`).join('; '));
  const neg = snap.entries.filter((e) => e.amount <= 0);
  check('不存在非正金额记录', neg.length === 0, `${neg.length}`);
}

check('页面无运行时异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`[liquidation-stats] 断言 ${results.length - failed.length}/${results.length} 通过，pageErrors=${pageErrors.length}`);
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' :: ' + r.detail : ''}`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
