// ============ 类型定义 ============
export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 当回合 VWAP（用于成交额换算；历史/初始 K 线可能缺省） */
  vwap?: number;
  /** 当回合成交额（USDT；历史/初始 K 线可能缺省，读取端会回退计算） */
  turnover?: number;
  time?: number;
}

export interface Token {
  id: string;
  name: string;
  code: string;
  sector: string;
  initialMarketCap: number;
  initialPrice: number;
  currentPrice: number;
  circulatingSupply: number;
  totalSupply: number;
  marketCap: number;
  change24h: number;
  tier: number;
  // ========== CEX / DEX 宏观物理库存池 ==========
  // CEX 平台内的真实代币总库存（玩家 cexBalance 是其中一部分；后续用于 CEX 盘口物理约束）
  cexReserve: number;
  // DEX 流动性池内的代币总库存（后续用于链上 AMM 池与 AI 宏观套利）
  dexReserve: number;
  earlyHolders: number;
  athPrice: number;
  roundPriceChange: number;
  prevAvailableSupply: number;
  hourlyPrices: { hour: number; price: number }[];
  tokenType?: 'meme' | 'smart_contract' | 'blockchain';
  chain?: 'SOL' | 'ETH' | 'BSC' | 'TRON' | 'none';
  distributionMethod?: 'airdrop' | 'ico' | 'pow' | 'batch_airdrop';
  unlockPercent?: number;
  projectDescription?: string;
  marketScore?: number;
  isPlayerCreated?: boolean;
  createdAt?: number;
  initialHeat?: number;
  unvestedSupply?: number;
  playerReservedAmount?: number;
  dailyUnlockPercent?: number;
  marketingUsedThisRound?: boolean;
  updateUsedThisRound?: boolean;
  lastClaimRound?: number;
  volumeSinceLastClaim?: number;
  autoBurnRevenue?: boolean;
  // 代币分配比例（用于分批空投后续解锁）
  liquidityPercent?: number; // 流动性比例
  marketMakerPercent?: number; // 做市商比例
  // 分批空投后续解锁分配比例
  subsequentReservedPercent?: number; // 后续解锁自留比例
  subsequentLiquidityPercent?: number; // 后续解锁流动性比例
  subsequentMarketMakerPercent?: number; // 后续解锁做市商比例
  // 代币增发协议
  mintingEnabled?: boolean; // 是否启用代币增发协议
  // PoW预挖相关
  preminePercent?: number; // 预挖比例（PoW模式）
  premineReservedPercent?: number; // 预挖部分自留比例
  premineLiquidityPercent?: number; // 预挖部分流动性比例
  premineMarketMakerPercent?: number; // 预挖部分做市商比例
  // 新增字段
  projectFundPool?: number;
  heat?: number;
  marketingEffect?: 'fomo' | 'panic' | null;
  marketingEffectRounds?: number;
  lastMarketingRound?: number;
  lastUpdateRound?: number;
  lastRoundChange?: number;
  trendStartPrice?: number;
  trendDirection?: 'up' | 'down' | 'flat' | null;

