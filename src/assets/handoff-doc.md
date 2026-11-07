# Meme币庄家模拟器（回合制加密货币模拟交易）项目交接文档

> 交接对象：后续接手优化本项目的 AI / 开发者
> 整理时间：2026-10-31
> 数据来源：当前工作区源码（src/App.tsx 等），所有公式与参数均从代码中摘录；无法确认的信息已标注「需人工补充」，未做任何编造。

---

## 一、项目概述

1. 这是一款**回合制加密货币模拟交易 + 庄家扮演**游戏：玩家扮演 Meme 币市场庄家，通过现货买卖、限价挂单、DEX 兑换、永续合约开平仓、发币/销毁/空投、营销、运营等手段影响市场价格，扩大自身资产规模。
2. 技术栈为 **React 18 + TypeScript + Tailwind CSS + Vite 7** 的纯前端 H5 应用，逻辑全部在浏览器内运行（iframe sandbox 环境），无后端、无数据库。
3. 项目通过**灵光闪应用平台**发布运行，以 WebView 嵌入方式呈现；当前仓库内**没有** Capacitor/Cordova 等 APK 打包配置（详见第五节，打包 APK 需人工补充）。
4. 游戏以「回合」推进：**每回合 = 游戏中 1 小时**，24 回合 = 1 天；点击快进按钮执行一回合，系统按「K线/盘口生成 → 撮合 → 强平 → 资金费率 → 事件 → 热度 → 观察标签 → 下架检查」的顺序推进全局状态。
5. **CEX 机制**：中心化交易所采用「限价单订单簿」模型，系统每回合生成 10 档买盘/卖盘（订单量基于有效市值计算），玩家限价单插入盘口参与撮合；当前价 = 市场买一价（跳过玩家挂单）。
6. **DEX 机制**：去中心化交易所采用 **AMM 恒定乘积公式 x·y = k** 的流动性池模型，支持兑换（Swap）、添加/移除流动性；池子价格每回合通过 dexPriceOffset 软联动机制向 CEX 参考价收敛。
7. **永续合约**：独立订单簿（订单量为现货的 3 倍），支持多空、杠杆分级（按代币 tier）、限价/市价、全仓/逐仓、资金费率结算、散户反向持仓、强制平仓与 ADL 自动减仓。
8. 市场中存在**AI 交易员、做市商、散户、巨鲸**等角色，与玩家共同形成多空博弈；还有热点板块、市场事件、突发事件、观察标签、热度、下架/重新上架等宏观机制。
9. 全部玩法为单机模拟，存档使用 localStorage（主存档）+ IndexedDB（备份），支持 3 个存档槽位。

---

## 二、项目文件结构

```
/root/data
├── index.html                      # 入口 HTML（挂载 #root，加载 /src/main.tsx）
├── package.json                    # 依赖与脚本（dev/build/lint/preview）
├── vite.config.ts                  # Vite 配置（路径别名 @/ → src/）
├── tsconfig*.json                  # TypeScript 配置（多套严格度）
├── manifest.json                   # 闪应用配置（导航栏可见性/标题/颜色）
├── eslint.config.js / eslint.strict.config.js   # ESLint 规则
├── tailwind.config.js / postcss.config.js       # Tailwind/PostCSS 配置
├── README.md                       # 项目说明 + 完整版本更新日志（含各机制演进历史，改机制前必读）
├── AGENTS.md                       # 开发约束说明（需人工确认是否仍同步）
├── src/
│   ├── main.tsx                    # React 入口（勿修改）
│   ├── App.tsx                     # ★ 主组件：全部游戏逻辑（约 3.4 万行）
│   │                               #   - 经济系统核心：K线/盘口/AMM/合约/AI/事件/存档/UI
│   ├── App.css                     # 全局样式（游戏界面、初始化页、弹窗等）
│   ├── index.css                   # 基础样式与 CSS 变量
│   ├── global.d.ts                 # 全局类型声明（lingguang API、AudioContext2 等）
│   ├── types/index.ts              # 业务类型定义（Token/Candle/Order/LiquidityPool/
│   │                               #   FuturesPosition/AITrader/AIMarketMaker 等）
│   ├── constants/
│   │   ├── index.ts                # 代币初始数据、板块/链/发行方式映射、AI 交易员与
│   │   │                           #   做市商初始名单、tier 标签等
│   │   └── events.ts               # 市场事件库（60 个事件）、突发事件定义、事件分级效果
│   ├── lib/
│   │   ├── performance.ts          # perfTimer 性能计时工具
│   │   ├── utils.ts                # cn() 等工具
│   │   ├── audio.ts / tone.ts      # 音频封装（Howler / Tone.js 受控入口）
│   │   └── service-api.ts          # 服务 API 封装
│   ├── hooks/                      # 自定义 Hook（use-toast 等）
│   ├── components/                 # 预置 UI 组件库（reactbits 动画组件等）
│   └── assets/                     # 图片、音效素材
├── lingguang-usage.json            # 平台 API 使用清单
└── mini_app_developer.json         # 平台开发者配置
```

