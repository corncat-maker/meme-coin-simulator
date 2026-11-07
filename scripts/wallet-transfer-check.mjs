import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const url = process.env.BASE_URL || 'http://127.0.0.1:5223/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); }
function near(actual, expected, label) { check(Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-10), `${label}: ${actual} ≈ ${expected}`); }
const state = () => page.evaluate(() => window.__WALLET_TRANSFER_STATE__());
async function transfer(asset, direction, amount, code = 'UNI') {
  await page.getByRole('button', { name: direction === 'cexToWallet' ? '提币（CEX → 钱包）' : '充值（钱包 → CEX）', exact: true }).click();
  await page.locator('.wallet-side-tab').getByText(asset === 'usdt' ? 'USDT' : '代币', { exact: true }).click();
  if (asset === 'token') {
    await page.getByTestId('wallet-transfer-token').click();
    await page.getByTestId('wallet-token-picker-search').fill(code);
    await page.getByTestId(`wallet-token-option-${code}`).click();
  }
  await page.getByTestId('wallet-transfer-input').fill(String(amount));
  const count = (await state()).pendingTransfers.length;
  await page.getByTestId('wallet-transfer-confirm').click();
  await page.waitForFunction(count => window.__WALLET_TRANSFER_STATE__().pendingTransfers.length === count + 1, count);
  checks++;
}
async function advance() {
  const before = await state();
  const commits = await page.evaluate(() => window.__MARKET_COMMIT_STATS__.commits);
  await page.locator('.wallet-ff-btn').click();
  await page.waitForFunction(round => {
    const state = window.__WALLET_TRANSFER_STATE__();
    return state.currentRound === round + 1 && state.pendingTransfers.every(t => t.settleRound > state.currentRound);
  }, before.currentRound);
  await page.waitForFunction(() => !document.querySelector('.wallet-ff-btn').disabled);
  // Wait across another frame and a timer; repeated credits must not appear after pending removal.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50))));
  const after = await state();
  check(after.currentRound === before.currentRound + 1, 'next round completed');
  check((await page.evaluate(() => window.__MARKET_COMMIT_STATS__.commits)) - commits < 30, 'store commits remain bounded');
  return after;
}
try {
  await page.addInitScript(() => {
    let seed = 20261031;
    Math.random = () => { seed += 0x6D2B79F5; let n = seed; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByTestId('start-game-btn').click();
  for (const close of await page.locator('.modal-close:visible').all()) await close.click();
  await page.getByRole('button', { name: '链上钱包', exact: true }).click();
  await page.getByTestId('wallet-action-transfer').click();
  const initial = await state();
  await transfer('usdt', 'cexToWallet', 100);
  await transfer('usdt', 'cexToWallet', 50);
  near((await state()).availableCapital, initial.availableCapital - 150, 'USDT source deducted at submission');
  let current = await advance();
  near(current.walletUsdt, 150, 'two USDT transfers settle once');
  near(current.availableCapital, initial.availableCapital - 150, 'USDT source not deducted twice');
  current = await advance();
  near(current.walletUsdt, 150, 'no repeat credit next round');
  await transfer('usdt', 'walletToCex', 40);
  current = await advance();
  near(current.walletUsdt, 110, 'USDT deposit source deducted once');
  near(current.availableCapital, initial.availableCapital - 110, 'USDT deposit credited once');
  await transfer('usdt', 'walletToCex', 10);
  await transfer('usdt', 'cexToWallet', 25);
  current = await advance();
  near(current.walletUsdt, 125, 'opposite USDT transfers preserve both destinations');
  near(current.availableCapital + current.walletUsdt, initial.availableCapital, 'USDT round-trip conservation');

  await page.getByRole('button', { name: '交易平台', exact: true }).click();
  await page.getByTestId('nav-trade').click();
  await page.getByTestId('buy-btn').click();
  await page.getByRole('button', { name: '市价', exact: true }).first().click();
  await page.getByTestId('mode-quantity').click();
  await page.getByTestId('quantity-input').fill('10');
  await page.getByTestId('submit-order-btn').click();
  await page.waitForFunction(() => window.__WALLET_TRANSFER_STATE__().positions.some(p => p.quantity > 0));
  const bought = await state();
  const position = bought.positions.find(p => p.quantity > 0);
  const token = bought.tokens.find(t => t.id === position.tokenId);
  near(position.quantity, 10, 'real UI market buy creates 10 tokens');
  near(bought.playerTokenBalances[token.id].cexBalance, 10, 'buy CEX balance agrees with spot holding');
  await page.getByTestId('nav-home').click();
  await page.getByRole('button', { name: '链上钱包', exact: true }).click();
  if (await page.getByTestId('wallet-action-transfer').isVisible()) await page.getByTestId('wallet-action-transfer').click();
  const quantity = s => s.positions.find(p => p.tokenId === token.id)?.quantity || 0;
  const balance = s => s.playerTokenBalances[token.id];
  const conserved = s => { const t = s.tokens.find(t => t.id === token.id); return t.cexReserve + t.dexReserve + balance(s).walletBalance + balance(s).pendingCex; };
  const physicalBefore = conserved(bought);
  await transfer('token', 'cexToWallet', 4, token.code);
  current = await state();
  near(quantity(current), 6, 'partial withdrawal immediately reduces CEX spot holding');
  near(balance(current).cexBalance, 6, 'partial withdrawal CEX balance');
  near(balance(current).pendingWallet, 4, 'partial withdrawal is in transit');
  current = await advance();
  near(balance(current).walletBalance, 4, 'token credited to wallet');
  near(balance(current).cexBalance, 6, 'settlement preserves remaining CEX balance');
  near(balance(current).pendingWallet, 0, 'pending withdrawal cleared');
  near(conserved(current), physicalBefore, 'CEX + DEX + wallet physical conservation');
  await transfer('token', 'cexToWallet', 6, token.code);
  current = await state();
  near(quantity(current), 0, 'full withdrawal removes CEX spot position');
  current = await advance();
  near(balance(current).walletBalance, 10, 'full withdrawal preserves existing wallet coins');
  near(balance(current).cexBalance, 0, 'full withdrawal leaves zero CEX balance');
  near(conserved(current), physicalBefore, 'full withdrawal physical conservation');
  await transfer('token', 'walletToCex', 3, token.code);
  current = await advance();
  near(quantity(current), 3, 'deposit recreates deleted CEX spot position');
  near(balance(current).cexBalance, 3, 'deposit CEX balance');
  near(balance(current).walletBalance, 7, 'deposit preserves wallet remainder');
  near(balance(current).pendingCex, 0, 'pending deposit cleared');
  await transfer('token', 'walletToCex', 2, token.code);
  await transfer('token', 'walletToCex', 5, token.code);
  current = await advance();
  near(quantity(current), 10, 'multiple same-token deposits add to existing position');
  near(balance(current).cexBalance, 10, 'multiple deposits CEX balance');
  near(balance(current).walletBalance, 0, 'full deposit removes wallet coins');
  near(conserved(current), physicalBefore, 'token round-trip physical conservation');
  for (let i = 0; i < 3; i++) current = await advance();
  near(quantity(current), 10, 'three additional rounds do not repeat deposit');
  near(balance(current).cexBalance, 10, 'CEX quantity stays consistent after additional rounds');
  near(balance(current).walletBalance, 0, 'no repeated wallet credit');
  check(errors.length === 0, `pageErrors=0 ${JSON.stringify(errors)}`);
  console.log(`[wallet-transfer] ${checks}/${checks} passed, round=${current.currentRound}, real UI transactions only`);
} finally { await browser.close(); }