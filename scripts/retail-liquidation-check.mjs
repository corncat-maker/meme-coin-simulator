// 散户强平（域三-2）自检：吃单 / ADL 成交 / 玩家挂单成交 / 对手散户仓 / 不可变性
// 用法：node scripts/retail-liquidation-check.mjs
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
await page.waitForFunction(() => typeof window.__RETAIL_LIQ_TEST__ === 'function', null, { timeout: 30000 });

let pass = 0;
let fail = 0;
const run = async (name, opts, check) => {
  const r = await page.evaluate(o => window.__RETAIL_LIQ_TEST__(o), opts);
  const ok = check(r);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log('     ', JSON.stringify(r));
};

// 1. 多仓强平卖 10 币：先吃 4 个普通买盘 → 生成散户多头对手仓；再吃 6 个玩家买盘 → 记玩家成交
await run('多仓强平吃买盘：普通档生成散户多仓 + 玩家档记限价成交', { mode: 'long' }, r =>
  r.hasLiquidations
  && r.liquidatedIds.length === 1
  && near(r.liquidationAmounts.t1.longAmount, 1000)
  && near(r.liquidationAmounts.t1.shortAmount, 0)
  && r.newRetail.length === 2
  && r.newRetail[0].side === 'long' && near(r.newRetail[0].quantity, 360) && r.newRetail[0].leverage === 3
  && r.newRetail[1].side === 'short' && near(r.newRetail[1].quantity, 534) && near(r.newRetail[1].margin, 178)
  && near(r.newRetail[1].entryPrice, 89)
  && r.rndCalls === 2,
);

// 2. 吃单后盘口：0 量档位清除、玩家档位扣减、总量重算
await run('吃单后盘口：买一 4 已清、玩家档剩 94、总量重算', { mode: 'long' }, r =>
  r.bookAfter.bids.length === 1
  && near(r.bookAfter.bids[0].quantity, 94)
  && near(r.bookAfter.totalBidQuantity, 94)
  && near(r.bookAfter.asks[0].quantity, 100),
);

// 3. 不可变性：输入盘口对象完全未被修改
await run('输入盘口不可变（返回克隆，原对象不变）', { mode: 'long' }, r =>
  r.inputBookUnchanged === true && r.bookAfter !== null,
);

// 4. 玩家挂单成交：按订单合并 + 部分成交回写 + 开仓成交带杠杆/模式 + 保证金释放
await run('玩家挂单成交 6 币 @89：订单部分成交回写、开仓保证金 106.8、流水 action=open', { mode: 'long' }, r =>
  r.mergedOrderFills.length === 1
  && near(r.mergedOrderFills[0].totalQty, 6)
  && near(r.mergedOrderFills[0].totalValue, 534)
  && near(r.mergedOrderFills[0].avgPrice, 89)
  && r.playerOpenFills.length === 1
  && r.playerOpenFills[0].side === 'open_long'
  && r.playerOpenFills[0].leverage === 5
  && r.playerOpenFills[0].marginMode === 'isolated'
  && near(r.playerOpenMarginTotal, 106.8)
  && r.playerOpenTradeRecords.length === 1
  && r.playerOpenTradeRecords[0].action === 'open'
  && r.ordersAfter.length === 1
  && near(r.ordersAfter[0].filledQuantity, 534)
  && near(r.ordersAfter[0].filledTokenQty, 6),
);

// 5. 全仓保证金池：可用 1000 + 冻结 200 + 正浮盈 0
await run('全仓保证金池 = 可用 + 冻结 + 持仓正浮盈', { mode: 'long' }, r => near(r.crossMarginPool, 1200));

// 6. 空仓强平吃 ADL 卖盘：结算玩家 ADL（没收保证金语义由域三-3 处理，这里只算 PnL/返还）
await run('空仓强平吃 ADL 档：ADL 成交记玩家、PnL +410、返还保证金 100、不生成散户仓', { mode: 'short' }, r =>
  r.hasLiquidations
  && r.adlFillCount === 1
  && r.adlPlayerUpdates.length === 1
  && r.adlPlayerUpdates[0].removed === true
  && near(r.adlTradeRecords[0].pnl, 410)
  && near(r.adlTradeRecords[0].margin, 100)
  && near(r.adlReturnMargin, 100)
  && near(r.adlPnl, 410)
  && r.newRetail.length === 0
  && r.rndCalls === 0,
);

// 7. 无强平：不返回盘口克隆，散户列表按分组重建（含套利新生仓）
await run('无强平：盘口无克隆、按分组重建散户列表', { mode: 'none' }, r =>
  r.hasLiquidations === false
  && r.liquidatedIds.length === 0
  && r.retailRebuildCount === 2
  && r.inputBookUnchanged === true,
);

console.log(`\n[retail-liquidation] 断言 ${pass}/${pass + fail} 通过，pageErrors=${errors.length}`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