**重点文件标注**：
- **入口文件**：`index.html` → `src/main.tsx` → `src/App.tsx`
- **经济系统核心逻辑**：`src/App.tsx`（K线生成、盘口生成、撮合、资金、持仓、合约、AI、事件、热度、观察标签、下架）
- **CEX 盘口逻辑**：`src/App.tsx` 内 `generateLevel2OrderBook` / `generateNextPeriodOrderBook` / `generateHybridOrderBook` / `mergePriceLevels` / `calculateNextCandle`
- **DEX AMM 池逻辑**：`src/App.tsx` 内 `initializeLiquidityPool` / `calculateAMMBuyPrice` / `calculateAMMSellPrice` / `updateLiquidityPool` / `generateAMMQuoteLevels` / `syncLiquidityPoolWithHoldings` / `resetDexPoolToPrice`
- **随机游走/价格生成**：`src/App.tsx` 内 `generateCandleData` / `calculateNextCandle` / `getTierVolatilityRange` / `getTierHighLowFloatRange`
- **打包配置**：**不存在** config.xml / capacitor.config.json / AndroidManifest.xml，打包 APK 需人工补充（见第五节）

---

## 三、核心机制说明（重点）

### 3.1 CEX 与 DEX 软联动机制（dexPriceOffset）

**设计意图**：DEX AMM 池不再被"同步"逻辑强行拉动，而是通过一个偏离值（dexPriceOffset）让 DEX 价格围绕 CEX 参考价软性收敛，既保持两个市场联动，又保留 DEX 独立波动的空间，同时杜绝旧版「玩家 CEX 买入 → 池子储备被错误调减 → DEX 价格暴涨」的 bug。

**配置参数**（`DEX_LINKAGE_CONFIG`）：

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `offsetDecay` | 0.8 | 每回合偏离值衰减为原来的 80% |
| `offsetMin` / `offsetMax` | -0.2 / +0.2 | 偏离值上下限 ±20% |
| `sensitivity` | 0.5 | 玩家 DEX 净交易量对偏离值的敏感度 |
| `maxRefChangePerRound` | 0.1 | 无成交时 CEX 参考价单回合最大波动 ±10% |

**执行流程（每回合、每个代币，位于 handleFastForward 中）**：

1. **回合结束计算净交易量影响**：
   ```
   roundEndDelta = (本回合玩家在 DEX 的净代币流量 dexNetFlow / 池子基础代币储备 dexBaseReserve) × sensitivity
   offsetAtRoundEnd = clamp(原 offset + roundEndDelta, -0.2, +0.2)
   ```
   - 买入代币记为正流量（`dexNetFlowRef` 累加），卖出记为负流量；DEX 兑换与 DEX 盘口成交都会累计。
2. **回合开始先衰减**：
   ```
   offsetAtRoundStart = offsetAtRoundEnd × 0.8
   ```
3. **计算 CEX 参考价**（`getCexReferencePrice`，抗操纵）：
   - 优先：本回合 CEX 成交的**成交量加权均价（VWAP）**；
   - 无成交：以上一回合参考价 `dexCexRefPrice` 为基准，把盘口中间价钳制在 ±10% 内；
   - 无历史：直接用盘口中间价。
4. **计算 DEX 目标初始价并重置池子**（`resetDexPoolToPrice`）：
   ```
   targetDexPrice = cexReferencePrice × (1 + offsetAtRoundStart)
   保持 k 不变：X' = sqrt(k / P)，Y' = sqrt(k × P)
   ```
5. 保存 `dexPriceOffset`、`dexCexRefPrice`、`dexBaseReserve = 新 tokenReserve`，清零本回合净流量。

**关键约束**：软联动只影响 DEX **下回合的初始价**；回合内系统不再直接调整 AMM 价格（只有玩家交易会改变池子）。无论盘口是否有玩家/做市商挂单，联动都会触发。池子重置后 `k` 不变，仅改变储备分布。

### 3.2 随机游走价格机制

**设计意图**：价格由「tier 波动率契约」约束，tier 越高波动越小（巨鲸最稳、微型最妖），同时区分「无玩家干预的纯随机模式」与「有玩家挂单/做市商/价差超限的盘口模式」两种轨道。

**tier 波动率范围**（`getTierVolatilityRange`，单回合涨跌幅，小数形式）：

