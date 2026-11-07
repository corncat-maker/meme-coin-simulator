// 下架四步强平结算（域四-3）自检：结算价回退、玩家/AI/做市商平仓、cashOps、公告与不可变性
// 用法：node scripts/delist-settlement-check.mjs
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
await page.waitForFunction(() => typeof window.__DELIST_SETTLE_TEST__ === 'function', null, { timeout: 30000 });

let pass = 0;
let fail = 0;
const run = async (name, check) => {
  const r = await page.evaluate(() => window.__DELIST_SETTLE_TEST__());
  let ok = false;
  try { ok = check(r) === true; } catch { ok = false; }
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log('     ', JSON.stringify(r));
};

// 1. 结算价：优先 token.delistAvgPrice，缺失时回退预计算均价
await run('结算价：t1 用记录均价 100、t2 回退预计算 50', r =>
  near(r.delistPriceByToken.t1, 100) && near(r.delistPriceByToken.t2, 50));

// 2. 玩家仓位：下架仓位全部平掉、非下架仓位保留
await run('玩家仓位：p1/p2 平仓、p3 保留', r =>
  r.playerPositions.length === 1 && r.playerPositions[0].id === 'p3');

// 3. 成交记录：盈利→adl、亏损→liquidation、字段与顺序
await run('成交记录：盈利 ADL(+500)、亏损 liquidation(-120)、代码/数量/保证金正确', r =>
  r.tradeRecords.length === 2
  && r.tradeRecords[0].tokenId === 't1' && r.tradeRecords[0].tokenCode === 'AAA'
  && r.tradeRecords[0].action === 'adl' && near(r.tradeRecords[0].price, 130)
  && near(r.tradeRecords[0].pnl, 500) && near(r.tradeRecords[0].margin, 100)
  && r.tradeRecords[1].tokenId === 't2' && r.tradeRecords[1].action === 'liquidation'
  && near(r.tradeRecords[1].price, 50) && near(r.tradeRecords[1].pnl, -120));

// 4. 玩家资金：逐仓返还「保证金+盈亏」并释放冻结（add + clampZero 语义）
await run('玩家资金：cashOps 4 条（可用 +600/-80、冻结 -100/-40，全部 clampZero）', r =>
  r.cashOps.length === 4
  && r.cashOps[0].target === 'available' && near(r.cashOps[0].amount, 600) && r.cashOps[0].clampZero === true
  && r.cashOps[1].target === 'frozen' && near(r.cashOps[1].amount, -100) && r.cashOps[1].clampZero === true
  && r.cashOps[2].target === 'available' && near(r.cashOps[2].amount, -80) && r.cashOps[2].clampZero === true
  && r.cashOps[3].target === 'frozen' && near(r.cashOps[3].amount, -40) && r.cashOps[3].clampZero === true);

// 5. AI 交易员：按结算价队列平仓、资金 1000→1500、清理下架代币挂单
await run('AI 交易员：平仓价 120、资金 1000→1500、仅保留 t3 挂单', r =>
  r.ai.futuresCount === 0 && near(r.ai.availableCapital, 1500)
  && r.ai.orderTokenIds.length === 1 && r.ai.orderTokenIds[0] === 't3');

// 6. 做市商：平仓价 65、资金 500→525、清理下架代币挂单
await run('做市商：平仓价 65、资金 500→525、挂单清空', r =>
  r.mm.futuresCount === 0 && near(r.mm.availableCapital, 525) && r.mm.orderTokenIds.length === 0);

// 7. 公告与 toast 数据：类型/状态/回合/天数/文案/延迟
await run('公告 2 条（delist/executed/round 7/day 1）+ toast 延迟 500', r =>
  r.announcements.length === 2
  && r.announcements.every(a => a.type === 'delist' && a.status === 'executed' && a.round === 7 && a.day === 1)
  && r.announcements[0].tokenName === 'AAA Name'
  && r.announcements[0].title.includes('AAA')
  && r.toasts.length === 1 && r.toasts[0].type === 'error' && r.toasts[0].delay === 500
  && r.toasts[0].message.includes('AAA(流动性不足)') && r.toasts[0].message.includes('BBB(诈骗嫌疑)'));

// 8. 入参不可变：玩家仓位与 AI 结算价队列均未被修改
await run('入参不可变：玩家仓位、AI 结算价队列均未被修改', r =>
  r.immutable.positions === true && r.immutable.aiQueues === true);

console.log(`\n[delist-settlement] 断言 ${pass}/${pass + fail} 通过，pageErrors=${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
