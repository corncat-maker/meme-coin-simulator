#!/usr/bin/env node
/**
 * regression-capture.mjs — 确定性端到端回归 capture（用于 src/App.tsx 拆分前的基线护栏）
 *
 * 用法（在项目根目录执行）：
 *   node scripts/regression-capture.mjs --out tests/baseline
 *   node scripts/regression-capture.mjs --out tests/tmp
 *   node scripts/regression-capture.mjs --out tests/tmp --url http://127.0.0.1:5181/
 *
 * 参数：
 *   --out <dir>      必填，输出目录（写 seeded-snapshot.json + 截图 PNG）
 *   --url <url>      可选，复用已运行的 dev server（例如 Lead 先起好的 5181）；省略则脚本自己
 *                    启动 `npm run dev -- --host 127.0.0.1 --port 5181 --strictPort` 并在结束时清理
 *   --rounds <n>     快进回合数，默认 6
 *   --port <n>       自起 dev server 端口，默认 5181
 *   --timeout <ms>   页面加载超时，默认 240000（33k 行 App.tsx 首次编译较慢）
 *   --seed <n>       随机种子，默认 20261031
 *
 * 确定性策略：
 *   - addInitScript 注入 mulberry32(seed) 替换 Math.random，Date.now / new Date() 固定 1700000000000
 *   - localStorage 每次加载前清空并固定 theme-mode=dark（游戏存档在 IndexedDB，浏览器每次全新 profile）
 *   - viewport 390x844 / DPR 2 / mobile UA / Asia-Shanghai 时区
 *   - 截图关闭 CSS 动画（animations: 'disabled'）
 *
 * 输出 seeded-snapshot.json 的字段分两类：
 *   - 稳定字段（回归比较用）：rounds / tabs / interactions / assertions / errors / app.sha256 ...
 *   - 易变字段（regression-compare.mjs 忽略）：capturedAt / durationMs / baseUrl / git / screenshots
 *
 * 退出码：0 = capture 完成且全部断言通过；1 = 出错或断言失败（仍会尽力写出 JSON 供排查）。
 */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

const SEED = 20261031;
const FIXED_NOW = 1700000000000;
const DEFAULT_ROUNDS = 6;
const DEFAULT_PORT = 5181;
const DEFAULT_LOAD_TIMEOUT = 240000;
const EXPECTED_APP_SHA_PREFIX = '910ead26';

const SNAPSHOT_FILE = 'seeded-snapshot.json';
const TABS = ['home', 'market', 'trade', 'futures', 'assets'];
const VIEW_SELECTOR_BY_TAB = {
  home: '.home-view',
  market: '.market-view',
  trade: '.trade-view',
  futures: '.futures-view',
  assets: '.assets-page',
};
const NAV_LABELS_EXPECTED = ['首页', '行情', '交易', '合约', '资产'];

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// ---------- 小工具 ----------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[capture]', ...a);
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

function parseArgs(argv) {
  const out = { out: null, url: null, rounds: DEFAULT_ROUNDS, port: DEFAULT_PORT, timeout: DEFAULT_LOAD_TIMEOUT, seed: SEED };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw usageError(`参数 ${a} 缺少值`);
      return v;
    };
    if (a === '--out') out.out = next();
    else if (a === '--url') out.url = next();
    else if (a === '--rounds') out.rounds = Number(next());
    else if (a === '--port') out.port = Number(next());
    else if (a === '--timeout') out.timeout = Number(next());
    else if (a === '--seed') out.seed = Number(next());
    else if (a === '-h' || a === '--help') out.help = true;
    else throw usageError(`未知参数：${a}`);
  }
  if (!out.help) {
    if (!out.out) throw usageError('缺少必填参数 --out <dir>');
    if (!Number.isInteger(out.rounds) || out.rounds < 1) throw usageError('--rounds 必须是 >=1 的整数');
    if (!Number.isInteger(out.port) || out.port < 1) throw usageError('--port 必须是合法端口');
    if (!Number.isInteger(out.seed)) throw usageError('--seed 必须是整数');
  }
  return out;
}

function usageError(msg) {
  const e = new Error(msg);
  e.code = 'USAGE';
  return e;
}

function printHelp() {
  console.log(`用法: node scripts/regression-capture.mjs --out <dir> [--url <url>] [--rounds 6] [--port 5181] [--timeout 240000] [--seed 20261031]`);
}

function sha256File(file) {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function findChromiumExecutable() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  const candidates = [];
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache)) {
      if (!dir.startsWith('chromium-')) continue;
      const base = path.join(cache, dir);
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
        const p = path.join(base, rel);
        if (fs.existsSync(p)) candidates.push({ dir, p });
      }
    }
  }
  candidates.sort((a, b) => a.dir.localeCompare(b.dir, undefined, { numeric: true }));
  candidates.reverse();
  const preferred = candidates.find((c) => c.dir.includes('1248')) || candidates[0];
  return preferred ? preferred.p : null;
}