| tier | 名称 | 单回合波动率范围 |
| --- | --- | --- |
| 1 | 微型（市值 < 1000 万） | 2% – 5% |
| 2 | 小型（≥ 1000 万） | 1% – 3% |
| 3 | 中型（≥ 1 亿） | 0.5% – 2% |
| 4 | 大型（≥ 10 亿） | 0.3% – 1% |
| 5 | 巨型（≥ 50 亿） | 0.2% – 0.5% |
| 6 | 巨鲸（≥ 100 亿） | 0.1% – 0.2% |

> 注意：观察标签代币的机制 tier 视为微型（1）；玩家可给代币加 `volBoostPct` 波动加成（事件/异常波动后按 n% 提升并逐回合衰减）。

**随机数生成方式**：
- 方向：`Math.random() > 0.5 ? 1 : -1`（纯随机模式下 50/50）；事件窗口内按事件上涨概率偏向。
- 幅度：`volatility = volMin + Math.random() × (volMax - volMin)`，`change = direction × volatility`。
- 初始 K 线预生成波动率数组（`volatilities`/`changes`），减少随机数调用。

**单回合涨跌幅限制**：tier 波动率范围本身就是硬限制；另外有**抛压/承接机制**（历史版本）将单回合极端涨跌限制在约 ±10% 以内（README v1.11，当前代码中该机制的残留逻辑需人工确认是否仍生效）。

**K 线分段生成**（`calculateNextCandle`）：
- 开盘价 = 上一回合收盘价。
- 收盘价分两种轨道：
  - **纯随机模式**（无玩家挂单且无做市商且价差 ≤ 10%）：`close = 上一收盘价 × (1 + change)`，再乘事件价格乘数；
  - **盘口模式**：收盘价 = 合并玩家挂单后的市场买一价（无则卖一价，再无则盘口基准价），再乘事件价格乘数。
- 最高/最低价按当回合涨跌方向浮动（涨：high 基于收盘价、low 基于开盘价；跌反之），浮动率按 tier（`getTierHighLowFloatRange`：微型 1%-3% … 巨鲸 0.01%-0.15%），再叠加：三级以上事件公布当回合（±涨幅×50%）、强平金额推高/压低（空头强平最多推高 25%，多头强平最多压低 20%，公式：`强平金额 / (市值 × 20)`）。
- 成交量：`单回合成交量 = 代币总量 × 振幅因子 × 20% + 热度因子`，其中振幅因子 = `(|振幅| + 0.1) / 0.2`，热度因子 = `10,000,000 × (热度/100) / 价格`。

**历史踩坑（勿回归）**：
- 纯随机模式下盘口基准价用本回合 K 线收盘价（`newCandle.open` 为基准），不再用上一回合盘口 lastPrice，否则出现「一涨一跌、幅度相同」的规律性锯齿。
- 纯随机模式只施加一次 tier 随机步长，双随机叠加会把巨鲸单回合波动放大到 ±0.4% 超出契约。
- 随机波动必须在「玩家买单抬升基准价」**之后**叠加，否则价格被钉死在限价单上、后续回合波动为 0%。

### 3.3 订单簿不平衡（OBI）影响机制

> 代码中没有「OBI」字样的命名，实际对应 `generateNextPeriodOrderBook` 内的**买卖盘数量比（bid/ask ratio）** 影响体系，机制如下：

**OBI 的计算**（盘口生成前，基于上一回合剩余市场订单）：
```
prevBidAskRatio = 上一回合剩余买盘总量 / max(上一回合剩余卖盘总量, 0.001)
```

**对下一回合价格/订单分布的影响**（价格间距调整）：
- `prevBidAskRatio > 1.5`（买盘明显多于卖盘）：卖盘价格间距缩小至 `[0.4, 0.8]`（更贴近现价、更易成交），买盘价格间距扩大至 `[1.2, 1.6]`；
- `prevBidAskRatio < 0.67`（卖盘明显多于买盘）：买盘价格间距缩小至 `[0.4, 0.8]`，卖盘价格间距扩大至 `[1.2, 1.6]`；
- 其余情况：间距因子为 1（不调整）。

**对下一回合漂移的影响**：盘口生成完成后执行**深度平衡**，强制买卖盘总量比例：
- 默认 `maxBidAskRatio = 2.0`、`minBidAskRatio = 0.5`（即 OBI 常态被限制在 0.5–2 之间）；
- 当有效市值偏离初始值超过阈值（见 3.4）时，按偏离幅度放宽：`maxBidAskRatio = 2.0 + min(2.0, 偏离×2)×1.5`（最高 5.0），`minBidAskRatio = 0.5 - min(2.0, 偏离×2)×0.2`（最低 0.1）——给价格回归机制留出作用空间；
- 超限时按比例缩减过量一侧的订单数量（不抵消回归效果）。

