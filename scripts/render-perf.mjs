// 渲染性能探针脚本：统计「下一回合」5 次操作中各组件渲染次数与耗时
// 用法：node scripts/render-perf.mjs [--out perf.json]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EXECUTABLE = process.env.CHROMIUM_PATH
  || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const ROUNDS = Number(process.env.PERF_ROUNDS || 5);
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;

const settle = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.locator('[data-testid="start-game-btn"]').waitFor({ state: 'visible', timeout: 180000 });
await settle(page, 200);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await page.locator('[data-testid="start-game-btn"]').waitFor({ state: 'visible', timeout: 180000 });
await settle(page, 250);
await page.locator('[data-testid="start-game-btn"]').click();
await page.locator('.top-info-bar .round-time').first().waitFor({ state: 'visible', timeout: 180000 });
await settle(page, 500);
// 关闭初始弹窗（热点/事件），保证两次测量起点一致
for (const sel of ['.modal-overlay .modal-close', '.hot-sector-modal .modal-close', '.event-modal .modal-close']) {
  const el = page.locator(sel).first();
  if (await el.count()) await el.click({ timeout: 2000 }).catch(() => {});
}
await settle(page, 400);

const probeStart = await page.evaluate(() => {
  const w = window;
  if (!w.__RENDER_PROBE__) return null;
  w.__RENDER_PROBE__.counts = {};
  w.__RENDER_PROBE__.since = Date.now();
  return true;
});
if (!probeStart) { console.error('渲染探针不可用（非 DEV 构建？）'); process.exit(2); }

const roundTimes = [];
const t0 = Date.now();
for (let i = 1; i <= ROUNDS; i++) {
  const before = await page.locator('.top-info-bar .round-time').first().textContent();
  const start = Date.now();
  await page.locator('[data-testid="fast-forward-btn"]').first().click();
  await page.waitForFunction(
    prev => document.querySelector('.top-info-bar .round-time')?.textContent !== prev,
    before, { timeout: 120000 },
  );
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="fast-forward-btn"]');
    return btn && !btn.hasAttribute('disabled');
  }, null, { timeout: 120000 });
  roundTimes.push(Date.now() - start);
  // 关闭可能出现的弹窗（与测量起点对齐）
  for (const sel of ['.modal-overlay .modal-close']) {
    const el = page.locator(sel).first();
    if (await el.count()) await el.click({ timeout: 1500 }).catch(() => {});
  }
  await settle(page, 250);
}
const totalMs = Date.now() - t0;
const probe = await page.evaluate(() => ({
  counts: window.__RENDER_PROBE__?.counts ?? {},
  commits: window.__MARKET_COMMIT_STATS__?.commits ?? null,
  commitKeys: window.__MARKET_COMMIT_STATS__?.keys ?? null,
  writes: window.__MARKET_COMMIT_STATS__?.writes ?? {},
  setterCounts: window.__SETTER_COUNTS__ ?? {},
}));

// ===== 阶段二：行情页（MarketTokenList 已挂载）渲染隔离测量 =====
let marketPhase = null;
const marketTabBtn = await page.$('[data-testid="nav-market"]');
if (marketTabBtn) {
  await marketTabBtn.click();
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    window.__RENDER_PROBE__.counts = {};
    window.__RESET_SETTER_COUNTS__?.();
  });
  const startMs2 = Date.now();
  let clicked2 = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const btn2 = await page.$('[data-testid="fast-forward-btn"]');
    if (!btn2) break;
    if (await btn2.evaluate((el) => el.disabled)) { await page.waitForTimeout(120); continue; }
    await btn2.click();
    clicked2 += 1;
    await page.waitForTimeout(650);
  }
  const probe2 = await page.evaluate(() => ({
    counts: window.__RENDER_PROBE__?.counts ?? {},
    commits: window.__MARKET_COMMIT_STATS__?.commits ?? null,
  }));
  marketPhase = {
    rounds: clicked2,
    elapsedMs: Date.now() - startMs2,
    counts: probe2.counts,
    countsPerRound: Object.fromEntries(Object.entries(probe2.counts).map(([k, v]) => [k, +(v / Math.max(1, clicked2)).toFixed(2)])),
    storeCommits: probe2.commits,
  };
}

// ===== 阶段三：现货交易页（OrderBookPanel 已挂载）=====
let tradePhase = null;
const tradeTabBtn = await page.$('[data-testid="nav-trade"]');
if (tradeTabBtn) {
  await tradeTabBtn.click();
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    window.__RENDER_PROBE__.counts = {};
    window.__RESET_SETTER_COUNTS__?.();
  });
  const startMs3 = Date.now();
  let clicked3 = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const btn3 = await page.$('[data-testid="fast-forward-btn"]');
    if (!btn3) break;
    if (await btn3.evaluate((el) => el.disabled)) { await page.waitForTimeout(120); continue; }
    await btn3.click();
    clicked3 += 1;
    await page.waitForTimeout(650);
  }
  const probe3 = await page.evaluate(() => ({
    counts: window.__RENDER_PROBE__?.counts ?? {},
    commits: window.__MARKET_COMMIT_STATS__?.commits ?? null,
  }));
  tradePhase = {
    rounds: clicked3,
    elapsedMs: Date.now() - startMs3,
    counts: probe3.counts,
    countsPerRound: Object.fromEntries(Object.entries(probe3.counts).map(([k, v]) => [k, +(v / Math.max(1, clicked3)).toFixed(2)])),
    storeCommits: probe3.commits,
  };
}

const report = {
  rounds: ROUNDS,
  totalMs,
  avgRoundMs: Math.round(totalMs / ROUNDS),
  roundTimes,
  counts: probe.counts,
  storeCommits: probe.commits,
  storeCommitsPerRound: probe.commits == null ? null : +(probe.commits / ROUNDS).toFixed(2),
  storeCommitKeys: probe.commitKeys,
  writes: probe.writes,
  setterCounts: probe.setterCounts,
  marketPhase,
  tradePhase,
  countsPerRound: Object.fromEntries(Object.entries(probe.counts).map(([k, v]) => [k, +(v / ROUNDS).toFixed(2)])),
  pageErrors: errors.length,
  capturedAt: new Date().toISOString(),
};
console.log(JSON.stringify(report, null, 2));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