function gitInfo() {
  try {
    const run = (args) => execFileSync('git', args, { cwd: PROJECT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = run(['status', '--porcelain']);
    return {
      head: run(['rev-parse', 'HEAD']),
      subject: run(['log', '-1', '--pretty=%s']),
      dirty: status.length > 0,
      dirtyFiles: status.split('\n').filter(Boolean).slice(0, 20),
    };
  } catch (e) {
    return { error: norm(String(e.message || e)).slice(0, 200) };
  }
}

// ---------- 自起 dev server ----------
function startDevServer(port) {
  const chunks = [];
  const append = (b) => {
    chunks.push(String(b));
    if (chunks.length > 400) chunks.splice(0, chunks.length - 400);
  };
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: PROJECT_DIR,
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  );
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', append);
  const getLogs = () => chunks.join('').slice(-8000);
  return { child, port, getLogs };
}

async function stopServer(server) {
  if (!server || !server.child) return;
  const child = server.child;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    } else {
      child.kill('SIGTERM');
    }
    await Promise.race([new Promise((r) => child.once('exit', r)), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else {
        child.kill('SIGKILL');
      }
    }
  } catch {
    /* 清理尽力而为 */
  }
}

function httpProbe(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let req;
    try {
      req = http.get(url, (res) => {
        res.resume();
        done(!!res.statusCode && res.statusCode >= 200 && res.statusCode < 500);
      });
    } catch {
      done(false);
      return;
    }
    req.on('error', () => done(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      done(false);
    });
  });
}

async function waitForDevServer(server, url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(`dev server 提前退出（code=${server.child.exitCode}）。最近日志：\n${server.getLogs()}`);
    }
    if (await httpProbe(url)) return;
    await delay(500);
  }
  throw new Error(`等待 dev server 超时（${timeoutMs}ms）：${url}\n最近日志：\n${server.getLogs()}`);
}

// ---------- 浏览器 ----------
async function launchBrowser() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
    '--hide-scrollbars',
    '--mute-audio',
  ];
  const exe = findChromiumExecutable();
  const attempts = [];
  if (exe) attempts.push({ label: `explicit:${exe}`, opts: { executablePath: exe, args } });
  attempts.push({ label: 'playwright-default', opts: { args } });
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, ...attempt.opts });
      log(`chromium 启动成功（${attempt.label}）`);
      return { browser, executable: attempt.label };
    } catch (e) {
      lastErr = e;
      log(`chromium 启动失败（${attempt.label}）：${norm(String(e.message || e)).slice(0, 300)}`);
    }
  }
  const hint = lastErr ? `\n最后一个错误：\n${String(lastErr.stack || lastErr.message || lastErr).slice(0, 3000)}` : '';
  throw new Error(`无法启动 Chromium（playwright-core 找不到可用浏览器，且显式扫描 ~/.cache/ms-playwright 也失败）。${hint}`);
}