**对波动率的影响上限**：不平衡只影响**订单间距与订单数量**，不再直接改变价格步长；价格波动率始终由 tier 契约约束（3.2）。因此 OBI 的「影响上限」体现在深度平衡比例上限（5.0/0.1）与价格间距因子的有限范围（0.4–1.6）上。

**辅助影响因子**（同函数内叠加到买卖盘乘数）：
- 价格趋势：`trendFactor = log2(1 + |单回合涨跌幅%| / 10)`，上涨时卖单 `× (1 + trendFactor×0.2)`、买单最少保留 15%；下跌对称。
- 累计涨跌（连续趋势）：累计涨幅 x 时卖单 `× (1+x)`、买单 `× 1/(1+x)`（最少 10%）；累计跌幅 y 时买单 `× (1+2y)`、卖单最少 10%。
- 套利（资金费率驱动）、营销（FOMO/恐慌 ±50%）、热度（`0.5 + 热度/100×1.5`）、热点板块（每 3 回合方向偏多）等均以乘数叠加。

### 3.4 防操纵设计

1. **CEX 参考价抗操纵选取**（`getCexReferencePrice`）：优先本回合 CEX 成交 VWAP；无成交时以上一回合参考价为锚、把当前中间价钳制在 ±10% 内——单笔大单无法瞬间扭曲 DEX 联动基准。
2. **有效挂单范围限制**：
   - **玩家挂单不推动市场价**：盘口当前价（lastPrice）与 K 线收盘价均取「市场买一价」（`filter(b => !b.isPlayer)`），玩家挂单只是意向报价；
   - **仅高于市价的买单可抬升基准价**：玩家买单加权均价高于盘口基准价时，按 **100% 权重**直接抬升 `cexBasePrice`；低于市价的买单、所有卖单不参与基准价；
   - 玩家卖单无论价格高低都不影响基准价（历史修复：避免「挂 1000 的限价卖单 → 价格飞涨往 1000 靠」）。
3. **单玩家 DEX 影响上限**：玩家 DEX 净交易量对价格偏离的影响受 `sensitivity = 0.5` 与 ±20% 钳制（`clampDexOffset`），且每回合衰减 20%；单个玩家的持续买卖最多让 DEX 偏离 CEX ±20%。
4. **挂单资金锁定与撤单规则**：
   - 买单挂单时冻结等额现金（`frozenCapital`），卖单挂单时冻结对应持仓数量；
   - 成交时消耗冻结资金/持仓，成交价低于挂单价时差额返还可用资金；
   - 撤单/订单过期（回合超时）时全额退还冻结资金或持仓；部分成交只冻结剩余部分（`requiredFrozen` 重算，多余返还）；
   - 合约限价单同样冻结保证金，撤单返还。
5. **价格回归机制**（防止无基本面驱动时长期漂移）：当**有效市值**偏离初始有效市值超过 tier 阈值时（微型 15%、小型 17%、中型 20%、大型 22%、巨型 25%、巨鲸 28%），按指数力度增加反向订单（`priceReversionMultiplier = min(3.5, base×偏离^1.2 + 0.3)`，偏离 >50% 再额外加成），只作用于买卖盘数量、不影响订单价格。
6. **有效市值机制**：盘口订单量基于 `有效市值 = 总市值 × 已解锁比例 × (1 - 玩家市场持仓占比 - AI持仓占比 - 做市商持仓占比 - DEX池代币占比)` 计算，庄家囤积筹码不会凭空增加盘口流动性。
7. **深度与单档上限**：买盘总量 ≤ 有效供应量×1.5，卖盘总量受综合持仓占比指数衰减 `sellDecayFactor = (1 - combinedHoldingRatio)^0.5` 约束，单档 ≤ 有效供应量×15%。
8. **已移除的正反馈机制（勿恢复）**：涨幅/跌幅加速机制（deltaX 持仓占比加速）与 CEX 买盘最小系数机制均因导致价格暴涨暴跌正反馈而被移除，代码中保留注释说明。

---

## 四、关键代码

### 4.1 文件调用关系总览

```
main.tsx
  └─ App.tsx（唯一业务组件）
       ├─ constants/index.ts（代币/AI 初始数据）
       ├─ constants/events.ts（事件定义）
       ├─ types/index.ts（类型）
       └─ lib/performance.ts（性能计时）

回合推进主链路（handleFastForward 内部，按代币循环）：
  calculateNextCandle（新K线，收盘价/高低价/成交量）
    ├─ getTierVolatilityRange / getTierHighLowFloatRange（tier参数）
    └─ getCexReferencePrice（CEX参考价）← 供 DEX 软联动
  resetDexPoolToPrice（按 dexPriceOffset 重置DEX池）
  generateNextPeriodOrderBook（下回合CEX盘口）
    ├─ getTierVolatilityRange
    └─ （内部）深度平衡 / 价格回归 / 套利 / 玩家挂单处理
  generateFuturesOrderBook（下回合合约盘口，multiplier=3）
  撮合 / 强平（checkRetailLiquidation / processAILiquidation / ADL 收集）/ 资金费率 / 事件 / 热度 / 观察标签 / 下架
```