  // 涨幅/跌幅加速机制相关
  prevHoldingRatio?: number; // 上回合末持仓占比（玩家+AI角色）
  reservedReceivedRound?: number; // 获得自留代币的回合（该回合不触发涨幅/跌幅加速）
  // CEX上架状态
  cexListed?: boolean; // 是否已上架CEX（所有预设代币默认上架）
  // 合约市场上架状态
  futuresListed?: boolean; // 是否已上架合约市场（下架机制仅下架合约，不下架现货CEX）
  delistedRound?: number; // 下架回合（用于显示下架时间）
  // 初始化未上架合约机制：初始化时流动性不足（<10万USDT）的代币暂不上架合约，满足流动性条件后公告上架
  futuresPendingRound?: number; // 上架公告发出的回合（倒计时开始）
  futuresScheduledRound?: number; // 计划正式上架的回合（公告回合 + 72）
  delistReason?: DelistReason; // 下架原因
  // 下架倒计时机制：触发下架条件后不立即下架，先弹窗通知，7天（168回合）后正式下架
  delistPendingRound?: number; // 下架通知发出的回合（倒计时开始）
  delistScheduledRound?: number; // 计划正式下架的回合（通知回合 + 168）
  // 下架强制平仓机制：下架前24小时记录的平均价格；残留仓位平均开仓价（下回合现货盘口生成基准价）
  delistAvgPrice?: number; // 下架前24小时记录的近24小时平均价格
  delistSpotBasePrice?: number; // 残留仓位平均开仓价（用于下回合现货盘口生成基准价，仅生效一回合）
  // 观察标签机制（24h涨跌幅超阈值触发，持续14天后恢复普通标签）
  watchStartRound?: number; // 观察标签开始回合
  watchEndRound?: number;   // 观察标签结束回合（当前回合小于该值时处于观察状态）
  // 突发事件机制（黑客攻击：当回合下跌，随后7天暂停现货交易，仅保留合约交易）
  hackStartRound?: number; // 黑客攻击开始回合（当回合下跌，暂不停牌）
  hackEndRound?: number;   // 黑客攻击结束回合（当前回合小于该值且非攻击当回合时现货停牌）
  // 突发事件机制扩展（项目方钱包被盗/监管叫停复用现货停牌；新增合约禁开仓、做市商破产）
  spotSuspendEventId?: string;       // 当前现货暂停事件ID（用于UI文案，与hackStartRound/hackEndRound配合）
  futuresOpenBlockEndRound?: number; // 合约暂停开仓结束回合（监管叫停/保险基金不足：仅允许平仓）
  futuresOpenBlockEventId?: string;  // 当前合约禁开仓事件ID（用于UI文案）
  mmBankruptEndRound?: number;       // 做市商破产结束回合（现货/合约盘口订单生成减少50%）
  // 历史市值记录（用于检测操纵）
  marketCapHistory?: { round: number; marketCap: number }[]; // 最近24小时的市值记录
  // 近7日市值记录（用于流动性不足下架判断：近7日平均市值 < 3M）
  marketCapHistory7d?: { round: number; marketCap: number }[]; // 最近7日（168回合）的市值记录
  // 初始流动性池USDT（用于检测诈骗）
  initialLiquidityUsdt?: number;
  // 24小时强平金额记录（用于检测合约操纵）
  liquidationHistory?: {
    round: number;
    amount: number;
    /** 分来源拆解：仅统计被强制平仓仓位的名义价值（不含 ADL / 主动平仓） */
    retailAmount?: number;
    playerAmount?: number;
    aiAmount?: number;
  }[]; // 每回合强平金额
  liquidationAmount24h?: number; // 24小时累计强平金额
  // 交易历史记录（用于多因子波动引擎和K线高低价计算）
  tradeHistory?: { round: number; side: 'buy' | 'sell'; amount: number; valueUsd: number; price: number; market: 'cex' | 'dex' }[];
  // 流动性深度历史（用于计算流动性深度变化）
  liquidityDepthHistory?: { round: number; bidDepth: number; askDepth: number; poolDepth: number }[];
  // ========== 随机波动加成机制（异常大波动后波动率提升） ==========
  // 当某代币因事件或玩家挂单一回合涨跌幅超过随机波动机制波动率上限时，记该回合波动为 n%，
  // 后续每回合随机波动率提升 n%/10（上限与下限同步提升），加成每回合衰减10%，10回合后消失；
  // 最高价最低价的波动同步提升 n%/20
  volBoostPct?: number; // 当前波动率加成（小数形式，如0.01表示1%），每回合衰减10%
  volBoostRounds?: number; // 加成剩余回合数（初始10，每回合减1，为0时清除）
}

export interface Position {
  id: string;
  tokenId: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  pnl?: number;
  pnlPercent?: number;
  profitLoss?: number; // 兼容旧字段名
  isLpToken?: boolean; // 是否为LP代币
  tokenAmount?: number; // LP代币对应的代币数量
  quoteAmount?: number; // LP代币对应的USDT数量
}

// ============ 玩家资产（宏观库存池视角：CEX 余额 / 链上钱包 / 在途资金） ============
// 玩家在单一代币上的资产分布。cexBalance 属于 token.cexReserve 的一部分；
// walletBalance 独立于 CEX/DEX 两个池子；pending* 为充提币延迟结算期间的在途数量。
export interface PlayerTokenBalance {
  cexBalance: number; // 玩家在 CEX 的可用余额（属于 token.cexReserve 的一部分）
  walletBalance: number; // 玩家链上钱包余额（独立于池子）
  pendingCex: number; // 在途：正在充值到 CEX、尚未结算的数量
  pendingWallet: number; // 在途：正在提现到钱包、尚未结算的数量
}

// 玩家账户（宏观库存池视角的账户快照；tokenBalances 按 tokenId 索引）
export interface Player {
  availableCapital: number; // CEX 可用 USDT
  frozenCapital: number; // CEX 冻结 USDT
  tokenBalances: Record<string, PlayerTokenBalance>;
}

// ============ Web3 链上钱包（第三部分：跨系统流转） ============
// 充提币在途记录：提交后进入 pending，下一回合到账
export interface PendingTransfer {
  id: string;
  direction: 'cexToWallet' | 'walletToCex';
  assetKind: 'usdt' | 'token';
  tokenId?: string;
  amount: number;
  submitRound: number; // 提交申请的回合
  settleRound: number; // 到账回合（submitRound + 1）
}

