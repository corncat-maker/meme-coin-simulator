import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const file = path.resolve(process.argv[2] || 'standalone/Meme币庄家模拟器-提币结算修复-20261107.html');
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
const near = (actual, expected, label) => check(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} ≈ ${expected}`);
// Production has no DEV hooks. Read existing wallet component props only; do not inject balances or invoke transaction handlers.
async function state() {
  return page.evaluate(() => {
    const node = document.querySelector('[data-testid="wallet-view"]');
    const key = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    let fiber = node[key];
    while (fiber.return) fiber = fiber.return;
    // DOM handles can retain an alternate Fiber. Read only the committed tree.
    const stack = [fiber.stateNode.current];
    while (stack.length) {
      const current = stack.pop();
      const props = current.memoizedProps;
      if (props?.getCexTokenAvailable && props?.pendingTransfers && props?.balances) {
        return { currentRound: props.currentRound, cash: props.cexUsdtAvailable, wallet: props.walletUsdt,
          pending: props.pendingTransfers, balances: props.balances, tokens: props.tokens,
          positions: Object.fromEntries(props.tokens.map(token => [token.id, props.getCexTokenAvailable(token.id)])) };
      }
      if (current.sibling) stack.push(current.sibling);
      if (current.child) stack.push(current.child);
    }
    throw new Error('Read-only committed wallet props could not be found');
  });
}
async function advance() {
  const before = await state();
  await page.locator('.wallet-ff-btn').click();
  await page.waitForFunction(() => !document.querySelector('.wallet-ff-btn').disabled && !document.querySelector('.wallet-pending-card'), null, { timeout: 12000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 100))));
  for (let n = 0; n < 4; n++) {
    const close = page.locator('.modal-overlay .modal-close:visible').first();
    if (await close.count() === 0) break;
    const title = await close.locator('..').innerText();
    console.log('CLOSE_ROUND_NOTICE', title);
    await close.click();
  }
  const after = await state();
  check(after.currentRound === before.currentRound + 1, 'offline round completed');
  if (after.pending.length !== 0) {
    const diagnosis = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="wallet-view"]');
      let fiber = node[Object.keys(node).find(k => k.startsWith('__reactFiber$'))];
      while (fiber.return) fiber = fiber.return;
      const root = fiber.stateNode.current;
      let current = null;
      const visit = f => {
        if (!f || current) return;
        const p = f.memoizedProps;
        if (p?.getCexTokenAvailable && p?.pendingTransfers && p?.balances) {
          current = { round: p.currentRound, pending: p.pendingTransfers, wallet: p.walletUsdt, balances: p.balances };
          return;
        }
        visit(f.child); visit(f.sibling);
      };
      visit(root);
      return { current, pendingText: document.querySelector('.wallet-pending-card')?.textContent || null, roundText: document.querySelector('.wallet-ff-btn')?.textContent };
    });
    console.log('PENDING_DIAG', JSON.stringify({ readRound: after.currentRound, readPending: after.pending, ...diagnosis }));
  }
  check(after.pending.length === 0, 'offline pending removed');
  return after;
}
async function submit(amount) {
  await page.getByTestId('wallet-transfer-input').fill(String(amount));
  await page.getByTestId('wallet-transfer-confirm').click();
  check((await state()).pending.length > 0, 'real UI transfer submitted');
}
try {
  if (process.env.TEST_SEED) {
    await page.addInitScript(initial => {
      let seed = initial;
      Math.random = () => { seed += 0x6D2B79F5; let n = seed; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
    }, Number(process.env.TEST_SEED));
  }
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.getByTestId('start-game-btn').click();
  for (const close of await page.locator('.modal-close:visible').all()) await close.click();
  check(!(await page.locator('body').innerText()).includes('下载项目交接文档'), 'initial document download remains removed');
  await page.getByTestId('system-tab-wallet').click();
  await page.getByTestId('wallet-action-transfer').click();
  const initial = await state();
  await submit(100);
  let after = await advance();
  near(after.cash, initial.cash - 100, 'offline USDT source deducted once');
  near(after.wallet, 100, 'offline USDT arrived once');
  after = await advance();
  near(after.wallet, 100, 'offline no repeated credit');
  await page.getByRole('button', { name: '充值（钱包 → CEX）', exact: true }).click();
  await submit(40);
  after = await advance();
  near(after.cash, initial.cash - 60, 'offline deposit credited once');
  near(after.wallet, 60, 'offline deposit wallet remainder');

  await page.getByTestId('system-tab-cex').click();
  await page.getByTestId('nav-trade').click();
  await page.getByTestId('buy-btn').click();
  await page.getByRole('button', { name: '市价', exact: true }).first().click();
  await page.getByTestId('mode-quantity').click();
  await page.getByTestId('quantity-input').fill('10');
  await page.getByTestId('submit-order-btn').click();
  await page.getByTestId('nav-home').click();
  await page.getByTestId('system-tab-wallet').click();
  await page.getByTestId('wallet-action-transfer').click();
  await page.getByRole('button', { name: '提币（CEX → 钱包）', exact: true }).click();
  await page.locator('.wallet-side-tab').getByText('代币', { exact: true }).click();
  after = await state();
  const token = after.tokens.find(token => after.positions[token.id] > 0);
  check(!!token, 'offline real market buy created spot position');
  const tokenId = token.id;
  await page.getByTestId('wallet-transfer-token').click();
  await page.getByTestId('wallet-token-picker-search').fill(token.code);
  await page.getByTestId(`wallet-token-option-${token.code}`).click();
  const physical = s => { const t=s.tokens.find(t=>t.id===tokenId),b=s.balances[tokenId];return t.cexReserve+t.dexReserve+b.walletBalance+b.pendingCex; };
  const supplyBefore = physical(after);
  await submit(4);
  near((await state()).positions[tokenId], 6, 'offline partial withdrawal spot deduction');
  after = await advance();
  near(after.balances[tokenId].walletBalance, 4, 'offline partial token arrived');
  near(after.balances[tokenId].cexBalance, 6, 'offline remaining CEX balance retained');
  await submit(6);
  near((await state()).positions[tokenId], 0, 'offline full withdrawal removes spot holding');
  after = await advance();
  near(after.balances[tokenId].walletBalance, 10, 'offline full token arrived without wiping balance');
  near(physical(after), supplyBefore, 'offline physical inventory conservation');
  await page.getByRole('button', { name: '充值（钱包 → CEX）', exact: true }).click();
  await submit(10);
  after = await advance();
  near(after.positions[tokenId], 10, 'offline deposit restores spot position');
  near(after.balances[tokenId].cexBalance, 10, 'offline deposit restores CEX balance');
  near(after.balances[tokenId].walletBalance, 0, 'offline deposited tokens leave wallet');
  for (let n=0;n<3;n++) after=await advance();
  near(after.positions[tokenId], 10, 'offline three extra rounds no duplicate position');
  check(errors.length===0, `pageErrors=0 ${JSON.stringify(errors)}`);
  check(requests.length===0, `external network requests=0 ${JSON.stringify(requests)}`);
  await page.screenshot({ path: '/tmp/wallet-repair-offline-final.png' });
  console.log(`[wallet-offline] ${checks}/${checks} passed, rounds=${after.currentRound}, file=${file}`);
} finally { await browser.close(); }