### 4.2 经济系统核心（tier 参数与 K 线）

```ts
// 单回合随机波动率范围（tier 契约）
function getTierVolatilityRange(tier: number): { volMin: number; volMax: number } {
  switch (tier) {
    case 6: return { volMin: 0.001, volMax: 0.002 }; // 巨鲸: 0.1%-0.2%
    case 5: return { volMin: 0.002, volMax: 0.005 }; // 巨型: 0.2%-0.5%
    case 4: return { volMin: 0.003, volMax: 0.01 };  // 大型: 0.3%-1%
    case 3: return { volMin: 0.005, volMax: 0.02 };  // 中型: 0.5%-2%
    case 2: return { volMin: 0.01,  volMax: 0.03 };  // 小型: 1%-3%
    default: return { volMin: 0.02, volMax: 0.05 };  // 微型: 2%-5%
  }
}

// K线高低价浮动范围（按 tier）
function getTierHighLowFloatRange(tier: number): { floatMin: number; floatMax: number } {
  switch (tier) {
    case 6: return { floatMin: 0.0001, floatMax: 0.0015 }; // 巨鲸: 0.01%-0.15%
    case 5: return { floatMin: 0.0005, floatMax: 0.003 };  // 巨型: 0.05%-0.3%
    case 4: return { floatMin: 0.001,  floatMax: 0.005 };  // 大型: 0.1%-0.5%
    case 3: return { floatMin: 0.002,  floatMax: 0.01 };   // 中型: 0.2%-1%
    case 2: return { floatMin: 0.005,  floatMax: 0.02 };   // 小型: 0.5%-2%
    default: return { floatMin: 0.01,  floatMax: 0.03 };   // 微型: 1%-3%
  }
}
```

```ts
// 回合K线生成核心（节选）
function calculateNextCandle(prevCandle, orderBook, token, marketSentiment, playerLimitOrders,
  playerHoldings, heat, playerVolume, hotSectorVolumeBonus, pool, tradeHistory,
  currentRound, liquidationInfo, eventPriceMultiplier, forcePriceLinkage, activeEventLevelEffect): Candle {
  const open = prevCandle.close;
  // 轨道1：无玩家挂单 && 无做市商 && 价差≤10% → 纯随机
  //   close = safePrevBasePrice * (1 + direction * volatility) * eventPriceMultiplier
  // 轨道2：盘口模式 → close = 合并玩家挂单后的市场买一价(||卖一价||盘口基准价) * eventPriceMultiplier
  // 高低价：涨→high=close*(1+tierFloatRate), low=open*(1-tierFloatRate)；跌反之
  // 事件/强平叠加浮动；成交量 = 总量*振幅因子*20% + 10M*(热度/100)/价
}
```

### 4.3 CEX 盘口逻辑

```ts
// 核心盘口生成：平衡版（节选：不平衡/回归/基准价/深度平衡）
function generateNextPeriodOrderBook(token, prevOrderBook, newCandle, playerLimitOrders,
  playerHoldings, heat, currentRound, fundingRateMultiplier, marketingEffect, cumulativeChange,
  isHotSectorToken, aiHoldingRatio, prevHoldingRatio, skipAcceleration, playerReservedRatio,
  dexPoolTokenRatio, marketMakerHoldingRatio, fearGreedIndex, eventPriceMultiplier,
  eventUpProbability, forcePriceLinkage, orderScale, bidScale, askScale): Level2OrderBook {
  // 0) 用上一回合市场盘口与玩家限价单撮合（以已存在挂单价格成交），记录 playerFillDetails
  // 1) 有效市值 = marketCap * unlockedRatio * (1 - 非市场持仓占比)
  //    baseOrderQuantity = max(effectiveSupply * 0.002, circulatingSupply * 0.0005 * ratio)
  // 2) 不平衡：prevBidAskRatio = 上回合买盘总量/卖盘总量
  //    >1.5 → 卖盘间距[0.4,0.8]、买盘间距[1.2,1.6]；<0.67 → 对称反转
  // 3) 套利/营销/累计涨跌 → spotBidMultiplier / spotAskMultiplier（乘数叠加）
  // 4) 基准价：无玩家挂单 → 纯随机（newCandle.open 为基准 × tier步长）
  //          有玩家挂单/做市商/价差>10% → newCandle.close，玩家高于市价的买单按100%权重抬升，再叠随机
  // 5) 生成10档买盘（价格围绕基准 ±0.05% 随机，间距 depthPercent*bidPriceAdjustFactor*(0.4~0.8)）
  //    生成10档卖盘（卖盘受 sellDecayFactor=(1-combinedHoldingRatio)^0.5 衰减）
  // 6) 深度平衡：bidAskRatio 限制 [minBidAskRatio, maxBidAskRatio]（默认0.5~2，偏离时放宽到0.1~5）
  // 7) 插入玩家剩余限价单（isPlayer+orderId 独立条目），排序，交叉盘撮合(≤100轮)
  // 8) lastPrice = 市场买一价（跳过玩家挂单）；买盘空时取卖一价*[0.98,0.998]
}
```

