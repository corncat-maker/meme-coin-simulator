#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5223/';
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
const checks = [];
const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);
const check = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}`); };
page.on('pageerror', error => pageErrors.push(String(error)));
try {
  await page.addInitScript(() => {
    let seed = 20261031;
    Math.random = () => {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const unit = await page.evaluate(async () => {
    const { summarizeContractPositions, restoreContractPositionHistory } = await import('/src/logic/contractPositions.ts');
    const { getInitialRetailSideOpenInterestRatio } = await import('/src/logic/futures.ts');
    const players = [{ side: 'long', quantity: 2, value: 200, entryPrice: 100 }];
    const retail = [
      { side: 'long', quantity: 1000, entryPrice: 100 },
      { side: 'long', quantity: 1000, entryPrice: 200 },
      { side: 'short', quantity: 500, entryPrice: 50 },
    ];
    const ai = [{ side: 'short', quantity: 3, entryPrice: 100 }];
    const mm = [{ side: 'long', quantity: 4, entryPrice: 200 }];
    const before = JSON.stringify([players, retail, ai, mm]);
    [players, retail, ai, mm].forEach(items => { items.forEach(Object.freeze); Object.freeze(items); });
    const totals = summarizeContractPositions(players, retail, ai, mm);
    const legacy = { round: 1, tokenId: 'btc', totalLongQuantity: 1e12, totalShortQuantity: 1e12, totalLongValue: 1e17, totalShortValue: 1e17, avgPrice: 64375 };
    const fixed = { ...legacy, ...totals, unitsVersion: 2 };
    return {
      totals, unchanged: before === JSON.stringify([players, retail, ai, mm]),
      retained: restoreContractPositionHistory([legacy, fixed]),
      empty: restoreContractPositionHistory(undefined),
      ratios: [6, 5, 4, 3, 2, 1].map(getInitialRetailSideOpenInterestRatio),
    };
  });
  check('散户USDT按各自开仓价换算：多头含玩家和做市商共21枚', near(unit.totals.totalLongQuantity, 21));
  check('空头币数含散户/AI：13枚', near(unit.totals.totalShortQuantity, 13));
  check('多头名义金额直接相加：3000U，不再重复乘价格', near(unit.totals.totalLongValue, 3000));
  check('空头名义金额直接相加：800U', near(unit.totals.totalShortValue, 800));
  check('汇总不修改任何输入仓位', unit.unchanged);
  check('旧失真图表缓存过滤，新版历史保留', unit.retained.length === 1 && unit.retained[0].unitsVersion === 2 && unit.empty.length === 0);
  check('初始化单边比例按tier递减', unit.ratios.every((r, i) => r > 0 && r <= 0.015 && (i === 0 || r <= unit.ratios[i - 1])));

  await page.getByTestId('start-game-btn').click();
  await page.waitForFunction(() => window.__MARKET_STORE__?.getState().tokens.length > 0 && typeof window.__CONTRACT_POSITION_STATS__ === 'function');
  const initial = await page.evaluate(() => {
    const btc = window.__MARKET_STORE__.getState().tokens.find(t => t.code === 'BTC');
    return window.__CONTRACT_POSITION_STATS__(btc.id);
  });
  const marketCap = initial.token.currentPrice * (initial.token.circulatingSupply - (initial.token.playerReservedAmount || 0));
  check('新开局BTC多/空各1.5%市值，不再加DEX巨额储备', near(initial.totals.totalLongValue, marketCap * 0.015) && near(initial.totals.totalShortValue, marketCap * 0.015));
  check('BTC多空总敞口约381亿美元而非几万T', initial.retailNotional > 30e9 && initial.retailNotional < 45e9 && initial.retailCount === 640);

  for (let round = 1; round <= 3; round++) {
    await page.evaluate(() => document.querySelector('[data-testid="fast-forward-btn"]').click());
    await page.waitForFunction(expected => {
      const btc = window.__MARKET_STORE__.getState().tokens.find(t => t.code === 'BTC');
      const snap = window.__CONTRACT_POSITION_STATS__(btc.id);
      return snap?.round === expected && snap.history.some(h => h.round === expected);
    }, round);
    await page.waitForTimeout(250);
  }
  const after = await page.evaluate(() => {
    const btc = window.__MARKET_STORE__.getState().tokens.find(t => t.code === 'BTC');
    return window.__CONTRACT_POSITION_STATS__(btc.id);
  });
  const latest = after.history.find(h => h.round === after.round);
  check('实际3回合历史与四类真实仓位汇总完全一致', Object.keys(after.totals).every(k => near(latest[k], after.totals[k])));
  check('修复后BTC历史数量小于100万枚、价值低于1000亿美元', latest.totalLongQuantity + latest.totalShortQuantity < 1e6 && latest.totalLongValue + latest.totalShortValue < 100e9);
  check('页面无运行时异常', pageErrors.length === 0);
  console.log('[contract-positions] BTC:', JSON.stringify({ initial: initial.totals, round3: after.totals, marketCap, pageErrors }));
  console.log(`[contract-positions] 断言 ${checks.filter(c => c.ok).length}/${checks.length} 通过`);
  assert.ok(checks.every(c => c.ok), checks.filter(c => !c.ok).map(c => c.name).join('; '));
} finally {
  await browser.close();
}
