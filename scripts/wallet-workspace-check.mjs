import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const target = process.argv[2];
const offline = !!target && !/^https?:/.test(target);
const url = offline ? pathToFileURL(path.resolve(target)).href : target || 'http://127.0.0.1:5223/';
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, offline });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', req => { if (offline && /^https?:/.test(req.url())) requests.push(req.url()); });
let count = 0;
const check = (condition, label) => { assert.ok(condition, label); count++; console.log(`PASS ${label}`); };
const near = (a, b, label) => check(Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9), `${label}: ${a} ≈ ${b}`);
// Read component props only; all balances and LP positions come from real UI operations.
const state = () => page.evaluate(() => {
  const node = document.querySelector('[data-testid="wallet-view"]');
  let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
  while (fiber) {
    const p = fiber.memoizedProps;
    if (p?.getWalletAvailableToken && p?.balances && p?.walletLpPositions) return {
      wallet: p.walletUsdt, round: p.currentRound, balances: p.balances,
      pools: p.liquidityPools, lp: p.walletLpPositions, tokens: p.tokens, pending: p.pendingTransfers,
      available: Object.fromEntries(p.tokens.map(t => [t.id, p.getWalletAvailableToken(t.id)])),
    };
    fiber = fiber.return;
  }
  throw new Error('Wallet props not found');
});
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50))));
async function advance() {
  const before = await state();
  await page.locator('.wallet-ff-btn').click();
  await page.waitForFunction(() => !document.querySelector('.wallet-ff-btn').disabled);
  await frame();
  const after = await state();
  check(after.round === before.round + 1, 'round completes after wallet operations');
  return after;
}
async function pick(testId, code) {
  await page.getByTestId(testId).click();
  await page.getByTestId('wallet-token-picker-search').fill(code);
  await page.getByTestId(`wallet-token-option-${code}`).click();
}
async function layout(label) {
  const result = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="wallet-view"]');
    const bad = [...root.querySelectorAll('button,input,output')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
    }).map(el => ({ id: el.dataset.testid, text: el.textContent.slice(0, 20) }));
    return { bad, overflow: root.scrollWidth - root.clientWidth };
  });
  check(result.bad.length === 0 && result.overflow <= 1, `${label} no horizontal overflow ${JSON.stringify(result)}`);
}
const snap = s => JSON.stringify({ wallet: s.wallet, balances: s.balances, lp: s.lp, pools: s.pools });
try {
  await page.addInitScript(() => {
    let seed = 20261031;
    Math.random = () => { seed += 0x6D2B79F5; let n = seed; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  });
  await page.goto(url, { waitUntil: offline ? 'load' : 'networkidle' });
  await page.getByTestId('start-game-btn').click();
  for (const close of await page.locator('.modal-close:visible').all()) await close.click();
  await page.getByTestId('system-tab-wallet').click();
  await page.getByTestId('wallet-action-swap').click();
  check(await page.getByTestId('wallet-swap-confirm').isDisabled(), 'empty/unfunded swap cannot submit');
  await page.getByTestId('wallet-swap-input').fill('-1');
  check(await page.getByTestId('wallet-swap-confirm').isDisabled(), 'negative amount cannot submit');
  await layout('unfunded swap');
  await page.getByTestId('wallet-back-btn').click();
  await page.getByTestId('wallet-action-transfer').click();
  await page.getByTestId('wallet-transfer-input').fill('10000');
  await page.getByTestId('wallet-transfer-confirm').click();
  check((await state()).pending.length === 1, 'funded through real USDT withdrawal');
  let st = await advance();
  near(st.wallet, 10000, 'USDT credited once');
  await page.getByTestId('wallet-back-btn').click();
  await page.getByTestId('wallet-action-swap').click();
  await pick('wallet-swap-token', 'UNI');
  st = await state();
  const token = st.tokens.find(t => t.code === 'UNI'), id = token.id;
  let pool = st.pools[id];
  const quantity = s => s.balances[id]?.walletBalance || 0;
  const conserved = s => s.tokens.find(t => t.id === id).cexReserve + s.pools[id].tokenReserve + quantity(s);
  const physical = conserved(st);
  await page.getByTestId('wallet-swap-preset-25').click();
  near(Number(await page.getByTestId('wallet-swap-input').inputValue()), 2500, '25% uses wallet input balance');
  await page.getByTestId('wallet-swap-input').fill('1000');
  let expectedOut = 1000 * pool.tokenReserve / (pool.quoteReserve * (1 + pool.fee) + 1000);
  const outText = (await page.getByTestId('wallet-swap-output').innerText()).replace(/,/g, '');
  near(Number(outText), expectedOut, 'buy receive preview matches existing settlement formula');
  await page.getByTestId('wallet-swap-confirm').click();
  await frame();
  let after = await state();
  near(after.wallet, st.wallet - 1000, 'buy pays exact wallet USDT');
  near(quantity(after) - quantity(st), expectedOut, 'buy credits previewed token amount');
  near(conserved(after), physical, 'buy physical token conservation');
  check((await page.getByTestId('wallet-operation-receipt').innerText()).includes('兑换成功'), 'success receipt stays visible');
  check(await page.getByTestId('wallet-swap-input').inputValue() === '', 'success clears spend field');

  await page.getByTestId('wallet-swap-input').fill('77');
  await page.getByTestId('wallet-swap-reverse').click();
  check(await page.getByTestId('wallet-swap-input').inputValue() === '', 'reverse clears old unit amount');
  await page.getByTestId('wallet-swap-preset-25').click();
  st = await state(); pool = st.pools[id];
  const sellAmount = Number(await page.getByTestId('wallet-swap-input').inputValue());
  near(sellAmount, st.available[id] / 4, 'sell percent uses available token balance');
  const sellQuote = pool.quoteReserve * sellAmount / (pool.tokenReserve + sellAmount) * (1 - pool.fee);
  await page.getByTestId('wallet-swap-confirm').click(); await frame(); after = await state();
  near(after.wallet, st.wallet + sellQuote, 'sell receives net AMM USDT');
  near(quantity(after), quantity(st) - sellAmount, 'sell consumes exact token amount');
  near(conserved(after), physical, 'sell physical token conservation');

  await page.getByTestId('wallet-swap-input').fill('1');
  await pick('wallet-swap-token', 'BTC');
  check(await page.getByTestId('wallet-swap-input').inputValue() === '', 'token change clears stale amount');
  await pick('wallet-swap-token', 'UNI');
  await page.getByTestId('wallet-back-btn').click();
  await page.getByTestId('wallet-action-liquidity').click();
  await pick('wallet-liquidity-token', 'UNI');
  st = await state(); pool = st.pools[id];
  const rate = pool.tokenReserve / pool.quoteReserve;
  await page.getByTestId('wallet-liquidity-input').fill('100');
  near(Number(await page.getByTestId('wallet-liquidity-token-input').inputValue()), 100 * rate, 'USDT input auto-pairs token');
  await page.getByTestId('wallet-liquidity-token-input').fill('1.');
  check(await page.getByTestId('wallet-liquidity-token-input').inputValue() === '1.', 'token decimal remains editable');
  await page.getByTestId('wallet-liquidity-token-input').fill('2');
  near(Number(await page.getByTestId('wallet-liquidity-input').inputValue()), 2 / rate, 'token input auto-pairs USDT');
  await page.getByTestId('wallet-liquidity-input').fill(String(st.wallet + 1));
  check(await page.getByTestId('wallet-liquidity-add').isDisabled(), 'insufficient paired balance blocks add');
  await page.getByTestId('wallet-liquidity-preset-100').click();
  let max = Number(await page.getByTestId('wallet-liquidity-input').inputValue());
  near(max, Math.min(st.wallet, st.available[id] / rate), 'MAX uses smaller of two spendable assets');
  check(await page.getByTestId('wallet-liquidity-add').isEnabled(), 'MAX remains valid without rounding over balance');
  await layout('add liquidity');
  await page.getByTestId('wallet-liquidity-input').fill('100');
  const beforeAdd = await state();
  await page.getByTestId('wallet-liquidity-add').click(); await frame(); after = await state();
  near(after.wallet, beforeAdd.wallet - 100, 'add debits paired USDT');
  near(quantity(after), quantity(beforeAdd) - 100 * rate, 'add debits paired tokens');
  near(after.lp[id].quoteAmount, 100, 'LP position records USDT');
  near(after.lp[id].tokenAmount, 100 * rate, 'LP position records tokens');
  near(conserved(after), physical, 'adding liquidity physical conservation');
  check(await page.getByTestId('wallet-my-pool-UNI').isVisible(), 'my pools shortcut appears');

  await page.getByTestId('wallet-liquidity-tab-remove').click();
  st = await state();
  const beforeSelect = snap(st);
  for (const percent of [25, 50, 75, 100]) {
    await page.getByTestId(`wallet-remove-${percent}`).click();
    near(Number((await page.getByTestId('wallet-remove-usdt-output').innerText()).replace(/,/g, '')), st.lp[id].quoteAmount * percent / 100, `remove ${percent}% preview`);
  }
  check(snap(await state()) === beforeSelect, 'percentage buttons never execute withdrawal');
  await page.getByTestId('wallet-remove-25').click();
  const lpBefore = st.lp[id];
  await page.getByTestId('wallet-liquidity-remove-confirm').click(); await frame(); after = await state();
  near(after.wallet, st.wallet + lpBefore.quoteAmount / 4, 'confirmed 25% returns USDT');
  near(quantity(after), quantity(st) + lpBefore.tokenAmount / 4, 'confirmed 25% returns tokens');
  near(after.lp[id].shares, lpBefore.shares * .75, 'partial removal retains correct shares');
  await page.getByTestId('wallet-remove-100').click();
  await page.getByTestId('wallet-liquidity-remove-confirm').click(); await frame(); after = await state();
  check(!after.lp[id], 'full removal deletes LP position');
  near(after.wallet, beforeAdd.wallet, 'all LP USDT returned');
  near(quantity(after), quantity(beforeAdd), 'all LP tokens returned');
  near(conserved(after), physical, 'LP round trip physical conservation');
  check(await page.getByTestId('wallet-liquidity-remove-confirm').count() === 0, 'empty LP cannot be removed again');
  check((await page.locator('.wallet-pool-empty').innerText()).includes('还没有'), 'empty position guides next action');

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByTestId('wallet-liquidity-tab-add').click();
    await layout(`add ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('wallet-back-btn').click(); await page.getByTestId('wallet-action-swap').click();
  await page.getByRole('button', { name: '买入代币', exact: true }).click();
  await page.getByTestId('wallet-swap-input').fill('25');
  for (const width of [320, 390]) { await page.setViewportSize({ width, height: 844 }); await layout(`swap ${width}px`); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `/tmp/wallet-ux-${offline ? 'offline' : 'dev'}-swap.png`, fullPage: true });
  for (let n = 0; n < 3; n++) await advance();
  check(errors.length === 0, `pageErrors=0 ${JSON.stringify(errors)}`);
  check(requests.length === 0, 'offline external requests=0');
  console.log(`[wallet-workspace] ${count}/${count} passed ${offline ? 'production file offline' : 'dev'}; real UI only`);
} finally { await browser.close(); }