### 4.4 DEX AMM 池逻辑

```ts
// 初始化池子：代币储备 = 流通量 × (10%~20%)，USDT储备按价格计算并设tier下限
function initializeLiquidityPool(token: Token, initialPrice: number): LiquidityPool {
  const targetReserveRatio = 0.10 + Math.random() * 0.10; // 10%-20%
  const tokenReserve = token.circulatingSupply * targetReserveRatio;
  let quoteReserve = tokenReserve * initialPrice;
  // tier下限：微型500 / 小型1000 / 中型2000 / 大型以上5000 USDT
  const k = tokenReserve * quoteReserve;
  const lpTokenSupply = Math.sqrt(tokenReserve * quoteReserve);
  return { tokenId: token.id, tokenReserve, quoteReserve, k, fee: 0.003, lpTokenSupply,
           lastPrice: initialPrice, priceImpact: 0.01 };
}

// 买入：dy = y*dx/(x-dx) * (1+fee)，新价 = 新quoteReserve/新tokenReserve
function calculateAMMBuyPrice(pool: LiquidityPool, tokenAmount: number) {
  const x = pool.tokenReserve, y = pool.quoteReserve, dx = tokenAmount;
  const dy = y * dx / (x - dx) * (1 + pool.fee);
  const newPrice = (y + dy) / (x - dx);
  const priceImpact = (newPrice - y / x) / (y / x);
  return { quoteAmount: dy, newPrice, priceImpact };
}
// 卖出对称：dx 代币换 dy = y*dx/(x+dx) * (1-fee)（详见源码 calculateAMMSellPrice）

// 软联动配置与工具
const DEX_LINKAGE_CONFIG = {
  offsetDecay: 0.8, offsetMin: -0.2, offsetMax: 0.2,
  sensitivity: 0.5, maxRefChangePerRound: 0.1,
};
function clampDexOffset(value: number) { return Math.min(Math.max(value, -0.2), 0.2); }

function getCexReferencePrice(tradeHistory, currentRound, prevRefPrice, fallbackPrice): number {
  // 1) 本回合 CEX 成交 VWAP；2) 无成交→上一回合参考价±10%钳制；3) 无历史→中间价
}

function resetDexPoolToPrice(pool: LiquidityPool, targetPrice: number): LiquidityPool {
  const k = pool.k > 0 ? pool.k : pool.tokenReserve * pool.quoteReserve;
  return { ...pool,
    tokenReserve: Math.sqrt(k / Math.max(0.000001, targetPrice)),
    quoteReserve: Math.sqrt(k * Math.max(0.000001, targetPrice)),
    k, lastPrice: Math.max(0.000001, targetPrice) };
}

// 交易后更新池子：updateLiquidityPool(pool, side, tokenAmount, quoteAmount)
// 买入：tokenReserve-=dx, quoteReserve+=dy；卖出：tokenReserve+=dx, quoteReserve-=dy；k 不主动重算
// syncLiquidityPoolWithHoldings：仅同步 lastPrice 为 CEX 价格，不再主动调整储备（重要修复）
```

### 4.5 合约市场（节选）

```ts
// 合约订单簿独立生成：订单量为现货的 3 倍
function generateFuturesOrderBook(token, currentPrice, existingBook, fundingRateMultiplier,
  markPrice, marketingEffect, cumulativeChange, playerHoldingRatio, aiHoldingRatio,
  marketMakerHoldingRatio, dexPoolTokenRatio, orderScale): FuturesOrderBook {
  const multiplier = 3; // 合约订单量是现货的3倍
  // 有效市值 → effectiveSupply → baseOrderQuantity = safeEffectiveSupply * 0.001 * multiplier
  // 标记价格 = 现货买一价与合约买一价的几何平均数（sqrt(spotBidOne * futuresBidOne)）
  // 资金费率 = (合约价格 - 现货价格) / 现货价格，tier 分级上限（±0.1% ~ ±2%）
  // 套利：正费率→合约卖盘增加/现货买盘增加；≥±1%时指数级增强（ARBITRAGE_AMPLIFICATION）
  // 10档盘口，深度参数与现货一致；返回前处理交叉盘撮合
}

// 强平价格
// 逐仓：longLiq = entry * (1 - 1/lev + 维持保证金率0.5%)；shortLiq = entry * (1 + 1/lev - 0.5%)
// 全仓：保证金池 = 可用现金 + 冻结现金 + 其他仓位正浮盈（processAILiquidation 同规则）

// ADL（自动减仓）触发：预测强平数量超过盘口深度（深度为0也触发）
// 收集优先级：散户(0) > AI交易员/做市商(1) > 玩家(2)，同优先级按盈利从高到低
// 多头强平需要ADL空头盈利仓位（买盘挂买单）；空头强平需要ADL多头盈利仓位（卖盘挂卖单）
```