// 玩家在 DEX 池子中的流动性份额（链上钱包资产）
export interface WalletLpPosition {
  tokenId: string;
  shares: number; // LP 份额（按池子 lpTokenSupply 计算）
  tokenAmount: number; // 份额对应的代币数量
  quoteAmount: number; // 份额对应的 USDT 数量
}

// 【第五部分】每回合结束时的 CEX 库存量快照（用于数据页库存走势与抛压预警）
export interface CexReserveHistoryPoint {
  round: number;
  reserve: number;
}

// ============ 质押借币（AAVE / Compound / MakerDAO） ============
export type LoanProtocolId = 'aave' | 'compound' | 'makerdao';

export interface LoanPosition {
  id: string;
  tokenId: string; // 质押代币ID
  protocol: LoanProtocolId; // 借出协议
  collateralQuantity: number; // 质押代币数量（该部分不可用于现货/DEX卖出或添加流动性）
  principal: number; // 借款本金（USDT）
  startRound: number; // 起息回合（部分还款后重置为还款回合，已结利息计入 accruedInterest）
  accruedInterest: number; // 已结算利息（部分还款时累计）
  tierAtBorrow: number; // 借款时代币 tier（用于 tier 降级提醒）
  tierNoticeRound?: number; // tier 降级提醒触发回合
  tierNoticeDeadlineRound?: number; // 需在 3 天内（72 回合）赎回的截止回合
}

export interface Order {
  id: string;
  tokenId: string;
  side: 'buy' | 'sell';
  type?: 'market' | 'limit';
  orderType?: 'market' | 'limit'; // 兼容字段
  price: number;
  quantity: number;
  filledQuantity: number;
  status: 'pending' | 'partial' | 'filled' | 'cancelled';
  createdAt: number;
  totalCost?: number;
}

export interface OrderHistory {
  id: string;
  tokenId: string;
  tokenCode: string;
  tokenName: string;
  side: 'buy' | 'sell';
  type?: 'market' | 'limit';
  orderType?: 'market' | 'limit'; // 兼容字段
  price: number;
  quantity: number;
  avgPrice?: number;
  totalCost?: number;
  amount?: number; // 兼容字段
  fee?: number; // 兼容字段
  timestamp?: number;
  filledAt?: number; // 兼容字段
  tag?: string; // 业务标签（如：强制清算）
}


export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
  isPlayer?: boolean; // 标记是否为玩家订单
  orderId?: string; // 玩家订单ID，用于跟踪成交
  isADL?: boolean; // 标记是否为ADL订单
  adlPositionId?: string; // ADL订单对应的持仓ID
  adlSide?: 'long' | 'short'; // ADL订单对应的持仓方向（多头或空头）
  adlOwnerType?: 'player' | 'retail' | 'ai' | 'mm'; // ADL订单对应的持仓所有者类型
  adlOwnerId?: string; // ADL订单对应的AI交易员/做市商ID
  isAI?: boolean; // 标记是否为AI订单
  traderId?: string; // AI交易员ID
  marketMakerId?: string; // AI做市商ID
  isAMM?: boolean; // 标记是否为AMM流动性池订单（DEX模式）
  isIssuanceOrder?: boolean; // 标记是否为增发卖单
}

export interface Level2OrderBook {
  /** 【AI宏观套利】本回合被撮合的 AI 套利限价单成交明细 */
  tokenId?: string; // 币种ID，用于AI交易时识别订单簿对应的币种
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  lastPrice: number;
  highPrice: number;
  lowPrice: number;
  volatilityMultiplier?: number;
  // 新增：卖盘总量（用于计算抛压）
  totalAskQuantity: number;
  // 新增：买盘总量
  totalBidQuantity: number;
  // 新增：玩家订单在盘口撮合中的成交详情 (orderId -> { quantity, avgPrice })
  playerOrderFills?: Record<string, { quantity: number; avgPrice: number }>;
  // 新增：市场模式标识（CEX/DEX）
  marketMode?: 'cex' | 'dex';
  // 新增：AMM流动性池信息（仅DEX模式）
  ammPool?: LiquidityPool;
  // 新增：标记代币已下架（下架后盘口为空，不再生成新订单）
  isDelisted?: boolean;
  // 新增：标记现货交易暂停（黑客攻击停牌，盘口为空，仅保留合约交易）
  isSpotSuspended?: boolean;
}

// ============ AMM流动性池类型 ============
export interface LiquidityPool {
  tokenId: string;           // 代币ID
  tokenReserve: number;      // 代币储备量
  quoteReserve: number;      // 报价货币（USDT）储备量
  k: number;                 // 恒定乘积 k = tokenReserve * quoteReserve
  fee: number;               // 交易手续费率（默认0.3%）
  lpTokenSupply: number;     // LP代币总供应量
  lastPrice: number;         // 上次交易价格
  priceImpact: number;       // 价格影响系数
}

