# 合约开局持仓与统计单位修复

## 问题与范围

- 散户仓位的 `quantity` 是开仓 USDT 名义金额；旧持仓量历史将其当作币数，再乘价格，导致 BTC 统计额外放大约 64,375 倍。
- 原开局散户单边规模为流通市值的 50%；过渡方案又把巨大模拟 DEX 资金池计入合约规模，仍然偏大。
- 本次只调整新开局合约规模、持仓历史单位及旧图表缓存兼容。UI、撮合、强平、资金费率、现货和 DEX 规则保持不变。

## 新开局参数

`getInitialRetailSideOpenInterestRatio(tier)` 返回每个方向的名义持仓/市场流通市值比例：

| Tier | 单边比例 | 多空合计比例 |
| --- | ---: | ---: |
| 6 巨鲸 | 1.5% | 3.0% |
| 5 巨型 | 1.2% | 2.4% |
| 4 大型 | 0.8% | 1.6% |
| 3 中型 | 0.6% | 1.2% |
| 2 小型 | 0.4% | 0.8% |
| 1 微型 | 0.3% | 0.6% |

初始化市场流通市值仍沿用 `currentPrice × (circulatingSupply - playerReservedAmount)`；不把 DEX `quoteReserve` 再加入合约仓位。既有每方向散户人数、杠杆随机数及多空生成顺序不变。

BTC 开局现价 64,375、市场流通量 19,740,000，市值为 1,270,762,500,000 USDT。每边为 19,061,437,500 USDT，多空合计 38,122,875,000 USDT（约 381.23 亿），不是几万 T。

这些是保守的游戏平衡参数，不是实时行情拟合。历史量级参考：[Cointelegraph，2024-10-21，BTC 期货 OI 达 405 亿美元](https://cointelegraph.com/news/bitcoin-open-interest-exceeds-40-billion-as-brushes-almost-70k)。现实交易所 OI 通常按合约单边计数，本游戏既有图表展示多空总敞口，不能将两者直接等同。

## 统一统计单位

`summarizeContractPositions` 只汇总，不修改仓位：

- 玩家：币数 = `quantity`；名义金额 = `value || quantity × entryPrice`。
- 散户：币数 = `quantity / entryPrice`，按每个仓位自身开仓价换算；名义金额 = `quantity`，不再乘现价。
- AI / 做市商：币数 = `quantity`；名义金额 = `quantity × entryPrice`。

多空分别返回；图表仍使用既有多空相加口径。

## 旧存档

历史点新增 `unitsVersion: 2`。读档和回合回退时，仅保留该版本的持仓量历史；旧历史缺少逐仓信息，不能可靠逆算，因此清除失真图表缓存，由后续回合重新记录。

真实仓位、玩家资金、成交及其他历史不受影响。初始化比例只适用于新游戏，不强行改写旧档的实际合约仓位。

## 验证与交付

- `scripts/contract-positions-check.mjs`：12 项断言，覆盖混合来源单位、逐仓开仓价换算、输入不可变、旧历史过滤、分层比例和 BTC 实际开局/三回合历史。
- 既有九套机制测试 71/71、回归 23/23 通过。
- 新版本两次同种子回归快照 0 差异。与旧数值基线有预期市场数字差异；未将刷新旧基线冒充为零行为变更。
- 单文件由 `npm run build` 后执行 `node scripts/build-standalone.mjs` 生成，包含版本标记 `BTC-OI-units-v2`。
- 最终单文件已断网验证开始游戏、推进三回合及五个主页面：无运行时错误，无外部 HTTP 请求。
