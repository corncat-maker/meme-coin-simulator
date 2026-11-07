// 合约成交落账（域二-E2）自检：保证金 / 返还保证金 / PnL / 散户对手盘 / 流水
// 用法：node scripts/futures-settle-check.mjs
import { chromium } from 'playwright-core';

const EXECUTABLE = process.env.CHROMIUM_PATH
  || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__FUTURES_SETTLE_TEST__ === 'function', null, { timeout: 30000 });

let pass = 0;
let fail = 0;
const run = async (name, opts, check) => {
  const r = await page.evaluate(o => window.__FUTURES_SETTLE_TEST__(o), opts);
  const ok = check(r);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log('     ', JSON.stringify(r));
};

// 1. 开仓 500U @100 × 5 倍
await run('开仓 500U × 5 倍 → 保证金 100、持仓 5 币、释放挂单冻结 100', { mode: 'open' }, r =>
  r.positions.length === 1
  && near(r.positions[0].quantity, 5)
  && near(r.positions[0].margin, 100)
  && near(r.positions[0].entryPrice, 100)
  && near(r.positions[0].value, 500)
  && near(r.availableDelta, 0)
  && near(r.openMarginLocked, 100)
  && r.positions[0].liquidationPrice < 100,
);

// 2. 开仓散户对手盘：玩家开多 → 散户开空，金额=成交额、杠杆 1–5（rnd=0.5 → 3 倍）
await run('开仓生成反向散户持仓（做空、金额 500、杠杆 3、保证金 166.67）', { mode: 'open' }, r =>
  r.retail.length === 1
  && r.retail[0].side === 'short'
  && near(r.retail[0].quantity, 500)
  && r.retail[0].leverage === 3
  && near(r.retail[0].margin, 500 / 3),
);

// 3. 全部平仓：5 币 @120 → PnL +100、返还保证金 100、可用 +200、冻结 -100
await run('全部平仓 @120 → PnL +100、返还保证金 100、可用 +200、冻结 -100', { mode: 'close' }, r =>
  r.positions.length === 0
  && near(r.totalPnl, 100)
  && near(r.totalReturnMargin, 100)
  && near(r.availableDelta, 200)
  && near(r.frozenDelta, -100)
  && near(r.openMarginLocked, 0)
  && near(r.closeTrades[0].pnl, 100)
  && near(r.closeTrades[0].margin, 100),
);

// 4. 平仓散户对手盘：玩家平多 → 散户做多（OI 双向记账）
await run('平仓生成同向散户持仓（做多、金额 600）', { mode: 'close' }, r =>
  r.retail.length === 1 && r.retail[0].side === 'long' && near(r.retail[0].quantity, 600),
);

// 5. 部分平仓 2/5 币 @120 → 剩 3 币、价值 300、保证金 60、PnL +40、返还 40
await run('部分平仓 2/5 @120 → 剩 3 币/价值 300/保证金 60/PnL +40', { mode: 'partial' }, r =>
  r.positions.length === 1
  && near(r.positions[0].quantity, 3)
  && near(r.positions[0].value, 300)
  && near(r.positions[0].margin, 60)
  && near(r.totalPnl, 40)
  && near(r.totalReturnMargin, 40)
  && near(r.availableDelta, 80),
);

// 6. 成交流水：开仓单记 1 条 open，平仓单记 1 条 close，均带 tokenCode
await run('成交流水字段完整（open/close、tokenCode、价格数量金额）', { mode: 'open' }, r =>
  r.openTrades.length === 1
  && r.openTrades[0].action === 'open'
  && r.openTrades[0].tokenCode === 'T1'
  && near(r.openTrades[0].value, 500)
  && near(r.openTrades[0].quantity, 5),
);

// 7. 输入持仓不被原地修改
await run('输入持仓不可变（原持仓数量仍为 5，结果 3）', { mode: 'partial' }, r => near(r.inputQuantity, 5) && near(r.positions[0].quantity, 3));

console.log(`\n[futures-settle] 断言 ${pass}/${pass + fail} 通过，pageErrors=${errors.length}`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
