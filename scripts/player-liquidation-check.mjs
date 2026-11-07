// 玩家强平（域三-3）自检：逐仓没收/全仓清零、吃单、ADL、挂单成交、不可变性
// 用法：node scripts/player-liquidation-check.mjs
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
await page.waitForFunction(() => typeof window.__PLAYER_LIQ_TEST__ === 'function', null, { timeout: 30000 });

let pass = 0;
let fail = 0;
const run = async (name, opts, check) => {
  const r = await page.evaluate(o => window.__PLAYER_LIQ_TEST__(o), opts);
  const ok = check(r);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log('     ', JSON.stringify(r));
};

// 1. 逐仓多仓强平：吃买盘 4@90 + 6@89 → PnL -106、冻结没收 100、可用 -106
await run('逐仓强平：吃单均价 89.4、PnL -106、没收保证金、可用 -106', { mode: 'isolated' }, r =>
  r.liquidatedIds.join() === 'p1'
  && r.liquidationCount === 1
  && r.cashOps.length === 2
  && r.cashOps[0].target === 'frozen' && near(r.cashOps[0].amount, -100) && r.cashOps[0].clampZero === true
  && r.cashOps[1].target === 'available' && near(r.cashOps[1].amount, -106)
  && r.positionsAfter.length === 0
  && r.tradeHistory.length === 1
  && near(r.tradeHistory[0].price, 89.4)
  && near(r.tradeHistory[0].pnl, -206)
  && near(r.liquidationDeltas.t1.longAmount, 1000)
  && near(r.liquidationDeltas.t1.shortAmount, 0)
  && r.toasts.length === 1 && r.toasts[0].type === 'error',
);

// 2. 强平吃单生成散户对手盘（多头）：4@90 → 360、6@89 → 534，杠杆 3（rnd=0.5）
await run('吃单生成散户多仓：360/534、杠杆 3、保证金 120/178', { mode: 'isolated' }, r =>
  r.newRetail.length === 2
  && r.newRetail[0].side === 'long' && near(r.newRetail[0].quantity, 360) && r.newRetail[0].leverage === 3 && near(r.newRetail[0].margin, 120)
  && r.newRetail[1].side === 'long' && near(r.newRetail[1].quantity, 534) && near(r.newRetail[1].margin, 178),
);

// 3. 吃玩家挂单：订单部分成交回写、开仓建仓 6 币 @89、保证金 106.8、散户对手盘做空
await run('吃玩家买盘：成交 6@89、开多仓保证金 106.8、散户对手盘做空 534', { mode: 'player' }, r =>
  r.mergedOrderFills.length === 1
  && near(r.mergedOrderFills[0].totalQty, 6) && near(r.mergedOrderFills[0].totalValue, 534)
  && r.playerOpenFills.length === 1 && r.playerOpenFills[0].side === 'open_long' && r.playerOpenFills[0].leverage === 5
  && near(r.playerOpenMarginTotal, 106.8)
  && r.positionsAfter.length === 1
  && near(r.positionsAfter[0].entryPrice, 89) && near(r.positionsAfter[0].quantity, 6)
  && near(r.positionsAfter[0].margin, 106.8) && r.positionsAfter[0].liquidationPrice < 89
  && r.newRetail.some(p => p.side === 'short' && near(p.quantity, 534))
  && r.cashOps.length === 3 && near(r.cashOps[2].amount, -106.8)
  && r.tradeHistory.length === 2 && r.tradeHistory[0].action === 'open'
  && r.toasts.length === 2 && r.toasts[1].type === 'success',
);

// 4. 全仓触发：所有仓位一起强平、现金全部清零（set 0）
await run('全仓触发：全部仓位强平、可用/冻结 set 0、保证金池 10', { mode: 'cross' }, r =>
  r.crossTriggered === true
  && r.liquidatedIds.length === 2
  && r.liquidationCount === 2
  && near(r.crossMarginPool, 10)
  && r.positionsAfter.length === 0
  && r.cashOps.length === 4
  && r.cashOps.every(op => op.kind === 'set' && near(op.amount, 0))
  && r.toasts.length === 2,
);

// 5. ADL 被吃方结算：玩家 p2 全平、返还保证金 80、PnL +500
await run('ADL 结算：p2 全平、返还保证金 80、PnL +500、持仓清空', { mode: 'adl' }, r =>
  r.adlPlayerUpdates.length === 1
  && r.adlPlayerUpdates[0].positionId === 'p2' && r.adlPlayerUpdates[0].removed === true
  && near(r.adlReturnMargin, 80) && near(r.adlPnl, 500)
  && r.positionsAfter.length === 0
  && r.cashOps.length === 4
  && near(r.cashOps[2].amount, 580)
  && near(r.cashOps[3].amount, -80),
);

// 6. 无强平：持仓原样保留（仅刷新浮盈浮亏），资金无变动
await run('无强平：持仓保留、浮盈 -100、无资金变动', { mode: 'none' }, r =>
  r.liquidationCount === 0
  && r.cashOps.length === 0
  && r.remainingCount === 1
  && r.positionsAfter.length === 1
  && near(r.positionsAfter[0].unrealizedPnl, -100)
  && r.bookUnchanged === true && r.positionsUnchanged === true,
);

// 7. 不可变性：输入盘口/持仓在结算后完全未变（吃单发生在克隆上）
await run('输入盘口/持仓不可变（吃单发生在克隆盘口）', { mode: 'player' }, r =>
  r.bookUnchanged === true && r.positionsUnchanged === true,
);

console.log(`\n[player-liquidation] 断言 ${pass}/${pass + fail} 通过，pageErrors=${errors.length}`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