// AMM流动性池状态映射（每个代币一个池子）
export interface LiquidityPoolMap {
  [tokenId: string]: LiquidityPool;
}

export interface MarketSentiment {
  overall: number;
  fearIndex: number;
  greedIndex: number;
  trend: 'bullish' | 'bearish' | 'neutral';
}

// 社区帖子
export interface CommunityPost {
  id: string;
  tokenId: string;
  tokenCode: string;
  tokenName: string;
  content: string;
  sentiment: 'greedy' | 'fearful' | 'neutral'; // 帖子情绪
  likes: number;
  comments: number;
  timestamp: number; // 发布时间（回合数）
  isLiked: boolean; // 当前玩家是否已点赞
  authorName: string; // 发帖者名称
  authorType: 'retail' | 'top_trader' | 'whale'; // 发帖者类型：散户、顶级交易员或巨鲸
  authorId?: string; // 顶级交易员/巨鲸ID
  emotion?: 'happy' | 'angry' | 'neutral'; // 顶级交易员/巨鲸情绪（用于特殊标识）
}

// ============ 存档相关类型 ============

// 存档数据结构
export interface SaveData {
  slotId: number;
  saveTime: number;
  dayCount: number;
  currentRound: number;
  totalAsset: number;
  roi: number;
  tokens: Token[];
  positions: Position[];
  // 玩家资产分布（CEX 余额/链上钱包/在途资金），兼容旧存档：缺省时由 positions 迁移
  playerTokenBalances?: Record<string, PlayerTokenBalance>;
  // Web3 链上钱包（第三部分，兼容旧存档：缺省为 0 / 空）
  walletUsdt?: number;
  pendingTransfers?: PendingTransfer[];
  walletLpPositions?: Record<string, WalletLpPosition>;
  cexReserveHistory?: Record<string, CexReserveHistoryPoint[]>;
  orders: Order[];
  orderHistory: OrderHistory[];
  loanPositions?: LoanPosition[]; // 质押借币仓位（兼容旧存档，缺省为空数组）
  availableCapital: number;
  frozenCapital: number;
  initialCapital: number;
  assetHistory: number[];
  tokenCandlesMap: Record<string, Candle[]>;
  tokenOrderBookMap: Record<string, Level2OrderBook>;
  futuresPositions: FuturesPosition[];
  futuresOrders: FuturesOrder[];
  retailPositions: RetailPosition[];
  futuresOrderBookMap: Record<string, FuturesOrderBook>;
  futuresTradeHistory: FuturesTradeRecord[];
  fundingFeeHistory: FundingFeeRecord[];
  lastFundingSettlement: number;
  // 资金费率按tier结算机制（可选字段，兼容旧存档）
  fundingBasisHistory?: Record<string, number[]>; // 每个代币最近N回合的基差历史（原始值，未截断）
  lastFundingSettlementByToken?: Record<string, number>; // 每个代币上次资金费率结算回合
  // 热点板块机制（支持两个板块）
  hotSectors: string[]; // 当前热点板块ID数组（最多2个）
  hotSectorStartRound: number; // 热点板块开始回合
  hotSectorDay: number; // 当前是热点第几天（1-3）
  hotSectorVolumeBonus: number[]; // 每个热点板块的成交量加成
  hotSectorTokens: Record<string, string[]>; // 每个热点板块享受加成的代币ID列表
  // 恐惧贪婪指数
  fearGreedIndex: number; // 恐惧贪婪指数（0-100）
  lastFearGreedUpdateRound: number; // 上次更新恐惧贪婪指数的回合
  // 旧存档兼容字段（可选，使用 _old 前缀避免与数组字段冲突）
  _oldHotSector?: string; // 旧版单个热点板块ID
  _oldHotSectorVolumeBonus?: number; // 旧版单个成交量加成
  communityPosts: CommunityPost[];
  lastPostRefreshRound: number;
  marketSentiment: MarketSentiment;
  retailActivity: string[];
  tokenHeatMap: Record<string, { heat: number; duration: number; cap?: number; fullStreak?: number; zeroStreak?: number }>;
  // AI交易员与庄家
  aiTraders: AITrader[];
  aiMarketMakers: AIMarketMaker[];
  // AMM流动性池
  liquidityPools: LiquidityPoolMap;
  // 历史图表数据（聪明钱多空比/多空人数比/大户多空比/合约持仓量）
  longShortRatioHistory?: Array<{ round: number; tokenId: string; longPercent: number; shortPercent: number; ratio: number }>;
  longShortCountHistory?: Array<{ round: number; tokenId: string; longCount: number; shortCount: number; ratio: number }>;
  whaleRatioHistory?: Array<{ round: number; tokenId: string; playerLong: number; playerShort: number; aiTraderLong: number; aiTraderShort: number; marketMakerLong: number; marketMakerShort: number }>;
  contractPositionHistory?: Array<{ round: number; tokenId: string; totalLongQuantity: number; totalShortQuantity: number; totalLongValue: number; totalShortValue: number; avgPrice: number; unitsVersion?: 2 }>;
  // 每日市场事件机制
  eventHistory?: Record<string, number>; // 事件ID -> 上次触发的天数
  todayEvent?: { day: number; eventId: string } | null; // 今日待触发事件（20:00公布）
  activeEvent?: { eventId: string; type: 'bull' | 'bear'; level: number; day: number; announcementRound: number } | null; // 当前生效事件
  // 社区公告（兼容旧存档，缺省为空数组）
  announcements?: Announcement[];
  // 风控机制（兼容旧存档，缺省为开启）
  riskControlEnabled?: boolean; // 涨幅风控开关：代币24小时涨幅超过5000%时熔断（效果同监管叫停）
  accountRiskControlEnabled?: boolean; // 账户风控开关：近24小时盈利率超过10000%时暂停游戏
  accountRiskBypassed?: boolean; // 已输入审核秘钥，本存档不再触发账户风控
}

