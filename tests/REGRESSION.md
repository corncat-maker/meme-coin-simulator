# App.tsx 拆分回归护栏（确定性端到端快照）

用于在 `src/App.tsx`（33,786 行巨石组件）拆分过程中验证「行为完全不变」。
基线录制于拆分前 HEAD `293716cd46f779e5a01439e1598a45a4d4a83d95`，
`src/App.tsx` sha256 前缀 `910ead26`（拆分后该字段由 compare 忽略）。

## 命令（工作目录：项目根目录）

```bash
# 1) 先起一个独立 dev server（勿占用/杀掉 5173）
npm run dev -- --host 127.0.0.1 --port 5181 --strictPort

# 2) 拆分前的基线（只做一次，已完成，tests/baseline/ 已存在）
node scripts/regression-capture.mjs --out tests/baseline --url http://127.0.0.1:5181

# 3) 每次改完 src/ 后重新 capture，再与基线比较
node scripts/regression-capture.mjs --out tests/tmp --url http://127.0.0.1:5181
node scripts/regression-compare.mjs tests/baseline tests/tmp
# 退出码：0=完全一致；1=有差异；2=用法/文件错误

# 也可用 npm scripts（test:regression 会自起 5181 server，与 Lead 的 5181 冲突时改用上面手写命令）
npm run test:regression:baseline
npm run test:regression:capture
npm run test:regression:compare
```

## capture 做了什么

1. `addInitScript` 注入确定性环境（每次文档加载都先执行）：
   - `mulberry32(seed=20261031)` 替换 `Math.random`
   - `Date` 冻结：`Date.now()` / 无参 `new Date()` 固定为 `1700000000000`
   - 清空 localStorage 并固定 `theme-mode=dark`
2. 浏览器上下文：viewport `390x844`、DPR `2`、`isMobile/hasTouch`、Mobile UA、`Asia/Shanghai`、`zh-CN`、dark。
3. 流程：加载页面（先预热 reload 一次，排除 Vite 依赖预构建整页重载）→ 点「开始游戏」→ 关热点弹窗 → 点 6 次头部 ⏩，每回合等 `.round-time` 文本变化并记录（总资产、可用/盈亏/ROI、涨跌榜前 5 行等）→ 依次录 5 个底部页签（首页/行情/交易/合约/资产）→ 交易页 CEX→DEX 切换 → 打开「K线」全屏再返回 → 回首页收尾。
4. 输出：
   - `seeded-snapshot.json`：App.tsx sha256、每回合快照、各页签文本、断言结果、errors、耗时等
   - 8 张 PNG：`screenshot-00-init / home / market / trade-cex / trade-dex / kline / futures / assets`

## 断言（25 条，失败退出码 1）

- 无 `pageerror`；无真实 `console.error`（main.tsx 会把 console.error 重写成
  `console.log('[console.error]', ...)`，React dev 的 `Warning:` 归入 benign、不判失败但写入 JSON）
- 6 回合、时间格式 `第N天 HH:00`、逐回合 +1、快进按钮每次恢复可点
- 总资产 `$` 前缀、可用/盈亏/ROI、首页涨跌榜 ≥3 行
- 底部 5 个页签标签与内容；交易页 CEX/DEX 切换；K线全屏图表区域存在且能返回
- 8 张截图存在且 >1000B；App.tsx sha256 已记录

## compare 忽略的易变字段

`capturedAt`、`durationMs`、`baseUrl`、`git`、`screenshots`（PNG 字节易变，存在性/数量由断言保证）、
`app.sha256`、`app.bytes`（拆分后必然变化）。
其余字段全部严格深比较。

## 已知不确定性 / 降级策略

- 游戏内有 500/900ms 的 `setTimeout` toast（文本不进入快照），会带来额外 re-render，但不影响快照字段。
- 截图逐字节可能因抗锯齿略有差异，因此不参与 compare。
- 若未来 compare 出现差异且确认是非行为性字段（例如告警文本、长文本 blob 中夹带的动态内容），
  在 `scripts/regression-compare.mjs` 的 `IGNORED_TOP_LEVEL` / `IGNORED_PATHS` 中增加路径即可；
  但优先排查是否真的行为回归，不要为了「跑绿」而放宽比较。
- 本护栏只覆盖「开始游戏 → 6 回合 → 5 页签 → DEX/K线」这条主路径，不覆盖下单/开仓/存档等交互。
