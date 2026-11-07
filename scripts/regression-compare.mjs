#!/usr/bin/env node
/**
 * regression-compare.mjs — 比较两次 regression-capture 的 seeded-snapshot.json
 *
 * 用法（在项目根目录执行）：
 *   node scripts/regression-compare.mjs tests/baseline tests/tmp
 *   node scripts/regression-compare.mjs tests/baseline tests/tmp --max-diffs 200 --verbose
 *
 * 比较策略：
 *   - 只比较 seeded-snapshot.json（不比较 PNG 截图：截图受字体渲染/抗锯齿影响，即使同一构建也可能
 *     逐字节不同；截图的“存在性/数量/大小>1000B”已由 capture 的 assertions 校验）
 *   - 忽略以下易变字段：
 *       capturedAt   capture 的墙上时间
 *       durationMs   运行耗时
 *       baseUrl      自起 server 与 --url 复用会不同
 *       git          不同人/不同分支跑会不同
 *       screenshots  PNG 大小易变（见上）
 *       app.sha256   App.tsx 文件哈希（任务要求忽略；拆分后必然变化）
 *       app.bytes    App.tsx 字节数（拆分后必然变化）
 *   - 其余字段全部严格比较（深比较，对象 key 排序后比较），保证 DOM 文本/回合快照/页签文本/断言结果一致
 *
 * 退出码：0 = 完全一致；1 = 有差异；2 = 用法/文件错误
 */
import fs from 'node:fs';
import path from 'node:path';

const SNAPSHOT_FILE = 'seeded-snapshot.json';
const DEFAULT_MAX_DIFFS = 100;

// 顶层忽略字段（值随意，不参与比较）
const IGNORED_TOP_LEVEL = new Set(['capturedAt', 'durationMs', 'baseUrl', 'git', 'screenshots']);
// 嵌套忽略字段，用 "." 路径表示
const IGNORED_PATHS = new Set(['app.sha256', 'app.bytes']);

const MAX_STRING = 300;

function usage(msg) {
  console.error(`[compare] ${msg}`);
  console.error('用法: node scripts/regression-compare.mjs <baselineDir> <candidateDir> [--max-diffs 100] [--verbose]');
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  let maxDiffs = DEFAULT_MAX_DIFFS;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-diffs') {
      const v = argv[++i];
      if (v === undefined) usage('--max-diffs 缺少值');
      maxDiffs = Number(v);
      if (!Number.isFinite(maxDiffs) || maxDiffs < 1) usage('--max-diffs 必须是 >=1 的数字');
    } else if (a === '--verbose') {
      verbose = true;
    } else if (a === '-h' || a === '--help') {
      usage('帮助：');
    } else if (a.startsWith('--')) {
      usage(`未知参数：${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 2) usage(`需要 2 个目录参数，实际收到 ${positional.length} 个`);
  return { dirA: positional[0], dirB: positional[1], maxDiffs, verbose };
}

function loadSnapshot(dir, label) {
  const file = path.join(dir, SNAPSHOT_FILE);
  if (!fs.existsSync(file)) usage(`找不到 ${label} 的 ${SNAPSHOT_FILE}：${file}`);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    usage(`读取失败 ${file}：${e.message}`);
  }
  try {
    return { data: JSON.parse(raw), file };
  } catch (e) {
    usage(`${file} 不是合法 JSON：${e.message}`);
  }
}

function stableStringify(value) {
  // 仅用于打印，对象 key 排序保证可读
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s) {
  if (typeof s !== 'string') return s;
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…(+${s.length - MAX_STRING})` : s;
}

function isIgnored(pathStr) {
  if (IGNORED_TOP_LEVEL.has(pathStr)) return true;
  if (IGNORED_PATHS.has(pathStr)) return true;
  return false;
}

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * 深比较，返回差异数组 [{path, kind, baseline, candidate, note?}]
 * kind: 'missing' | 'extra' | 'type' | 'value'
 */
function diff(a, b, pathStr, out) {
  if (isIgnored(pathStr)) return;

  const ta = typeName(a);
  const tb = typeName(b);
  if (ta !== tb) {
    out.push({ path: pathStr || '<root>', kind: 'type', baseline: ta, candidate: tb });
    return;
  }

  if (ta === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of Array.from(keys).sort()) {
      const childPath = pathStr ? `${pathStr}.${key}` : key;
      if (isIgnored(childPath)) continue;
      const hasA = Object.prototype.hasOwnProperty.call(a, key);
      const hasB = Object.prototype.hasOwnProperty.call(b, key);
      if (!hasA && hasB) {
        out.push({ path: childPath, kind: 'extra', baseline: undefined, candidate: truncate(stableStringify(b[key])) });
      } else if (hasA && !hasB) {
        out.push({ path: childPath, kind: 'missing', baseline: truncate(stableStringify(a[key])), candidate: undefined });
      } else {
        diff(a[key], b[key], childPath, out);
      }
    }
    return;
  }

  if (ta === 'array') {
    if (a.length !== b.length) {
      out.push({ path: pathStr || '<root>', kind: 'value', baseline: `length=${a.length}`, candidate: `length=${b.length}` });
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      diff(a[i], b[i], `${pathStr}[${i}]`, out);
    }
    return;
  }

  // number / string / boolean / null / undefined
  if (!Object.is(a, b)) {
    out.push({ path: pathStr || '<root>', kind: 'value', baseline: truncate(stableStringify(a)), candidate: truncate(stableStringify(b)) });
  }
}