// 下架原因类型
// liquidity: 流动性不足；manipulation: 操纵嫌疑；fraud: 诈骗嫌疑；dev: 开发者指定
export type DelistReason = 'liquidity' | 'manipulation' | 'fraud' | 'dev';

// 社区公告（市场事件/突发事件/代币下架/合约上架）
export interface Announcement {
  id: string;
  type: 'market' | 'sudden' | 'delist' | 'list'; // 公告类型：每日市场事件/突发事件/代币下架/合约上架
  title: string;
  content: string;
  round: number; // 公告发生回合
  day: number; // 公告发生天数
  tokenCode?: string; // 关联代币代码（可选）
  tokenName?: string; // 关联代币名称（可选）
  status?: 'pending' | 'executed'; // 下架/上架公告状态：待执行/已执行
  delistRound?: number; // 下架公告：计划下架回合
  listRound?: number; // 上架公告：计划正式上架回合
}

// 存档槽位信息
export interface SaveSlot {
  slotId: number;
  exists: boolean;
  saveTime: number;
  dayCount: number;
  totalAsset: number;
  roi: number;
}

// ============ 永续合约相关类型 ============

// 散户持仓（市场盘口成交产生的仓位）
export interface RetailPosition {
  id: string;
  tokenId: string;
  side: 'long' | 'short'; // 做多或做空
  entryPrice: number; // 开仓价格
  quantity: number; // 持仓数量（金额单位）
  leverage: number; // 杠杆倍数（固定2倍）
  margin: number; // 保证金
  liquidationPrice: number; // 强平价格
  createdAt: number; // 创建时间（回合）
}

// 玩家合约持仓
export interface FuturesPosition {
  id: string;
  tokenId: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number; // 持仓数量（代币数量）
  value: number; // 持仓金额（保证金 * 杠杆）
  leverage: number; // 杠杆倍数（玩家可选，按代币分级限制最大杠杆：BTC/ETH 150x，其余按tier递减）
  margin: number; // 保证金
  liquidationPrice: number; // 强平价格
  unrealizedPnl: number; // 未实现盈亏
  roe: number; // 收益率
  marginMode?: 'isolated' | 'cross'; // 保证金模式：逐仓/全仓（默认全仓）
  pendingClose?: boolean; // 是否有待成交的平仓单
  closeOrderId?: string; // 关联的平仓单ID
}

// 合约订单
export interface FuturesOrder {
  id: string;
  tokenId: string;
  orderType: 'market' | 'limit';
  side: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  price: number;
  quantity: number; // 金额单位
  filledQuantity: number; // 已成交金额
  filledTokenQty?: number; // 已成交代币数量
  totalCost?: number; // 累计成交金额
  status: 'pending' | 'filled' | 'cancelled' | 'liquidated';
  createdAt: number;
  leverage: number; // 杠杆倍数
  margin: number; // 保证金
  marginMode?: 'isolated' | 'cross'; // 保证金模式（挂单时的模式）
}

// 合约成交记录
export interface FuturesTradeRecord {
  id: string;
  tokenId: string;
  tokenCode: string;
  orderType: 'market' | 'limit'; // 订单类型：市价/限价
  action: 'open' | 'close' | 'liquidation' | 'adl'; // 行为：开仓/平仓/强平/ADL
  side: 'long' | 'short'; // 方向：多/空
  price: number; // 成交均价
  quantity: number; // 成交代币数量
  value: number; // 成交金额
  pnl?: number; // 盈亏（平仓、强平、ADL时显示）
  margin?: number; // 保证金
  fundingFee?: number; // 资金费率结算金额
  timestamp: number; // 成交时间（回合）
}