async function newPage(browser, initPayload) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'dark',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(initPayload.loadTimeout);

  const errors = { pageErrors: [], consoleErrors: [], consoleErrorPrefixed: [], consoleErrorReal: [], consoleErrorBenign: [], consoleWarnings: [], dialogs: [], requestFailures: [] };
  // main.tsx 会把 console.error 重写成 console.log('[console.error]', ...)，
  // 因此 React dev 模式告警（Warning: ...）也会带此前缀。区分“真实错误”与“已知无害告警”，
  // 只有真实错误会导致断言失败；两者都写进 JSON，便于对比时发现告警集变化。
  const BENIGN_CONSOLE_ERROR = /^\[console\.error\]\s*(Warning:|The above error occurred|React does not recognize)/;
  page.on('pageerror', (err) => {
    errors.pageErrors.push({ message: norm(String(err && err.message ? err.message : err)).slice(0, 1000), stack: norm(String((err && err.stack) || '')).slice(0, 3000) });
  });
  page.on('console', (msg) => {
    const type = msg.type();
    let text = '';
    try { text = norm(msg.text()); } catch { text = ''; }
    if (text.startsWith('[console.error]') || type === 'error') {
      const entry = { type, text: text.slice(0, 2000) };
      errors.consoleErrors.push(entry);
      if (text.startsWith('[console.error]')) {
        errors.consoleErrorPrefixed.push(entry);
        if (BENIGN_CONSOLE_ERROR.test(text)) errors.consoleErrorBenign.push(entry);
        else errors.consoleErrorReal.push(entry);
      }
    } else if (text.startsWith('[console.warn]') || type === 'warning') {
      if (errors.consoleWarnings.length < 40) errors.consoleWarnings.push({ type, text: text.slice(0, 2000) });
    }
  });
  page.on('dialog', async (d) => {
    errors.dialogs.push({ type: d.type(), message: norm(d.message()).slice(0, 500) });
    try { await d.dismiss(); } catch { /* ignore */ }
  });
  page.on('requestfailed', (req) => {
    if (errors.requestFailures.length < 40) {
      const failure = req.failure && req.failure();
      errors.requestFailures.push({ url: String(req.url()).slice(0, 300), reason: norm(String((failure && failure.errorText) || '')).slice(0, 300) });
    }
  });

  await page.addInitScript(
    (payload) => {
      // 1) 确定性随机数：mulberry32(seed)
      let state = payload.seed >>> 0;
      Math.random = function deterministicRandom() {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      // 2) 冻结时钟
      const RealDate = Date;
      class FixedDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(payload.fixedNow);
          else super(...args);
        }
        static now() {
          return payload.fixedNow;
        }
      }
      window.Date = FixedDate;
      // 3) 干净、固定的 localStorage（游戏存档在 IndexedDB，浏览器每次全新 profile）
      try {
        window.localStorage.clear();
        window.localStorage.setItem('theme-mode', 'dark');
      } catch {
        /* ignore */
      }
      window.__dsrCapture = { seed: payload.seed, fixedNow: payload.fixedNow, applied: true };
    },
    initPayload,
  );

  return { context, page, errors };
}

// ---------- 页面交互小工具 ----------
async function evaluate(page, fn, arg) {
  return page.evaluate(fn, arg);
}

async function isVisible(page, selector) {
  return evaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }, selector);
}

async function textOf(page, selector) {
  return evaluate(page, (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
  }, selector);
}

async function clickDom(page, selector) {
  const ok = await evaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!ok) throw new Error(`找不到可点击元素：${selector}`);
}

async function clickWithFallback(page, selector, label) {
  try {
    await page.locator(selector).first().click({ timeout: 5000 });
    return 'mouse';
  } catch (e) {
    log(`真实点击失败（${label || selector}）：${norm(String(e.message || e)).slice(0, 200)}，改用 DOM click`);
    await clickDom(page, selector);
    return 'dom';
  }
}

async function waitForRoundTimeChange(page, previousText, timeout) {
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('.top-info-bar .round-time') || document.querySelector('.round-time');
      if (!el) return false;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return txt.length > 0 && txt !== prev;
    },
    previousText,
    { timeout, polling: 100 },
  );
}

async function waitForFastForwardEnabled(page, timeout) {
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="fast-forward-btn"]');
      return !!btn && !btn.disabled;
    },
    null,
    { timeout, polling: 100 },
  );
}

async function waitForTabActive(page, tab, timeout = 30000) {
  const view = VIEW_SELECTOR_BY_TAB[tab];
  await page.waitForFunction(
    ([t, viewSel]) => {
      const nav = document.querySelector(`[data-testid="nav-${t}"]`);
      const navActive = !!nav && nav.classList.contains('active');
      const viewEl = document.querySelector(viewSel);
      const viewVisible = !!viewEl && viewEl.getClientRects().length > 0;
      return navActive && viewVisible;
    },
    [tab, view],
    { timeout, polling: 100 },
  );
}

async function switchTab(page, tab) {
  const navSelector = `[data-testid="nav-${tab}"]`;
  // 如果 K 线全屏还开着（底部导航被隐藏），先返回
  if (!(await isVisible(page, navSelector))) {
    if (await isVisible(page, '.token-detail-page .td-back-btn')) {
      await clickDom(page, '.token-detail-page .td-back-btn');
      await page.waitForTimeout(250);
    }
  }
  await clickDom(page, navSelector);
  await waitForTabActive(page, tab, 30000);
  await settle(page);
}

async function settle(page, ms = 350) {
  await page.waitForTimeout(ms);
  await evaluate(page, () => new Promise((resolve) => {
    const raf = window.requestAnimationFrame;
    if (typeof raf !== 'function') { resolve(); return; }
    raf(() => raf(() => resolve()));
  })).catch(() => {});
  await page.waitForTimeout(50);
}

// ---------- 已知弹窗关闭 ----------
const MODAL_CLOSERS = [
  { name: 'hot-sector', selector: '.hot-sector-modal .modal-close' },
  { name: 'event', selector: '[data-testid="event-modal-close"]' },
  { name: 'sudden-event', selector: '[data-testid="sudden-event-modal-close"]' },
  { name: 'delist-notice', selector: '[data-testid="delist-notice-modal-close"]' },
];

