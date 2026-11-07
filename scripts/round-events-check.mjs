// 回合事件系统（域四-5）自检：每日事件 / 突发事件 / 开发者模式 / 过期清理 / 随机数顺序 / 入参不可变
// 用法：node scripts/round-events-check.mjs
import { chromium } from 'playwright-core';

const EXECUTABLE = process.env.CHROMIUM_PATH
  || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__ROUND_EVENTS_TEST__ === 'function', null, { timeout: 30000 });

let pass = 0;
let fail = 0;
const run = async (name, mode, check) => {
  const r = await page.evaluate(m => window.__ROUND_EVENTS_TEST__({ mode: m }), mode);
  let ok = false;
  try { ok = check(r) === true; } catch { ok = false; }
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log('     ', JSON.stringify({ ...r, suddenHackTokenIds: r.suddenHackTokenIds }));
};

// 1. 每日 20:00 公布事件：activeEvent 写入、todayEvent 清空、历史记录当天、弹窗标记
await run('每日20:00：activeEvent 生效 + 清空 todayEvent + 记录历史 + 弹窗', 'daily', r =>
  r.activeEvent !== null
  && r.activeEvent.eventId === r.expectedBullId
  && r.activeEvent.announcementRound === 20
  && r.todayEvent === null
  && r.eventHistory[r.expectedBullId] === 1
  && r.showEventModal === true
  && r.announcements.length === 1
  && r.announcements[0].type === 'market'
  && r.announcements[0].round === 20);

// 2. 每日事件影响恐惧贪婪：按事件等级上调
await run('每日事件：恐惧贪婪按等级上调', 'daily', r =>
  r.fearGreedChanged === true
  && r.fearGreedIndex > 50
  && Number.isInteger(r.fearGreedIndex));

// 3. 事件窗口过期：公布 24 回合后自动清理
await run('窗口过期：公布 40 回合后 activeEvent 清空', 'expire', r =>
  r.activeEvent === null && r.showEventModal === false);

// 4. 开发者模式突发事件：指定代币生效（弹窗 + 公告 + 停牌集合）
await run('开发者突发事件：T1 停牌 + 弹窗 + 突发公告', 'suddenDev', r =>
  r.suddenEvent !== null
  && r.suddenEvent.tokenId === 't1'
  && r.suddenEvent.tokenCode === 'T1'
  && r.showSuddenEventModal === true
  && r.suddenHackTokenIds.includes('t1')
  && r.announcements.length === 1
  && r.announcements[0].type === 'sudden'
  && r.pendingDevHackConsumed === true);

// 5. 开发者模式突发事件：目标代币不存在时不触发，但待触发标记仍被消费
await run('开发者突发事件：目标不存在 → 不触发但消费标记', 'suddenMissingToken', r =>
  r.suddenEvent === null
  && r.announcements.length === 0
  && r.pendingDevHackConsumed === true);

// 6. 随机突发事件：rollSudden 为真时恰好消费 2 次 rnd（选事件 + 选代币）
await run('随机突发事件：触发且消耗 2 次 rnd（顺序不变）', 'suddenRandom', r =>
  r.suddenEvent !== null
  && r.rndCalls === 2
  && r.announcements.length === 1
  && r.announcements[0].type === 'sudden');

// 7. 开发者模式指定代币事件：写入并返回变化标记
await run('开发者代币事件：写入 startRound + changed/consumed 标记', 'devToken', r =>
  r.devTokenEvent !== null
  && r.devTokenEvent.tokenId === 't1'
  && r.devTokenEvent.startRound === 9
  && r.devTokenEventChanged === true
  && r.pendingDevTokenEventConsumed === true);

// 8. 指定代币事件 24 回合后自动结束
await run('开发者代币事件：24 回合后自动结束', 'devTokenExpire', r =>
  r.devTokenEvent === null && r.devTokenEventChanged === true);

// 9. 非事件日不抽取每日事件（pickDaily 不会被调用）
await run('非事件日：不抽每日事件、无公告', 'notEventDay', r =>
  r.todayEvent === null && r.announcements.length === 0 && r.showEventModal === false);

// 10. 入参不可变：代币数组与事件历史在计算前后一致（全模式）
const modes = ['daily', 'expire', 'suddenDev', 'suddenRandom', 'devToken', 'devTokenExpire', 'notEventDay'];
const immutable = await page.evaluate(async ms => {
  const bad = [];
  for (const m of ms) {
    const r = window.__ROUND_EVENTS_TEST__({ mode: m });
    if (!r.immutable.tokens || !r.immutable.eventHistory) bad.push(m);
  }
  return bad;
}, modes);
if (immutable.length === 0) pass++; else fail++;
console.log(`${immutable.length === 0 ? 'PASS' : 'FAIL'} 入参不可变：7 种模式前后一致${immutable.length ? ' ' + JSON.stringify(immutable) : ''}`);

console.log(`\n[round-events] 断言 ${pass}/${pass + fail} 通过，pageErrors=${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