// 资金费率历史记录
export interface FundingFeeRecord {
  id: string;
  tokenId: string;
  tokenCode: string;
  round: number; // 结算回合
  fundingRate: number; // 资金费率
  positionSide: 'long' | 'short'; // 持仓方向
  positionValue: number; // 持仓金额
  fee: number; // 支付/收取的资金费率（正数为收取，负数为支付）
  timestamp: number;
}

// 永续合约订单簿
export interface FuturesOrderBook {
  bids: OrderBookEntry[]; // 买单（做多）
  asks: OrderBookEntry[]; // 卖单（做空）
  lastPrice: number; // 最新价格
  markPrice: number; // 标记价格（用于计算强平）
  indexPrice: number; // 指数价格（现货价格）
  fundingRate: number; // 资金费率
  nextFundingTime: number; // 下次结算时间
  totalBidQuantity: number;
  totalAskQuantity: number;
  longOpenInterest?: number; // 多头持仓量
  shortOpenInterest?: number; // 空头持仓量
  // 合约市场独立的玩家订单成交记录
  playerOrderFills?: Record<string, { filledQuantity: number; filledTokenQty: number; avgPrice: number }>;
  // 套利吃单信息（用于生成散户持仓）
  arbitrageFills?: {
    side: 'long' | 'short'; // 套利方向：正费率时做空合约(long side吃买单)，负费率时做多合约(short side吃卖单)
    quantity: number; // 吃单数量（代币数量）
    value: number; // 吃单金额
    avgPrice: number; // 平均成交价格
  }[];
}

// ============ AI交易员与庄家类型 ============

// AI交易员持仓
export interface AIPosition {
  tokenId: string;
  quantity: number; // 持仓数量
  avgCost: number; // 平均成本
}

// AI合约持仓
export interface AIFuturesPosition {
  tokenId: string;
  side: 'long' | 'short';
  quantity: number; // 持仓数量
  entryPrice: number; // 开仓价格
  leverage: number; // 杠杆倍数
  margin: number; // 保证金
  liquidationPrice: number; // 强平价格
  takeProfitPrice: number; // 止盈价格（与强平价格形成盈亏比）
  marginMode?: 'isolated' | 'cross'; // 保证金模式（AI统一全仓）
}

// AI限价单
export interface AILimitOrder {
  id: string;
  tokenId: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  filledQuantity: number;
  frozenCapital: number; // 买单冻结的资金
  frozenQuantity: number; // 卖单冻结的持仓数量
  createdAtRound: number;
  traderId?: string;
  marketMakerId?: string;
}

// AI交易员类型
export type AITraderType = 'trend_follower' | 'arbitrageur' | 'random_trader';

// AI交易员
export interface AITrader {
  id: string;
  name: string; // 散户风格名字
  type: AITraderType; // 交易员类型：趋势交易员、套利机器人、随机交易员
  initialCapital: number; // 初始资金
  availableCapital: number; // 可用资金
  positions: AIPosition[]; // 现货持仓
  futuresPositions: AIFuturesPosition[]; // 合约持仓
  assetHistory: number[]; // 资产历史（用于计算收益率）
  lastTradeRound: number; // 上次交易回合
  tradingStyle: 'aggressive' | 'moderate' | 'conservative'; // 交易风格
  pendingLimitOrders: AILimitOrder[]; // 挂单中的限价单
  // 趋势交易员参数
  emaShort: number; // 短期EMA周期（默认12）
  emaLong: number; // 长期EMA周期（默认26）
  priceHistory: Record<string, number[]>; // 各代币价格历史（用于EMA计算）
  lastSignal: 'long' | 'short' | 'none'; // 上次信号
  // 套利机器人参数
  arbThreshold: number; // 套利阈值（默认0.005 = 0.5%）
  maxSlippage: number; // 最大滑点（默认0.02 = 2%）
  cooldownRounds: number; // 冷却回合数
  lastArbRound: number; // 上次套利回合
  arbProfitHistory: number[]; // 套利收益历史
}

// AI庄家操盘阶段
// accumulate=吸筹 test=试盘 pump=拉升 wash=洗盘 distribute=高位派发 dump=砸盘 idle=空闲
export type MarketMakerPhase = 'accumulate' | 'test' | 'pump' | 'wash' | 'distribute' | 'dump' | 'idle';

// 做市商历史做市记录
export interface MarketMakerHistory {
  tokenId: string;
  tokenName: string;
  tokenCode: string;
  startRound: number;
  endRound: number;
  startAsset: number; // 开始做市时的资产
  endAsset: number; // 结束做市时的资产
  profit: number; // 该代币做市收益
  profitPercent: number; // 收益率
}