async function closeKnownModals(page) {
  const closed = [];
  for (let pass = 0; pass < 3; pass++) {
    let acted = false;
    for (const modal of MODAL_CLOSERS) {
      if (!(await isVisible(page, modal.selector))) continue;
      const title = await evaluate(page, (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const root = el.closest('.modal-content, .modal-overlay, .event-modal, .sudden-event-modal, [class*="modal"]');
        return root ? (root.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null;
      }, modal.selector);
      try {
        await clickDom(page, modal.selector);
        await page.waitForTimeout(150);
        closed.push({ name: modal.name, title });
        acted = true;
      } catch (e) {
        closed.push({ name: modal.name, title, error: norm(String(e.message || e)).slice(0, 200) });
      }
    }
    if (!acted) break;
  }
  const remaining = await evaluate(page, () => {
    const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    return Array.from(document.querySelectorAll('.modal-overlay, .modal-mask, .modal-content'))
      .filter((el) => visible(el) && !el.closest('.kline-page'))
      .map((el) => `${el.className || ''} | ${(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`)
      .slice(0, 10);
  });
  return { closed, remaining };
}

// ---------- 文本快照 ----------
async function captureInitScreen(page) {
  return evaluate(page, () => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? norm(el.textContent) : null;
    };
    return {
      title: text('.init-title'),
      tabs: Array.from(document.querySelectorAll('.init-view-tabs button, .init-view-tabs [role="tab"]')).map((el) => norm(el.textContent)),
      contentText: (text('.init-content') || '').slice(0, 500),
      hasStartButton: !!document.querySelector('[data-testid="start-game-btn"]'),
      defaultCapitalTier: text('[data-testid="capital-tier-5m"]'),
    };
  });
}

async function captureHomeState(page) {
  return evaluate(page, () => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? norm(el.textContent) : null;
    };
    const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const detail = Array.from(document.querySelectorAll('.total-asset-detail .detail-item')).map((item) => ({
      label: norm(item.querySelector('.detail-label') ? item.querySelector('.detail-label').textContent : ''),
      value: norm(item.querySelector('.detail-value') ? item.querySelector('.detail-value').textContent : ''),
    }));
    const ff = document.querySelector('[data-testid="fast-forward-btn"]');
    const activeNav = document.querySelector('.bottom-nav .nav-tab.active .nav-label') || document.querySelector('.bottom-nav .nav-tab.active');
    const marketTab = document.querySelector('.market-tab.home-market-tab-active');
    const visibleList = Array.from(document.querySelectorAll('.market-component .market-list')).find((el) => visible(el));
    const rows = visibleList
      ? Array.from(visibleList.querySelectorAll('.market-list-row')).slice(0, 5).map((row) => ({
          name: norm(row.querySelector('.list-col-name') ? row.querySelector('.list-col-name').textContent : ''),
          price: norm(row.querySelector('.list-col-price') ? row.querySelector('.list-col-price').textContent : ''),
          change: norm(row.querySelector('.list-col-change') ? row.querySelector('.list-col-change').textContent : ''),
        }))
      : [];
    return {
      roundTime: text('.top-info-bar .round-time') || text('.round-time'),
      totalAsset: text('.total-asset-value'),
      assetDetail: detail,
      eventBanner: text('[data-testid="event-banner"]'),
      fastForward: { disabled: !!ff && ff.disabled, label: ff ? norm(ff.textContent) : null },
      activeNav: activeNav ? norm(activeNav.textContent) : null,
      homeMarketTab: marketTab ? norm(marketTab.textContent) : null,
      homeMarketRows: rows,
    };
  });
}

async function captureNavLabels(page) {
  return evaluate(page, () =>
    Array.from(document.querySelectorAll('.bottom-nav .nav-tab .nav-label')).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()),
  );
}

async function captureMarketTab(page) {
  return evaluate(page, () => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? norm(el.textContent) : null;
    };
    return {
      roundTime: text('.market-view .round-time') || text('.top-info-bar .round-time'),
      searchPlaceholder: (() => {
        const el = document.querySelector('.market-search-input');
        return el ? el.getAttribute('placeholder') : null;
      })(),
      sectorTabs: Array.from(document.querySelectorAll('.market-view .sector-tab')).slice(0, 12).map((el) => ({
        text: norm(el.textContent),
        active: el.classList.contains('active'),
      })),
      listHeader: text('.market-view .market-token-list-header'),
      rows: Array.from(document.querySelectorAll('.market-view .market-token-row')).slice(0, 8).map((row) => ({
        code: norm(row.querySelector('.market-token-code') ? row.querySelector('.market-token-code').textContent : ''),
        price: norm(row.querySelector('.market-token-price') ? row.querySelector('.market-token-price').textContent : ''),
        change: norm(row.querySelector('.market-token-change') ? row.querySelector('.market-token-change').textContent : ''),
        marketCap: norm(row.querySelector('.market-token-cap') ? row.querySelector('.market-token-cap').textContent : ''),
        volume: norm(row.querySelector('.market-token-volume') ? row.querySelector('.market-token-volume').textContent : ''),
      })),
    };
  });
}