function describeDiff(d) {
  switch (d.kind) {
    case 'missing':
      return `只在基线上存在（candidate 缺失）：baseline=${d.baseline}`;
    case 'extra':
      return `只在 candidate 上存在：candidate=${d.candidate}`;
    case 'type':
      return `类型不同：baseline=${d.baseline}，candidate=${d.candidate}`;
    default:
      return `值不同：baseline=${d.baseline}，candidate=${d.candidate}`;
  }
}

function countFields(value, depth = 0) {
  if (depth > 30 || value === null || typeof value !== 'object') return 1;
  if (Array.isArray(value)) return 1 + value.reduce((sum, v) => sum + countFields(v, depth + 1), 0);
  return 1 + Object.keys(value).reduce((sum, k) => sum + countFields(value[k], depth + 1), 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { data: a, file: fileA } = loadSnapshot(path.resolve(args.dirA), 'baseline');
  const { data: b, file: fileB } = loadSnapshot(path.resolve(args.dirB), 'candidate');

  console.log(`[compare] baseline : ${fileA}`);
  console.log(`[compare] candidate: ${fileB}`);

  // 打印可读摘要（这些字段本身不参与差异判定，仅信息）
  const summary = (name, snap) => {
    const app = snap.app || {};
    const rounds = Array.isArray(snap.rounds) ? snap.rounds.length : 0;
    const tabs = snap.tabs ? Object.keys(snap.tabs).length : 0;
    const shots = Array.isArray(snap.screenshots) ? snap.screenshots.length : 0;
    const assertions = snap.assertions || {};
    const checks = Array.isArray(assertions.checks) ? assertions.checks : [];
    const passed = checks.filter((c) => c.ok).length;
    console.log(
      `[compare] ${name}: rounds=${rounds} tabs=${tabs} screenshots=${shots} assertions=${passed}/${checks.length} sha256=${(app.sha256 || 'n/a').slice(0, 12)}…${snap.fatalError ? ` fatalError=${truncate(snap.fatalError.message)}` : ''}`,
    );
  };
  summary('baseline ', a);
  summary('candidate', b);

  const diffs = [];
  diff(a, b, '', diffs);

  const totalFields = countFields(a) + countFields(b);
  if (diffs.length === 0) {
    console.log(`[compare] ✅ 一致：0 差异（已忽略 capturedAt/durationMs/baseUrl/git/screenshots/app.sha256/app.bytes）`);
    return 0;
  }

  console.log(`[compare] ❌ 发现 ${diffs.length} 处差异（共比较约 ${totalFields} 个字段/元素）：`);
  const shown = args.verbose ? diffs : diffs.slice(0, args.maxDiffs);
  for (const d of shown) {
    console.log(`  - ${d.path}`);
    console.log(`      ${describeDiff(d)}`);
  }
  if (shown.length < diffs.length) {
    console.log(`  …另有 ${diffs.length - shown.length} 处差异未显示（可加 --verbose 或提高 --max-diffs）`);
  }

  // 按顶层字段归类，方便快速定位
  const byRoot = new Map();
  for (const d of diffs) {
    const root = d.path.split(/[.[]/)[0] || '<root>';
    byRoot.set(root, (byRoot.get(root) || 0) + 1);
  }
  console.log('[compare] 差异按顶层字段统计：');
  for (const [root, count] of Array.from(byRoot.entries()).sort((x, y) => y[1] - x[1])) {
    console.log(`  - ${root}: ${count}`);
  }
  return 1;
}

process.exit(main());
