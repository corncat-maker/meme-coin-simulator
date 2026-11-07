// 合约限价单撮合自检（域二-2 验收断言）
// 用法：node scripts/futures-match-check.mjs [--url http://127.0.0.1:5173]
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
await page.waitForFunction(() => typeof window.__FUTURES_MATCH_TEST__ === 'function', null, { timeout: 30000 });

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// [名称, 入参, 验证函数]；期望值全部硬编码，可由纯函数逐字推导
const cases = [
  {
    name: 'open_long 495U × 卖一 99×5 → 全额成交（名义价值计）',
    opts: { side: 'open_long', price: 100, quantity: 495, ask: { price: 99, quantity: 5 } },
    check: r => r.filledCount === 1 && near(r.fill.filledValue, 495) && near(r.fill.filledTokenQty, 5)
      && near(r.fill.avgPrice, 99) && r.order.status === 'filled' && near(r.book.asks[0].quantity, 0),
  },
  {
    name: 'open_long 1000U × 卖一 99×5 → 部分成交，订单保持 pending',
    opts: { side: 'open_long', price: 100, quantity: 1000, ask: { price: 99, quantity: 5 } },
    check: r => r.filledCount === 1 && near(r.fill.filledValue, 495) && near(r.order.filledQuantity, 495)
      && r.order.status === 'pending' && near(r.order.filledTokenQty, 5),
  },
  {
    name: 'open_long 限价 90 × 卖一 99 → 价格不满足，不成交',
    opts: { side: 'open_long', price: 90, quantity: 495, ask: { price: 99, quantity: 5 } },
    check: r => r.filledCount === 0 && r.order.status === 'pending' && near(r.book.asks[0].quantity, 5),
  },
  {
    name: 'open_short 495U × 买一 100×1000 → 部分吃掉 4.95 币',
    opts: { side: 'open_short', price: 100, quantity: 495, bid: { price: 100, quantity: 1000 } },
    check: r => r.filledCount === 1 && near(r.fill.filledValue, 495) && near(r.fill.filledTokenQty, 4.95)
      && near(r.book.bids[0].quantity, 995.05) && r.order.status === 'filled',
  },
  {
    name: 'close_long 495U × 买一 100 → 吃买盘（平多挂卖盘）',
    opts: { side: 'close_long', price: 100, quantity: 495, bid: { price: 100, quantity: 1000 } },
    check: r => r.filledCount === 1 && near(r.fill.filledValue, 495) && near(r.fill.filledTokenQty, 4.95),
  },
  {
    name: 'close_short 495U × 卖一 99 → 吃卖盘（平空挂买盘）',
    opts: { side: 'close_short', price: 100, quantity: 495, ask: { price: 99, quantity: 5 } },
    check: r => r.filledCount === 1 && near(r.fill.filledValue, 495) && near(r.fill.filledTokenQty, 5),
  },
  {
    name: '跳过玩家自己的挂单（isPlayer）',
    opts: { side: 'open_long', price: 100, quantity: 495, makeOwnLevel: true, ask: { price: 99, quantity: 5 } },
    check: r => r.filledCount === 0 && r.order.status === 'pending',
  },
  {
    name: '交易所宕机当回合：所有挂单不撮合',
    opts: { side: 'open_long', price: 100, quantity: 495, exchangeDown: true, ask: { price: 99, quantity: 5 } },
    // 宕机分支不建书（与 App 侧一致：后续统一补空盘口）
    check: r => r.filledCount === 0 && r.order.status === 'pending' && r.book === null,
  },
  {
    name: '输入盘口不被原地修改（纯函数不可变）',
    opts: { side: 'open_long', price: 100, quantity: 495, ask: { price: 99, quantity: 5 } },
    check: r => near(r.inputBook.asks[0].quantity, 5) && near(r.book.asks[0].quantity, 0),
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = await page.evaluate(o => window.__FUTURES_MATCH_TEST__(o), c.opts);
  const ok = c.check(r);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}`);
  if (!ok) console.log('     ', JSON.stringify(r));
}

// ============ 交叉盘撮合（域二-3） ============
await page.waitForFunction(() => typeof window.__FUTURES_CROSS_TEST__ === 'function', null, { timeout: 30000 });
const crossCases = [
  {
    name: '交叉盘：玩家买一 101×10 撞卖一 100×5 → 按卖一价成交 5 币',
    opts: {},
    check: r => r.fills.length === 1
      && r.fills[0].side === 'open_long' && near(r.fills[0].avgPrice, 100)
      && near(r.fills[0].filledValue, 500) && near(r.fills[0].filledTokenQty, 5)
      && near(r.bids[0].quantity, 5) && r.asks.length === 0 && near(r.price, 101),
  },
  {
    name: '交叉盘：无交叉（买一 100 < 卖一 101）→ 不成交',
    opts: { bidPrice: 100, askPrice: 101 },
    check: r => r.fills.length === 0 && near(r.price, 100)
      && near(r.bids[0].quantity, 10) && near(r.asks[0].quantity, 5),
  },
  {
    name: '交叉盘：宕机当回合跳过（保留原盘口，不清理 0 量）',
    opts: { skip: true, bidQty: 0 },
    check: r => r.fills.length === 0 && r.price === null && near(r.bids[0].quantity, 0) && r.asks.length === 1,
  },
  {
    name: '交叉盘：禁开仓代币跳过',
    opts: { blocked: true },
    check: r => r.fills.length === 0 && r.price === null && near(r.bids[0].quantity, 10),
  },
  {
    name: '交叉盘：入参盘口不被原地修改',
    opts: {},
    check: r => near(r.inputBidQty, 10) && near(r.inputAskQty, 5),
  },
];
for (const c of crossCases) {
  const r = await page.evaluate(o => window.__FUTURES_CROSS_TEST__(o), c.opts);
  const ok = c.check(r);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}`);
  if (!ok) console.log('     ', JSON.stringify(r));
}

console.log(`\n[futures-match] 断言 ${pass}/${pass + fail} 通过，pageErrors=${errors.length}`);
await browser.close();
if (fail > 0 || errors.length > 0) process.exit(1);