async function captureTradeTab(page) {
  return evaluate(page, () => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? norm(el.textContent) : null;
    };
    const rows = (sel) =>
      Array.from(document.querySelectorAll(sel)).slice(0, 5).map((row) => ({
        price: norm(row.querySelector('.price') ? row.querySelector('.price').textContent : ''),
        qty: norm(row.querySelector('.qty') ? row.querySelector('.qty').textContent : ''),
      }));
    return {
      roundTime: text('.trade-view .round-time') || text('.top-info-bar .round-time'),
      pairName: text('.trade-view .token-pair-name'),
      sideTabs: Array.from(document.querySelectorAll('.trade-view .coin-side-tabs .side-tab, .trade-view .trade-side-tabs .side-tab')).slice(0, 2).map((el) => ({
        text: norm(el.textContent),
        active: el.classList.contains('active'),
      })),
      orderbookModeLabel: text('.trade-view .orderbook-mode-label'),
      asks: rows('.trade-orderbook-panel .orderbook-section.asks .orderbook-row'),
      bids: rows('.trade-orderbook-panel .orderbook-section.bids .orderbook-row'),
      currentPrice: text('.trade-orderbook-panel .orderbook-current .current-price'),
      change24h: text('.trade-orderbook-panel .orderbook-current .price-change'),
      viewTabs: Array.from(document.querySelectorAll('.trade-view .trade-view-tab')).map((el) => ({
        text: norm(el.textContent),
        active: el.classList.contains('active'),
      })),
      panelText: (text('.trade-view .trade-order-input-panel') || '').slice(0, 700),
    };
  });
}

async function captureFuturesTab(page) {
  return evaluate(page, () => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? norm(el.textContent) : null;
    };
    return {
      roundTime: text('.futures-view .round-time') || text('.top-info-bar .round-time'),
      pairName: text('.futures-view .token-pair-name'),
      viewTabs: Array.from(document.querySelectorAll('.futures-view .trade-view-tab')).map((el) => ({
        text: norm(el.textContent),
        active: el.classList.contains('active'),
      })),
      overlayTitle: text('.futures-view .trade-order-input-panel .cex-delisted-title'),
      overlayDesc: text('.futures-view .trade-order-input-panel .cex-delisted-desc'),
      leftPanelText: (text('.futures-view .trade-order-input-panel') || '').slice(0, 600),
      orderbookText: (text('.futures-view .trade-right-panel') || '').slice(0, 400),
    };
  });
}

async function captureAssetsTab(page) {
  return evaluate(page, () => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? norm(el.textContent) : null;
    };
    const detail = Array.from(document.querySelectorAll('.assets-page .assets-total-detail .detail-item')).map((item) => ({
      label: norm(item.querySelector('.detail-label') ? item.querySelector('.detail-label').textContent : ''),
      value: norm(item.querySelector('.detail-value') ? item.querySelector('.detail-value').textContent : ''),
    }));
    return {
      roundTime: text('.assets-page .round-time'),
      headerTitle: text('.assets-page .assets-header-title .header-title'),
      totalValue: text('.assets-page .assets-total-value'),
      detail,
      tabs: Array.from(document.querySelectorAll('.assets-page .assets-tabs .assets-tab')).map((el) => ({
        text: norm(el.textContent),
        active: el.classList.contains('assets-tab-active'),
      })),
      contentText: (text('.assets-page .assets-page-content') || '').slice(0, 600),
    };
  });
}

async function captureKline(page) {
  return evaluate(page, () => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? norm(el.textContent) : null;
    };
    return {
      code: text('.token-detail-page .td-token-code'),
      price: text('.token-detail-page .td-price'),
      ohlc: text('.token-detail-page .td-price-stats'),
      periodButtons: Array.from(document.querySelectorAll('.token-detail-page .td-period-btn')).map((el) => ({
        text: norm(el.textContent),
        active: el.classList.contains('active'),
      })),
      depthButton: text('.token-detail-page .td-depth-btn'),
      chartAreaPresent: !!document.querySelector('.token-detail-page .td-chart-area'),
      candleSvgCount: document.querySelectorAll('.token-detail-page .td-chart-area svg, .token-detail-page .td-chart-area canvas').length,
    };
  });
}