### 4.6 定制规则（近期新增，容易踩坑）

```ts
// 观察标签：24h涨幅≥1000% 或 24h跌幅≥90% → 观察14天(336回合)，延续上限14天
if (change24h >= 1000 || change24h <= -90) { watchEndRound = newRound + 336; }

// 空投热度：空投数量/市值 ≥1% → 热度 + floor(20 * (ratio / 0.01))（每1% +20）
const airdropRatio = airdropQuantity / token.marketCap;
if (airdropRatio >= 0.01) heatBonus = Math.floor(20 * (airdropRatio / 0.01));

// 流动性不足下架：近7日平均市值 < 3M（computeAvgMarketCap7d）；
// 另有筹码集中下架（maxHolderPercent>90%等）与诈骗嫌疑下架（24h跌幅>90% 且 池子USDT<初始10%）
// 重新上架：满足合约上架条件（市值≥10M、流动性池quoteReserve≥1M、24h成交额≥1M），
//           重新上架后观察7天(168回合)
function canListFutures(marketCap, quoteReserve, turnover24h) {
  return marketCap >= 10_000_000 && quoteReserve >= 1_000_000 && turnover24h >= 1_000_000;
}
```

---

## 五、构建与运行说明

### 5.1 安装依赖
```bash
npm install
```
（依赖已在 package-lock.json 中锁定，Node 版本需支持 Vite 7 / TS 5.9，建议 Node 18+，具体版本需人工补充确认。）

### 5.2 本地预览
```bash
npm run dev        # 启动 Vite 开发服务器，默认 http://localhost:5173
npm run preview    # 预览生产构建产物（先 build）
```

### 5.3 质量检查与构建
```bash
npm run build                  # tsc -b && vite build（类型检查 + 产物打包）
npm run lint                   # ESLint
npm run typecheck:all          # 完整类型检查
```

### 5.4 打包成 APK
**当前仓库没有任何 APK 打包配置**（无 config.xml、capacitor.config.json、AndroidManifest.xml、Cordova/Capacitor 依赖），项目是纯 H5 Web 应用，经灵光闪应用平台以 WebView 运行。如需独立 APK：
- 方案 A（推荐）：接入 **Capacitor**：`npm i @capacitor/core @capacitor/cli && npx cap init`，配置 `capacitor.config.json`（webDir 指向 `dist`），`npm run build && npx cap add android && npx cap sync`，再用 Android Studio 构建 APK。
- 方案 B：接入 **Cordova**：`cordova create` + `cordova platform add android`，webDir 指向构建产物。
- 需人工补充：具体打包 CI、签名配置、WebView 桥接（本应用依赖 `window.lingguang.*` 平台 API，独立打包时这些 API 不可用，需做能力降级或桥接适配）。

### 5.5 环境变量 / 配置文件
- 无业务环境变量（纯前端模拟）。
- 平台配置文件：`manifest.json`（导航栏：`navigationBar.visible=false`，全屏自绘 UI）、`lingguang-usage.json`（平台 API 清单）。
- 存档：localStorage（key 结构见 `openSaveDB`/`saveGameToSlot`，含 3 槽位元数据）+ IndexedDB 备份（`syncBackupToIndexedDB`）。

---

## 六、已知问题与待优化方向