// AI庄家
export interface AIMarketMaker {
  id: string;
  name: string; // 机构风格名字
  initialCapital: number; // 初始资金
  availableCapital: number; // 可用资金
  positions: AIPosition[]; // 现货持仓（隐藏）
  futuresPositions: AIFuturesPosition[]; // 合约持仓（隐藏）
  assetHistory: number[]; // 资产历史（隐藏）
  targetTokenId: string | null; // 目标代币
  phase: MarketMakerPhase; // 当前操盘阶段
  phaseStartRound: number; // 阶段开始回合
  phaseTargetPrice: number; // 阶段目标价格
  accumulatedQuantity: number; // 已吸筹数量
  targetControlRatio: number; // 目标筹码控制度 (0.5-0.8)
  pumpTargetPercent: number; // 目标拉升幅度 (50%-400%)
  pumpWashCycle: number; // 拉升-洗盘循环次数
  totalPumpRounds: number; // 累计拉升回合数
  history: MarketMakerHistory[]; // 历史做市记录
  cycleStartAsset: number; // 当前做市周期开始时的资产
  cycleStartRound: number; // 当前做市周期开始回合
  // 限价单策略相关
  lastPumpPrice: number; // 上次拉升价格
  pumpStepIndex: number; // 拉升步骤索引
  washTargetPrice: number; // 洗盘目标价格
  dumpStartPrice: number; // 砸盘开始价格
  dumpRemainingRatio: number; // 砸盘剩余筹码比例
  // 成本价追踪
  avgCostPrice: number; // 吸筹阶段的平均成本价
  totalCostSpent: number; // 吸筹阶段总花费
  totalBoughtQuantity: number; // 吸筹阶段买入总量
  pendingLimitOrders: AILimitOrder[]; // 挂单中的限价单
  // 连续上涨检测
  cycleStartPrice: number; // 做市周期开始时的价格
  consecutiveUpRounds: number; // 连续上涨回合数（做市商内部压价策略）
  lastRoundPrice: number; // 上回合价格
  suppressModeActive: boolean; // 是否处于压价模式
  // 单次市价买入均价压价机制
  lastMarketBuyPrice: number; // 最近一次市价买入的均价（用于压价触发判断）
  suppressTriggerPrice: number; // 压价触发时的参考价格
  isSuppressing: boolean; // 是否正在压价中（停止市价买入）
  pendingSuppressOrders: string[]; // 压价期间挂出的限价卖单ID列表
  suppressRounds: number; // 压价回合计数器
  priceBeforeSuppress: number; // 压价前价格
  // 做市开始价格和限价单撤单跟踪
  marketMakingStartPrice: number; // 做市开始时的价格，用于检测涨幅
  lastRoundLimitOrderIds: string[]; // 上一回合挂出的限价单ID列表，用于撤单
  twoRoundsAgoLimitOrderIds: string[]; // 2回合前挂出的限价单ID列表，用于撤单
  // 新增：吸筹阶段第一次买入价格压价机制
  firstBuyPrice: number; // 吸筹阶段第一次买入的价格（用于压价触发判断）
  firstBuyPriceSuppressActive: boolean; // 是否处于首次买入价压价模式
  firstBuySuppressRounds: number; // 首次买入价压价回合计数器
  firstBuySuppressOrderId: string; // 首次买入价压价订单ID
  // 新增：盈利100%强制砸盘机制
  forceDumpActive: boolean; // 是否处于强制砸盘模式
  forceDumpRounds: number; // 强制砸盘已进行回合数
  forceDumpOrderId: string; // 强制砸盘订单ID
  // 新增：吸筹阶段买入-等待-卖出-等待循环机制
  accumulationCyclePhase: 'buy' | 'wait1' | 'sell' | 'wait2'; // 吸筹循环阶段
  lastMarketBuyQuantity: number; // 上次市价买入的数量
  lastMarketBuyRound: number; // 上次市价买入的回合
  // 新增：吸筹阶段涨幅超30%压价机制
  priceBeforeAccumulation: number; // 吸筹阶段开始前一回合的币价
  accumulationSuppressActive: boolean; // 是否处于吸筹压价模式（涨幅超30%触发）
  accumulationSuppressRounds: number; // 吸筹压价回合计数器
  accumulationSuppressOrderId: string; // 吸筹压价订单ID
  // 新增：多代币并行做市
  secondaryTargetTokenId: string | null; // 第二个目标代币ID
  secondaryPhase: MarketMakerPhase; // 第二个代币的阶段
  secondaryPhaseStartRound: number; // 第二个代币阶段开始回合
  secondaryPhaseTargetPrice: number; // 第二个代币阶段目标价格
  secondaryAccumulatedQuantity: number; // 第二个代币已吸筹数量
  secondaryTargetControlRatio: number; // 第二个代币目标筹码控制度
  secondaryPumpTargetPercent: number; // 第二个代币目标拉升幅度
  secondaryPumpWashCycle: number; // 第二个代币拉升-洗盘循环次数
  secondaryTotalPumpRounds: number; // 第二个代币累计拉升回合数
  secondaryLastPumpPrice: number; // 第二个代币上次拉升价格
  secondaryPumpStepIndex: number; // 第二个代币拉升步骤索引
  secondaryWashTargetPrice: number; // 第二个代币洗盘目标价格
  secondaryAvgCostPrice: number; // 第二个代币平均成本价
  secondaryTotalCostSpent: number; // 第二个代币总花费
  secondaryTotalBoughtQuantity: number; // 第二个代币买入总量
  secondaryFirstBuyPrice: number; // 第二个代币首次买入价格
  secondaryCycleStartAsset: number; // 第二个代币做市周期开始资产
  secondaryCycleStartRound: number; // 第二个代币做市周期开始回合
  secondaryMarketMakingStartPrice: number; // 第二个代币做市开始价格
  secondaryLastRoundLimitOrderIds: string[]; // 第二个代币上一回合限价单ID列表
  // 新增：已完成做市的代币冷却期
  completedTokens: { tokenId: string; cooldownEndRound: number }[]; // 已完成做市的代币及冷却期结束回合
  // 新增：持仓<40%挂单砸盘后结束做市机制
  aggressiveDumpEndMarketMaking: boolean; // 是否已触发持仓<40%挂单砸盘结束做市
  aggressiveDumpOrderId: string; // 持仓<40%挂单砸盘的订单ID
  // 新增：流动性提供相关
  liquidityProvided: Record<string, { lpTokens: number; tokenAmount: number; quoteAmount: number }>; // 已提供的流动性
  targetLiquidityLevel: number; // 目标流动性水平（0-1）
  liquidityScore: number; // 当前流动性评分
  // 新增：流动性板块分配机制
  liquiditySectorId: string | null; // 分配的流动性板块ID
  liquiditySectorAssignedRound: number; // 板块分配回合（用于判断是否需要重新抽取）
  liquidityTargetTokenIds: string[]; // 目标代币ID列表（板块内成交量倒数前三）
  liquidityCapital: number; // 用于流动性提供的资金（50%资金）
  // 新增：做市绩效评估
  performanceMetrics: {
    totalTrades: number; // 总交易次数
    winRate: number; // 胜率
    avgProfitPercent: number; // 平均收益率
    maxDrawdown: number; // 最大回撤
    sharpeRatio: number; // 夏普比率
  };
  // 新增：冷却期机制
  cooldownActive: boolean; // 是否处于冷却期
  cooldownEndRound: number; // 冷却期结束回合
  // 新增：试盘阶段状态
  testStartPrice: number; // 试盘开始价格
  testRounds: number; // 试盘已进行回合数
  testSellOrderId: string; // 试盘卖单ID
  testBuyOrderId: string; // 试盘买单ID
  testPassed: boolean; // 试盘是否通过（抛压小）
  // 新增：高位派发阶段状态
  distributeStartPrice: number; // 派发开始价格
  distributeSellRatio: number; // 已派发比例（0-1）
  distributeRounds: number; // 派发已进行回合数
  distributeSupportOrderId: string; // 派发护盘买单ID
  distributeStartHoldings: number; // 派发开始时持仓量（用于计算实际派发比例）
  // 新增：对倒洗售状态
  washTradeCooldown: number; // 对倒洗售冷却回合
  washTradeBuyOrderId: string; // 对倒买单ID
  washTradeSellOrderId: string; // 对倒卖单ID
  washTradeRound: number; // 对倒回合计数
  // 新增：消息面配合（公告去重）
  announcedPumpRound: number; // 已发布拉升公告的回合（0=未发布）
  announcedDistributeRound: number; // 已发布派发公告的回合（0=未发布）
  // 新增：成交量造假/活跃度记录
  washTradeVolume: number; // 累计对倒成交量（用于详情展示）
}

// 多空比历史记录
export interface LongShortRatioHistory {
  round: number;
  ratio: number; // 多空比
  longValue: number; // 多头持仓金额
  shortValue: number; // 空头持仓金额
}

// 多空人数比历史记录
export interface LongShortCountHistory {
  round: number;
  tokenId?: string;
  longCount: number;
  shortCount: number;
  ratio: number;
}

// 大户多空比历史记录
export interface WhaleRatioHistory {
  round: number;
  tokenId?: string;
  playerLong: number;
  playerShort: number;
  aiTraderLong: number;
  aiTraderShort: number;
  marketMakerLong: number;
  marketMakerShort: number;
}