async function screenshot(page, outDir, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', fullPage: false });
  const bytes = fs.statSync(file).size;
  return { name, bytes };
}

// ---------- 断言 ----------
function parseRoundTime(text) {
  const m = /^第(\d+)天 (\d{2}):00$/.exec(text || '');
  if (!m) return null;
  return (Number(m[1]) - 1) * 24 + Number(m[2]);
}

function evaluateAssertions(report, expectedRounds, outDir) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail: detail === undefined ? null : detail });

  const pageErrors = report.errors && report.errors.pageErrors ? report.errors.pageErrors : [];
  const consoleReal = report.errors && report.errors.consoleErrorReal ? report.errors.consoleErrorReal : [];
  const rounds = report.rounds || [];
  const tabs = report.tabs || {};
  const interactions = report.interactions || {};

  add('init.scriptApplied', !!(report.initScript && report.initScript.applied));
  add('init.screenDetected', !!(report.initScreen && report.initScreen.hasStartButton));
  add('init.gameStarted', !!report.gameStarted);
  add('page.noPageError', pageErrors.length === 0, pageErrors.map((e) => e.message).slice(0, 5));
  add('console.noConsoleError', consoleReal.length === 0, consoleReal.map((e) => e.text).slice(0, 5));
  add('rounds.count', rounds.length === expectedRounds, `期望 ${expectedRounds}，实际 ${rounds.length}`);
  add('rounds.timeFormat', rounds.length > 0 && rounds.every((r) => parseRoundTime(r.roundTime) !== null), rounds.map((r) => r.roundTime));
  add('rounds.timeSequence', rounds.length > 1 && rounds.slice(1).every((r, i) => {
    const prev = parseRoundTime(rounds[i].roundTime);
    const cur = parseRoundTime(r.roundTime);
    return prev !== null && cur !== null && cur - prev === 1;
  }));
  add('rounds.fastForwardReenabled', rounds.length > 0 && rounds.every((r) => r.home && r.home.fastForward && r.home.fastForward.disabled === false));
  add('home.totalAsset', rounds.length > 0 && /^\$/.test((rounds[rounds.length - 1].home || {}).totalAsset || ''));
  add('home.detailLabels', rounds.length > 0 && ['可用', '盈亏', 'ROI'].every((label) => ((rounds[rounds.length - 1].home || {}).assetDetail || []).some((d) => d.label === label)));
  add('home.marketRows', rounds.length > 0 && ((rounds[rounds.length - 1].home || {}).homeMarketRows || []).length >= 3);
  add('nav.labels', Array.isArray(report.navLabels) && report.navLabels.join(',') === NAV_LABELS_EXPECTED.join(','), report.navLabels);
  add('tabs.captured', TABS.every((t) => !!tabs[t]), Object.keys(tabs));
  add('trade.pairName', /USDT$/.test((tabs.trade || {}).pairName || ''));
  add('trade.orderbookRows', ((tabs.trade || {}).asks || []).length >= 1 && ((tabs.trade || {}).bids || []).length >= 1);
  add('futures.captured', !!(tabs.futures && (tabs.futures.pairName || tabs.futures.overlayTitle)));
  add('assets.captured', !!(tabs.assets && tabs.assets.totalValue));
  add('kline.chartArea', (interactions.kline || {}).chartAreaPresent === true);
  add('kline.backReturned', report.klineClosed === true);
  add('screenshots.count', (report.screenshots || []).length >= 7, (report.screenshots || []).length);
  add('screenshots.files', (report.screenshots || []).every((s) => s.bytes > 1000 && fs.existsSync(path.join(outDir, s.name))));
  add('app.shaRecorded', /^[0-9a-f]{64}$/.test((report.app || {}).sha256 || ''));

  const failures = checks.filter((c) => !c.ok);
  return { ok: failures.length === 0, checks, failures };
}

