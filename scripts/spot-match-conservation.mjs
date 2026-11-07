// 现货限价单撮合资金守恒自检（域二-1 验收断言）
// 用法：node scripts/spot-match-conservation.mjs [--url http://127.0.0.1:5173]
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = getArg('--url', 'http://127.0.0.1:5173/');
const executablePath = getArg('--chrome', path.join(os.homedir(), '.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome'));

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => typeof window.__SPOT_MATCH_TEST__ === 'function', null, { timeout: 30000 });

const scenarios = [];
for (const side of ['buy', 'sell']) {
  // 买入冻结的是资金（100×10）；卖出冻结的是代币（不加资金冻结）。持仓必须 ≥ 卖出量（下单时已校验冻结）
  if (side === 'buy') {
    scenarios.push({ name: 'buy 限价成交（含已有持仓 5）', opts: { side, price: 100, fillPrice: 100, qty: 10, cash: 100000, frozen: 1000, positionQty: 5 } });
    scenarios.push({ name: 'buy 限价成交（空持仓）', opts: { side, price: 100, fillPrice: 100, qty: 10, cash: 100000, frozen: 0, positionQty: 0 } });
  } else {
    scenarios.push({ name: 'sell 限价成交（持仓 10 全部卖出）', opts: { side, price: 100, fillPrice: 100, qty: 10, cash: 100000, frozen: 0, positionQty: 10 } });
    scenarios.push({ name: 'sell 限价成交（持仓 20 卖出 10）', opts: { side, price: 100, fillPrice: 100, qty: 10, cash: 100000, frozen: 0, positionQty: 20 } });
  }
}

let pass = 0, fail = 0;
for (const sc of scenarios) {
  const r = await page.evaluate(o => window.__SPOT_MATCH_TEST__(o), sc.opts);
  const ok = Math.abs(r.diff) < 1e-6 && r.filledOrderCount === 1 && r.orderHistory === 1;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${sc.name} | 成交=${r.filledOrderCount} 成交历史=${r.orderHistory} 持仓增量=${r.positionDeltas.length} cex增量=${r.cexBalanceDeltas.length}`);
  console.log(`     现金 ${r.cashBefore} → +${r.cashDelta.toFixed(6)}，冻结 ${r.frozenBefore} → ${r.frozenDelta.toFixed(6)}，守恒差 ${r.diff.toExponential(3)}`);
}

console.log(`\n[spot-match] 断言 ${pass}/${pass + fail} 通过，pageErrors=${errors.length}`);
await browser.close();
if (fail > 0 || errors.length > 0) process.exit(1);
