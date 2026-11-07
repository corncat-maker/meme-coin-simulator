# 充提币次回合卡死修复（2026-11-07）

## 已证实的根因

原统一结算 effect 在 pendingTransfers 中仍能看到已到期的转账时，会再次结算。同一个 effect 又向 Zustand 写入 tokens；store 的微任务通知触发同步重渲染，早于 React 本地 pendingTransfers 删除结果提交，于是形成反馈循环。

真实 UI 提交 100 USDT 提币后点击钱包快进，2 秒采样：store commit 101 次、tokens 写入 105 次、pendingTransfers/availableCapital/walletUsdt 各写 102 次，toast 写 103 次；当前第 1 回合仍展示同一条到期在途记录。暂停堆栈位于 React 同步渲染循环，不是 positions 删除引起的空指针。

## 修复边界

- 撤回上次错误删除，恢复提币提交时扣减/移除 CEX 现货持仓；与 playerTokenBalances.cexBalance 同步。合约持仓不改。
- settledTransferIdsRef 在任何状态写入前同步认领转账 ID；effect 重入不能重复结算。pending 删除提交后回收 ID；新游戏、读档、回退时清空认领集合，允许合法历史重放。
- 提交已扣来源，到账只给目的地记账，修复 USDT 重复扣款。
- 代币到账按增量应用于真实余额，保留 CEX/钱包其他余额和其他在途项，不以全零对象覆盖。
- 充值到账重新创建或累加 CEX 现货持仓，维持原有充值成本口径。
- AI 宏观套利使用到账后的物理库存及玩家 CEX 占用快照；库存更新增量合并到最新 token。钱包不等于 DEX 流动性池，提币不凭空增加 dexReserve。
- 没有实际变化时保留 tokens 原引用。现有 UI、BTC 单位修复与初始页面下载入口移除保留。

## 验证

- npx tsc -b、npm run build、npm run typecheck:all 成功。
- scripts/wallet-transfer-check.mjs：真实 UI 市价买入、USDT 双笔/双向、代币部分/全量提币、充值重建/累加、连续 11 回合：65/65、pageErrors=0。
- scripts/wallet-transfer-offline-check.mjs：实际生产单文件以 file:// 打开且断网，真实买入/充提币并继续 9 回合：42/42、pageErrors=0、外部请求=0。只读组件 props 验证，不注入余额或调用业务处理函数。
- 标准回归：6 回合、5 页签、7 张截图、23/23，页面错误及请求失败均为 0。
- 现存其他专项：现货 4、合约 14、合约落账 7、散户强平 7、玩家强平 7、下架 8、爆仓统计 5、BTC 单位 12，共 64/64。
- 额外对比实际上一份交付 HTML（完整修复版）和本次新 HTML：分别跑相同 6 回合/5 页签/7 截图，均 23/23，快照 SHA 前缀均 43f2c0fc5880，regression-compare 0 差异，证明没有提币时普通游戏与 UI 未改变。
- 更早的 tests/baseline 与当前为 68 处差异（历史 BTC 初始化数值、已移除初始下载入口等）；本次不刷新基线，不冒称与该陈旧基线 0 差异。
- npm run lint 仍失败：66 条 App 历史规则问题；本次新 walletTransfers 模块没有 lint 报错。没有为此改写其他业务。

## 交付

standalone/Meme币庄家模拟器-提币结算修复-20261107.html

1,554,739 bytes；SHA256 ec81a959b75c8fe374455534bfdb4a26444cb47cc1a2b52cc8a0865a6bfe9594。

生成方式：npm run build 后 node scripts/pack-offline.mjs。打包器拒绝覆盖已存在的输出路径；重新生成应显式给一个新文件名。