// ---------- 主流程 ----------
async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`[capture] 参数错误：${e.message}`);
    printHelp();
    return 2;
  }
  if (args.help) {
    printHelp();
    return 0;
  }

  const outDir = path.resolve(process.cwd(), args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const startedMs = Date.now();
  const report = {
    schemaVersion: 1,
    tool: 'regression-capture',
    app: {
      path: 'src/App.tsx',
      sha256: sha256File(path.join(PROJECT_DIR, 'src', 'App.tsx')),
      bytes: (() => {
        try { return fs.statSync(path.join(PROJECT_DIR, 'src', 'App.tsx')).size; } catch { return null; }
      })(),
    },
    options: { rounds: args.rounds, seed: args.seed, fixedNow: FIXED_NOW, viewport: { width: 390, height: 844, deviceScaleFactor: 2 }, userAgent: MOBILE_UA },
    initScript: { applied: false, seed: args.seed, fixedNow: FIXED_NOW },
    initScreen: null,
    gameStarted: false,
    initialHome: null,
    navLabels: null,
    rounds: [],
    tabs: {},
    interactions: {},
    klineClosed: false,
    screenshots: [],
    errors: { pageErrors: [], consoleErrors: [], consoleErrorPrefixed: [], consoleErrorReal: [], consoleErrorBenign: [], consoleWarnings: [], dialogs: [], requestFailures: [] },
    warnings: [],
    assertions: { ok: false, checks: [], failures: [] },
  };

  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  let exitCode = 0;

  try {
    let baseUrl = args.url;
    if (!baseUrl) {
      log(`启动 dev server（npm run dev -- --host 127.0.0.1 --port ${args.port} --strictPort）...`);
      server = startDevServer(args.port);
      baseUrl = `http://127.0.0.1:${args.port}/`;
      await waitForDevServer(server, baseUrl, args.timeout);
      log(`dev server 就绪：${baseUrl}`);
    } else {
      log(`复用外部 dev server：${baseUrl}`);
    }
    baseUrl = baseUrl.replace(/\/?$/, '/');
    report.baseUrl = baseUrl;

    log('启动 Chromium ...');
    const launched = await launchBrowser();
    browser = launched.browser;
    report.browser = { executable: launched.executable };

    log('创建移动端上下文 ...');
    const created = await newPage(browser, { seed: args.seed, fixedNow: FIXED_NOW, loadTimeout: args.timeout });
    context = created.context;
    page = created.page;
    report.errors = created.errors;

    log(`打开页面：${baseUrl}（首次编译 33k 行 App.tsx，可能较慢）...`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: args.timeout });

    // 预热：先等首屏就绪再 reload 一次。
    // 目的：Vite 首次访问可能触发依赖预构建/首次编译后的整页重载（optimized dependencies changed），
    // 把这类一次性重载消耗在“预热页”上，确保真正计量的这次页面加载从确定状态开始。
    await page.locator('[data-testid="start-game-btn"]').waitFor({ state: 'visible', timeout: args.timeout });
    await settle(page, 200);
    log('预热重载页面（排除 Vite 首次编译/依赖预构建重载的影响）...');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: args.timeout });

    log('等待「开始游戏」按钮 ...');
    await page.locator('[data-testid="start-game-btn"]').waitFor({ state: 'visible', timeout: args.timeout });
    await settle(page, 250);
    report.initScript.applied = await evaluate(page, () => !!(window.__dsrCapture && window.__dsrCapture.applied));
    report.initScreen = await captureInitScreen(page);
    report.screenshots.push(await screenshot(page, outDir, 'screenshot-00-init.png'));

    log('点击「开始游戏」...');
    const startMethod = await clickWithFallback(page, '[data-testid="start-game-btn"]', 'start-game');
    report.startMethod = startMethod;
    await page.locator('.top-info-bar .round-time').first().waitFor({ state: 'visible', timeout: 120000 });
    await settle(page, 400);

    log('关闭热点弹窗 ...');
    const initialModal = await closeKnownModals(page);
    report.initialModals = initialModal;
    await settle(page, 300);
    report.gameStarted = true;

    report.initialHome = await captureHomeState(page);
    report.navLabels = await captureNavLabels(page);

    for (let round = 1; round <= args.rounds; round++) {
      log(`回合 ${round}/${args.rounds}：点击 ⏩ ...`);
      const beforeTime = await textOf(page, '.top-info-bar .round-time');
      const ffMethod = await clickWithFallback(page, '[data-testid="fast-forward-btn"]', `fast-forward-${round}`);
      await waitForRoundTimeChange(page, beforeTime, 120000);
      await waitForFastForwardEnabled(page, 120000);
      await settle(page, 350);
      const modals = await closeKnownModals(page);
      if (modals.remaining.length > 0) {
        report.warnings.push({ round, kind: 'stray-overlays', remaining: modals.remaining });
      }
      const home = await captureHomeState(page);
      report.rounds.push({
        round,
        roundTime: home.roundTime,
        home,
        fastForwardClick: ffMethod,
        modalsClosed: modals.closed.map((m) => m.name),
        strayOverlays: modals.remaining,
      });
      log(`回合 ${round} 完成：${home.roundTime} 总资产=${home.totalAsset}`);
    }

    log('录制 5 个底部页签 ...');
    for (const tab of TABS) {
      log(`页签 ${tab} ...`);
      await switchTab(page, tab);
      let state;
      if (tab === 'home') state = await captureHomeState(page);
      else if (tab === 'market') state = await captureMarketTab(page);
      else if (tab === 'trade') state = await captureTradeTab(page);
      else if (tab === 'futures') state = await captureFuturesTab(page);
      else state = await captureAssetsTab(page);
      report.tabs[tab] = state;
      const shotName = tab === 'trade' ? 'screenshot-trade-cex.png' : `screenshot-${tab}.png`;
      report.screenshots.push(await screenshot(page, outDir, shotName));

      if (tab === 'trade') {
        log('打开「K线」全屏 ...');
        await clickDom(page, '.trade-view .token-kline-btn');
        await page.locator('.kline-page').waitFor({ state: 'visible', timeout: 30000 });
        await settle(page, 500);
        report.interactions.kline = await captureKline(page);
        report.screenshots.push(await screenshot(page, outDir, 'screenshot-kline.png'));

        log('关闭 K线 ...');
        await clickDom(page, '.token-detail-page .td-back-btn');
        await page.locator('.kline-page').waitFor({ state: 'hidden', timeout: 30000 });
        await settle(page, 300);
        report.klineClosed = true;
      }
    }

    log('回到首页 ...');
    await switchTab(page, 'home');
    report.finalHome = await captureHomeState(page);
    report.bodyMetrics = await evaluate(page, () => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio }));
    report.gameStarted = true;
  } catch (e) {
    exitCode = 1;
    report.fatalError = { message: norm(String((e && e.message) || e)).slice(0, 3000), stack: String((e && e.stack) || '').slice(0, 4000) };
    log(`FAIL：${report.fatalError.message}`);
    if (page) {
      try {
        report.failureArtifacts = {
          url: page.url(),
          bodyText: (await page.evaluate(() => (document.body ? document.body.innerText : ''))).slice(0, 3000),
        };
      } catch {
        /* ignore */
      }
      try {
        await page.screenshot({ path: path.join(outDir, 'screenshot-failure.png'), animations: 'disabled' });
        report.screenshots.push({ name: 'screenshot-failure.png', bytes: fs.statSync(path.join(outDir, 'screenshot-failure.png')).size });
      } catch {
        /* ignore */
      }
    }
  } finally {
    // 冻结错误记录：context.close() 之后可能还有晚到的 console/requestfailed 事件，
    // 若继续写入同一个数组会让快照带上与本次流程无关且不确定的尾部记录。
    report.errors = JSON.parse(JSON.stringify(report.errors));
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) {
      log('清理 dev server ...');
      await stopServer(server);
    }

    report.git = gitInfo();
    report.durationMs = Date.now() - startedMs;
    report.capturedAt = new Date().toISOString();
    report.assertions = evaluateAssertions(report, args.rounds, outDir);
    if (!report.assertions.ok && !report.fatalError) {
      exitCode = 1;
      report.fatalError = {
        message: `断言失败 ${report.assertions.failures.length} 项：${report.assertions.failures.map((f) => f.id).join(', ')}`,
        stack: '',
      };
    }
    if (!report.assertions.ok) exitCode = 1;

    const snapshotPath = path.join(outDir, SNAPSHOT_FILE);
    fs.writeFileSync(snapshotPath, JSON.stringify(report, null, 2) + '\n');

    const total = report.assertions.checks.length;
    const passed = total - report.assertions.failures.length;
    log(`snapshot 已写入：${snapshotPath}`);
    log(`回合=${report.rounds.length} 页签=${Object.keys(report.tabs).length} 截图=${report.screenshots.length} 断言=${passed}/${total} ${report.assertions.ok ? 'OK' : 'FAILED'} 耗时=${(report.durationMs / 1000).toFixed(1)}s`);
    log(`App.tsx sha256=${report.app.sha256}${report.app.sha256 && report.app.sha256.startsWith(EXPECTED_APP_SHA_PREFIX) ? '（匹配拆分前基线前缀 ' + EXPECTED_APP_SHA_PREFIX + '）' : '（与拆分前基线前缀 ' + EXPECTED_APP_SHA_PREFIX + ' 不同）'}`);
    log(`errors: pageErrors=${report.errors.pageErrors.length} consoleError(real)=${report.errors.consoleErrorReal.length} consoleError(benign)=${report.errors.consoleErrorBenign.length} consoleWarnings=${report.errors.consoleWarnings.length} requestFailures=${report.errors.requestFailures.length}`);
    if (!report.assertions.ok) {
      for (const f of report.assertions.failures) log(`  ✗ ${f.id}${f.detail === null ? '' : `：${JSON.stringify(f.detail)}`}`);
    }
    if (report.warnings.length > 0) log(`warnings=${report.warnings.length}（详见 JSON warnings 字段）`);
  }

  return exitCode;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((e) => {
    console.error('[capture] 未捕获错误：', e);
    process.exit(1);
  });