1. **单文件过大**：`App.tsx` 约 3.4 万行，所有逻辑（引擎、盘口、AMM、合约、AI、事件、存档、UI）集中在一个组件，任何修改都面临上下文爆炸与回归风险。**建议按模块拆分**：`core/engine.ts`（回合推进）、`core/orderbook.ts`（盘口）、`core/amm.ts`（池子）、`core/futures.ts`（合约/ADL/资金费率）、`core/ai.ts`（AI 角色）、`ui/*`（界面）。
2. **文档与代码不一致**：README 中「合约盘口订单量是现货的 10 倍」「价格=盘口中间价 70%+开盘价 30%」「资金费率每小时结算、上限±5%」等描述与当前代码（合约 multiplier=3、价格=市场买一价、资金费率按 tier 分级结算）不一致，README 更新滞后，交接后应校对。
3. **ADL 机制脆弱**：历史版本 ADL 经历了「移除（v1.58）→ 重做（v1.59）→ 多次修复（v1.60-1.64）」，涉及异步 setState 嵌套、订单方向、成交匹配等大量坑；修改时务必对照 README 更新日志与成交记录验证。
4. **套利参数敏感**：套利放大系数历经 2→4→6→10→指数化的多次调整，存在正反馈风险（价格回归检测用于抵消）；调参前先理解「现货/合约价格回归检测」逻辑。
5. **性能瓶颈**：单回合推进（handleFastForward）同步计算全部代币（K线、CEX盘口、DEX池、合约盘口、AI 行为、事件、热度、观察、下架），代币多/回合多后可能有卡顿；已有 perfTimer、ref 缓存、预计算查询表等优化，仍有进一步空间（如 useMemo 粒度、避免大对象扩散）。
6. **存档体积**：每回合快照 + 全量游戏状态写入 localStorage/IndexedDB，长时间对局后存档可能接近容量上限；建议压缩（仅存增量/摘要）或迁移到 DB（需人工评估产品要求）。
7. **随机数不可复现**：全程 `Math.random()` 无种子，测试与回放困难；如需可复现需引入种子随机数（需人工评估是否必要）。
8. **UI 与逻辑耦合**：大量状态（约 200 个 useState）与弹窗/页签耦合，重构 UI 时容易破坏状态流；建议先抽取纯函数层再改 UI。

---

## 七、交接注意事项

以下机制**经过精心设计或调优，修改前必须先理解设计意图，禁止随意改动**：

1. **dexPriceOffset 软联动参数**（0.8 衰减 / ±20% 钳制 / 0.5 敏感度 / ±10% 参考价波动上限）是 CEX-DEX 价格收敛的核心，改任何一项都会改变两个市场的价差行为；不要恢复旧的「同步储备」逻辑（曾导致 DEX 价格暴涨 bug）。
2. **双轨价格模式**：无玩家挂单时走纯随机、有挂单/做市商/价差>10% 时走盘口模式。两条轨道的边界条件（`hasPlayerOrders`、`forcePriceLinkage`）不要轻易合并，历史曾因此出现 0% 波动、规律性锯齿等 bug。
3. **玩家挂单防操纵规则**：lastPrice 与 K 线收盘价必须跳过玩家挂单；只有高于市价的买单按 100% 权重抬升基准价；随机波动必须在抬升之后叠加。任何一条被破坏都会导致「挂单钉死价格」或「天价卖单拉飞价格」。
4. **tier 波动率契约**：微型 2-5% → 巨鲸 0.1-0.2% 是全局手感基线，观察标签代币视为微型（1）；新增机制时优先复用 `getMechanicsTier`，不要为单个代币硬编码波动率。
5. **有效市值机制**：CEX 与合约盘口订单量都基于有效市值（扣除玩家/AI/做市商/DEX 池持仓占比与未解锁比例），这是防止「庄家自买自卖无限拉盘」的核心，改动会直接影响可操纵性。
6. **已移除机制勿恢复**：涨幅/跌幅加速（持仓占比正反馈）、CEX 买盘最小系数（价格正反馈）都因导致暴涨暴跌被移除，代码注释中保留原因。
7. **定制规则有明确产品意图**：观察标签阈值（24h ±1000%/-90%）、空投热度加成（每 1% +20）、ADL 收集顺序（散户 > AI/做市商 > 玩家）、下架条件（近 7 日均市值 < 3M）与重新上架条件（市值 ≥10M / 池 ≥1M / 24h 成交额 ≥1M）都是产品需求定制，修改前先与需求方确认。
8. **合约侧**：标记价格 = 现货买一价与合约买一价的几何平均数；资金费率按 tier 分级（巨鲸 8h/±0.1% … 微型 1h/±2%）；散户持仓固定 2 倍杠杆；套利机制依赖资金费率方向收敛，别改成发散方向。
9. **性能设施**：`perfTimer`、`createFormatCache`、`gameStateRef` 批量同步、预计算查询表等是支撑 3.4 万行单组件的性能基座，重构时保留这些模式。
10. **存档兼容**：读取旧存档时必须做 schema 归一化（历史数据缺字段/类型不一致），`normalizeHeatMap`、`normalizeHeatMapEntry` 等兜底函数不要删除；改数据结构时保持向后兼容。

---

*本文档由交接方基于当前源码整理，核心机制参数均从代码摘录；标注「需人工补充」的项目请以实际环境为准。*