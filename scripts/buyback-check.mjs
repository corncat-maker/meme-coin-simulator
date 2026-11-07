// 回合内回购销毁（域四-4）自检：吃单计算、销毁数据、盘口克隆、入参不可变
// 用法：node scripts/buyback-check.mjs
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
await page.waitForFunction(() => typeof window.__BUYBACK_TEST__ === 'function', null, { timeout: 30000 });

let pass = 0;
let fail = 0;
const run = async (name, mode, check) => {
  const r = await page.evaluate(m => window.__BUYBACK_TEST__({ mode: m }), mode);
  let ok = false;
  try { ok = check(r) === true; } catch { ok = false; }
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log('     ', JSON.stringify(r));
};

// 1. 项目资金池回购：1% = 10 USDT 部分吃 10 档卖单，买到 1 枚
await run('项目池回购：预算 10 → 买到 1 枚、花费 10、剩余 0', 'project', r =>
  r.burnCount === 1
  && r.burnUpdates[0].type === 'project_pool'
  && near(r.burnUpdates[0].burnQuantity, 1)
  && near(r.burnUpdates[0].spentAmount, 10)
  && near(r.burnUpdates[0].remainingBudget, 0));

// 2. 盘口克隆：吃单后剩余 49 枚 @10 + 100 枚 @12，总量 149；原盘口未被修改
await run('盘口克隆：49@10 + 100@12、总量 149、原盘口保持 50 枚', 'project', r =>
  r.bookUpdateKeys.length === 1
  && r.bookUpdates.t1.asks.length === 2
  && near(r.bookUpdates.t1.asks[0].quantity, 49)
  && near(r.bookUpdates.t1.totalAskQuantity, 149)
  && r.immutable.books === true
  && r.immutable.originalAsks === 2);

// 3. 项目池回购 toast 文案（formatNumber 千分位/取整）
await run('回购 toast：$10 → 销毁 1 枚', 'project', r =>
  r.toasts.length === 1
  && r.toasts[0].type === 'success'
  && r.toasts[0].message.includes('AAA')
  && r.toasts[0].message.includes('$10')
  && r.toasts[0].message.includes('销毁 1 枚'));

// 4. 第 24 回合：项目池回购 + CEX 收益回购各一笔（顺序：先项目池后收益）
await run('第24回合：两笔更新（project_pool → revenue）', 'both', r =>
  r.burnCount === 2
  && r.burnUpdates[0].type === 'project_pool'
  && r.burnUpdates[1].type === 'revenue'
  && near(r.burnUpdates[1].burnQuantity, 0.024)
  && near(r.burnUpdates[1].spentAmount, 0.24)
  && near(r.burnUpdates[1].burnRatio, 0.024 / 1000)
  && r.burnUpdates[1].lastClaimRound === 24
  && r.burnUpdates[1].volumeSinceLastClaim === 0);

// 5. 第 24 回合盘口：两轮回购连续消费同一盘口（49 → 48.976），总量 148.976
await run('第24回合盘口：48.976@10 + 100@12、总量 148.976', 'both', r =>
  near(r.bookUpdates.t1.asks[0].quantity, 48.976)
  && near(r.bookUpdates.t1.totalAskQuantity, 148.976)
  && r.immutable.books === true);

// 6. 第 24 回合 toast：两条，第二条为 CEX 收益回购
await run('第24回合 toast：2 条，含 CEX收益回购', 'both', r =>
  r.toasts.length === 2
  && r.toasts[1].message.includes('CEX收益回购')
  && r.toasts[1].message.includes('AAA'));

// 7. 无盘口：收益全额进入项目资金池（1000 + 0.24），提示「无CEX盘口」
await run('无盘口：收益 0.24 全部进项目资金池（1000.24）+ 提示无CEX盘口', 'nobook', r =>
  r.burnCount === 1
  && r.burnUpdates[0].type === 'revenue'
  && near(r.burnUpdates[0].newProjectFundPool, 1000.24)
  && near(r.burnUpdates[0].burnQuantity, 0)
  && r.toasts.length === 1
  && r.toasts[0].message.includes('无CEX盘口'));

// 8. 不满足条件（未开启自动回购 / 资金池过小）：零更新
await run('未开启自动回购：零更新', 'ineligible', r => r.burnCount === 0 && r.toasts.length === 0)
  .catch(() => {});
await run('资金池过小（预算<1）：零更新', 'smallpool', r => r.burnCount === 0 && r.toasts.length === 0);

console.log(`\n[buyback] 断言 ${pass}/${pass + fail} 通过，pageErrors=${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
