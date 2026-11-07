import type { AITrader, AIMarketMaker } from '../types';

// ============ 名称-ID映射（全局常量） ============
// 预定义的板块ID映射
export const SECTOR_ID_MAP: Record<string, number> = {
  'meme': 1, 'defi': 2, 'layer1': 3, 'layer2': 4, 'gaming': 5,
  'nft': 6, 'ai': 7, 'infrastructure': 8, 'privacy': 9, 'storage': 10
};

export const SECTOR_NAME_MAP: Record<number, string> = Object.fromEntries(
  Object.entries(SECTOR_ID_MAP).map(([k, v]) => [v, k])
);

// 预定义的代币类型ID映射
export const TOKEN_TYPE_ID_MAP: Record<string, number> = { 'meme': 1, 'smart_contract': 2, 'blockchain': 3 };
export const TOKEN_TYPE_NAME_MAP: Record<number, string> = Object.fromEntries(
  Object.entries(TOKEN_TYPE_ID_MAP).map(([k, v]) => [v, k])
);

// 预定义的公链ID映射
export const CHAIN_ID_MAP: Record<string, number> = { 'SOL': 1, 'ETH': 2, 'BSC': 3, 'TRON': 4, 'none': 5 };
export const CHAIN_NAME_MAP: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_ID_MAP).map(([k, v]) => [v, k])
);

// 预定义的发行方式ID映射
export const DISTRIBUTION_ID_MAP: Record<string, number> = { 'airdrop': 1, 'ico': 2, 'pow': 3, 'batch_airdrop': 4 };
export const DISTRIBUTION_NAME_MAP: Record<number, string> = Object.fromEntries(
  Object.entries(DISTRIBUTION_ID_MAP).map(([k, v]) => [v, k])
);

// 自定义名称映射（运行时动态扩展）
export let customNameCounter = 1000;
export const customNameToId: Record<string, number> = {};
export const customIdToName: Record<number, string> = {};

export const encodeName = (name: string | undefined | null): number => {
  if (!name) return 0;
  // 先查预定义映射
  if (SECTOR_ID_MAP[name] !== undefined) return SECTOR_ID_MAP[name];
  if (TOKEN_TYPE_ID_MAP[name] !== undefined) return TOKEN_TYPE_ID_MAP[name];
  if (CHAIN_ID_MAP[name] !== undefined) return CHAIN_ID_MAP[name];
  if (DISTRIBUTION_ID_MAP[name] !== undefined) return DISTRIBUTION_ID_MAP[name];
  // 再查自定义映射
  if (customNameToId[name] !== undefined) return customNameToId[name];
  // 新增自定义名称
  const id = customNameCounter++;
  customNameToId[name] = id;
  customIdToName[id] = name;
  return id;
};

export const decodeName = (id: number): string => {
  if (id === 0) return '';
  if (SECTOR_NAME_MAP[id] !== undefined) return SECTOR_NAME_MAP[id];
  if (TOKEN_TYPE_NAME_MAP[id] !== undefined) return TOKEN_TYPE_NAME_MAP[id];
  if (CHAIN_NAME_MAP[id] !== undefined) return CHAIN_NAME_MAP[id];
  if (DISTRIBUTION_NAME_MAP[id] !== undefined) return DISTRIBUTION_NAME_MAP[id];
  if (customIdToName[id] !== undefined) return customIdToName[id];
  return `unknown_${id}`;
};

// ============ 板块定义 ============
export const SECTORS = [
  { id: 'all', name: '全部', icon: '📊' },
  { id: 'defi', name: 'DeFi', icon: '💰' },
  { id: 'metaverse', name: '元宇宙', icon: '🌐' },
  { id: 'payment', name: '支付', icon: '💳' },
  { id: 'pow', name: 'PoW', icon: '⛏️' },
  { id: 'storage', name: '存储', icon: '💾' },
  { id: 'nft', name: 'NFT', icon: '🎨' },
  { id: 'meme', name: 'Meme', icon: '🐕' },
  { id: 'ai', name: 'AI', icon: '🤖' },
  { id: 'layer1', name: 'Layer1', icon: '🔗' },
  { id: 'layer2', name: 'Layer2', icon: '⚡' },
  { id: 'rwa', name: 'RWA', icon: '🏛️' },
  { id: 'gaming', name: 'Gaming', icon: '🎮' },
  { id: 'infra', name: '基础服务', icon: '🔧' },
] as const;

// 代币数据定义（按板块分组）
export const TOKEN_DATA: { name: string; code: string; sector: string; supply: number; price: number; tier: number }[] = [
  // DeFi板块
  { name: 'Uniswap', code: 'UNI', sector: 'defi', supply: 753000000, price: 9.28, tier: 5 },
  { name: 'Aave', code: 'AAVE', sector: 'defi', supply: 15920000, price: 112.5, tier: 4 },
  { name: 'MakerDAO', code: 'MKR', sector: 'defi', supply: 977000, price: 2480, tier: 4 },
  { name: 'Compound', code: 'COMP', sector: 'defi', supply: 9080000, price: 42.1, tier: 3 },
  { name: 'Yearn.Finance', code: 'YFI', sector: 'defi', supply: 36600, price: 1827.6, tier: 2 },
  { name: 'Curve', code: 'CRV', sector: 'defi', supply: 705000000, price: 0.471, tier: 3 },
  { name: 'Lido', code: 'LDO', sector: 'defi', supply: 889000000, price: 1.93, tier: 4 },
  { name: '1inch', code: '1INCH', sector: 'defi', supply: 152000000, price: 0.726, tier: 3 },
  { name: 'SushiSwap', code: 'SUSHI', sector: 'defi', supply: 193000000, price: 0.582, tier: 3 },
  { name: 'Frax Share', code: 'FXS', sector: 'defi', supply: 9920000, price: 7.65, tier: 2 },
  { name: 'Aura Finance', code: 'AURA', sector: 'defi', supply: 50800000, price: 1.21, tier: 2 },
  { name: 'Nexus Mutual', code: 'NXM', sector: 'defi', supply: 798000, price: 44.9, tier: 3 },
  { name: 'Inverse Finance', code: 'INV', sector: 'defi', supply: 100000, price: 45.3, tier: 2 },
  // 元宇宙板块
  { name: 'Decentraland', code: 'MANA', sector: 'metaverse', supply: 1850000000, price: 0.392, tier: 4 },
  { name: 'The Sandbox', code: 'SAND', sector: 'metaverse', supply: 2390000000, price: 0.315, tier: 4 },
  { name: 'Axie Infinity', code: 'AXS', sector: 'metaverse', supply: 133000000, price: 4.76, tier: 4 },
  { name: 'Bloktopia', code: 'BLOK', sector: 'metaverse', supply: 16600000000, price: 0.0021, tier: 2 },
  { name: 'Metahero', code: 'HERO', sector: 'metaverse', supply: 9990000000, price: 0.00187, tier: 2 },
  { name: 'Voxies', code: 'VOXEL', sector: 'metaverse', supply: 199000000, price: 0.136, tier: 2 },
  { name: 'Starlink', code: 'SLNV', sector: 'metaverse', supply: 1000000000, price: 0.0097, tier: 1 },
  { name: 'Metaverse Index', code: 'MVI', sector: 'metaverse', supply: 102000, price: 198.3, tier: 2 },
  // 支付板块
  { name: 'XRP', code: 'XRP', sector: 'payment', supply: 51800000000, price: 1.17, tier: 6 },
  { name: 'Dogecoin', code: 'DOGE', sector: 'payment', supply: 142700000000, price: 0.085, tier: 6 },
  { name: 'Stellar', code: 'XLM', sector: 'payment', supply: 26600000000, price: 0.128, tier: 5 },
  { name: 'Tron', code: 'TRX', sector: 'payment', supply: 88600000000, price: 0.103, tier: 6 },
  { name: 'Algorand', code: 'ALGO', sector: 'payment', supply: 7280000000, price: 0.179, tier: 5 },
  { name: 'Hedera', code: 'HBAR', sector: 'payment', supply: 35400000000, price: 0.0586, tier: 5 },
  { name: 'Fantom', code: 'FTM', sector: 'payment', supply: 2880000000, price: 0.327, tier: 4 },
  { name: 'Nano', code: 'XNO', sector: 'payment', supply: 133000000, price: 0.712, tier: 3 },
  // PoW板块
  { name: 'Bitcoin', code: 'BTC', sector: 'pow', supply: 19740000, price: 64375, tier: 6 },
  { name: 'Litecoin', code: 'LTC', sector: 'pow', supply: 74260000, price: 98.3, tier: 5 },
  { name: 'Bitcoin Cash', code: 'BCH', sector: 'pow', supply: 19600000, price: 432, tier: 5 },
  { name: 'Dash', code: 'DASH', sector: 'pow', supply: 11890000, price: 31.6, tier: 3 },
  { name: 'Zcash', code: 'ZEC', sector: 'pow', supply: 16580000, price: 226.8, tier: 4 },
  { name: 'Monero', code: 'XMR', sector: 'pow', supply: 18420000, price: 159.2, tier: 5 },
  { name: 'Decred', code: 'DCR', sector: 'pow', supply: 15230000, price: 29.5, tier: 3 },
  { name: 'Vertcoin', code: 'VTC', sector: 'pow', supply: 8420000, price: 0.681, tier: 2 },
  // 存储板块
  { name: 'Filecoin', code: 'FIL', sector: 'storage', supply: 1950000000, price: 3.87, tier: 4 },
  { name: 'Arweave', code: 'AR', sector: 'storage', supply: 65500000, price: 22.4, tier: 4 },
  { name: 'Siacoin', code: 'SC', sector: 'storage', supply: 54400000000, price: 0.0052, tier: 2 },
  { name: 'STORJ', code: 'STORJ', sector: 'storage', supply: 39800000, price: 0.426, tier: 2 },
  { name: 'Filewave', code: 'FW', sector: 'storage', supply: 215000000, price: 0.0049, tier: 1 },
  { name: 'Chia', code: 'XCH', sector: 'storage', supply: 11350000, price: 26.8, tier: 3 },
  // NFT板块
  { name: 'Blur', code: 'BLUR', sector: 'nft', supply: 302000000, price: 0.274, tier: 3 },
  { name: 'OpenSea', code: 'OS', sector: 'nft', supply: 1000000000, price: 0.091, tier: 3 },
  { name: 'Enjin', code: 'ENJ', sector: 'nft', supply: 1000000000, price: 0.186, tier: 3 },
  { name: 'Xverse', code: 'XVS', sector: 'nft', supply: 15500000, price: 4.27, tier: 2 },
  { name: 'Rarible', code: 'RARI', sector: 'nft', supply: 25000000, price: 1.89, tier: 2 },
  { name: 'LooksRare', code: 'LOOKS', sector: 'nft', supply: 99900000, price: 0.0513, tier: 2 },
  { name: 'Art Blocks', code: 'ABLOCK', sector: 'nft', supply: 187000, price: 135.6, tier: 3 },
  { name: 'Sudoswap', code: 'SUDO', sector: 'nft', supply: 125000000, price: 0.184, tier: 2 },
  // Meme板块
  { name: 'Pepe', code: 'PEPE', sector: 'meme', supply: 1000000000, price: 0.4, tier: 4 },
  { name: 'PENGU', code: 'PENGU', sector: 'meme', supply: 88880000, price: 0.0068, tier: 1 },
  { name: 'SIREN', code: 'SIREN', sector: 'meme', supply: 1000000000, price: 0.05, tier: 3 },
  { name: 'PIPPIN', code: 'PIPPIN', sector: 'meme', supply: 1000000000, price: 0.01, tier: 2 },
  { name: 'Floki', code: 'FLOKI', sector: 'meme', supply: 9910000000000, price: 0.000193, tier: 5 },
  { name: 'Dogwifhat', code: 'WIF', sector: 'meme', supply: 998000000, price: 0.1633, tier: 4 },
  { name: 'Popcat', code: 'POPCAT', sector: 'meme', supply: 986000000, price: 0.458, tier: 5 },
  { name: 'Myro', code: 'MYRO', sector: 'meme', supply: 99700000, price: 0.217, tier: 3 },
  // AI板块
  { name: 'Render', code: 'RNDR', sector: 'ai', supply: 537000000, price: 7.92, tier: 4 },
  { name: 'Fetch.ai', code: 'FET', sector: 'ai', supply: 857000000, price: 0.643, tier: 3 },
  { name: 'SingularityNET', code: 'AGIX', sector: 'ai', supply: 1250000000, price: 0.227, tier: 3 },
  { name: 'Bittensor', code: 'TAO', sector: 'ai', supply: 31900, price: 278.5, tier: 2 },
  { name: 'Akash', code: 'AKT', sector: 'ai', supply: 249000000, price: 1.86, tier: 5 },
  { name: 'Ocean Protocol', code: 'OCEAN', sector: 'ai', supply: 61300000, price: 0.529, tier: 2 },
  { name: 'Worldcoin', code: 'WLD', sector: 'ai', supply: 1280000000, price: 1.73, tier: 5 },
  { name: 'Numerai', code: 'NMR', sector: 'ai', supply: 10900000, price: 16.8, tier: 4 },
  { name: 'Cortex', code: 'CTXC', sector: 'ai', supply: 298000000, price: 0.0724, tier: 2 },
  // Layer1板块
  { name: 'Ethereum', code: 'ETH', sector: 'layer1', supply: 120200000, price: 1747, tier: 6 },
  { name: 'Solana', code: 'SOL', sector: 'layer1', supply: 476000000, price: 71.46, tier: 6 },
  { name: 'BNB', code: 'BNB', sector: 'layer1', supply: 153000000, price: 672.2, tier: 6 },
  { name: 'Cardano', code: 'ADA', sector: 'layer1', supply: 35400000000, price: 0.451, tier: 6 },
  { name: 'Avalanche', code: 'AVAX', sector: 'layer1', supply: 385000000, price: 32.7, tier: 5 },
  { name: 'Polkadot', code: 'DOT', sector: 'layer1', supply: 1420000000, price: 6.19, tier: 5 },
  { name: 'Sui', code: 'SUI', sector: 'layer1', supply: 389000000, price: 1.02, tier: 4 },
  { name: 'Aptos', code: 'APT', sector: 'layer1', supply: 339000000, price: 5.83, tier: 5 },
  { name: 'Near Protocol', code: 'NEAR', sector: 'layer1', supply: 991000000, price: 2.74, tier: 5 },
  { name: 'Toncoin', code: 'TON', sector: 'layer1', supply: 5130000000, price: 6.38, tier: 6 },
  { name: 'Cosmos', code: 'ATOM', sector: 'layer1', supply: 312000000, price: 9.26, tier: 5 },
  // Layer2板块
  { name: 'Arbitrum', code: 'ARB', sector: 'layer2', supply: 10000000000, price: 0.735, tier: 5 },
  { name: 'Optimism', code: 'OP', sector: 'layer2', supply: 4290000000, price: 1.32, tier: 5 },
  { name: 'Polygon', code: 'MATIC', sector: 'layer2', supply: 9930000000, price: 0.418, tier: 5 },
  { name: 'ImmutableX', code: 'IMX', sector: 'layer2', supply: 1520000000, price: 0.496, tier: 4 },
  { name: 'Blast', code: 'BLST', sector: 'layer2', supply: 598000000, price: 0.337, tier: 3 },
  { name: 'zkSync', code: 'ZK', sector: 'layer2', supply: 1120000000, price: 0.285, tier: 4 },
  { name: 'Starknet', code: 'STRK', sector: 'layer2', supply: 1030000000, price: 0.412, tier: 4 },
  { name: 'Loopring', code: 'LRC', sector: 'layer2', supply: 1370000000, price: 0.168, tier: 3 },
  { name: 'zkEra', code: 'ZKE', sector: 'layer2', supply: 892000000, price: 0.119, tier: 3 },
  { name: 'Mantle', code: 'MNT', sector: 'layer2', supply: 615000000, price: 0.493, tier: 3 },
  // RWA板块
  { name: 'Chainlink', code: 'LINK', sector: 'rwa', supply: 539000000, price: 14.8, tier: 5 },
  { name: 'Realio', code: 'RIO', sector: 'rwa', supply: 125000000, price: 0.153, tier: 2 },
  { name: 'Polymath', code: 'POLY', sector: 'rwa', supply: 999000000, price: 0.137, tier: 3 },
  { name: 'Provenance', code: 'PRVT', sector: 'rwa', supply: 256000000, price: 0.0942, tier: 2 },
  { name: 'Centrifuge', code: 'CFG', sector: 'rwa', supply: 405000000, price: 0.318, tier: 3 },
  { name: 'LandX', code: 'LNDX', sector: 'rwa', supply: 1860000, price: 5.79, tier: 2 },
  { name: 'Ondo Finance', code: 'ONDO', sector: 'rwa', supply: 998000000, price: 0.243, tier: 3 },
  // Gaming板块
  { name: 'Gala', code: 'GALA', sector: 'gaming', supply: 35500000000, price: 0.0194, tier: 5 },
  { name: 'Illuvium', code: 'ILV', sector: 'gaming', supply: 7960000, price: 62.8, tier: 4 },
  { name: 'StepN', code: 'GMT', sector: 'gaming', supply: 6000000000, price: 0.228, tier: 5 },
  { name: 'Star Atlas', code: 'ATLAS', sector: 'gaming', supply: 998000000, price: 0.0196, tier: 2 },
  { name: 'Mobox', code: 'MBOX', sector: 'gaming', supply: 99700000, price: 0.473, tier: 3 },
  { name: 'Revolve Games', code: 'RPG', sector: 'gaming', supply: 999000000, price: 0.0058, tier: 1 },
  // 基础服务板块
  { name: 'The Graph', code: 'GRT', sector: 'infra', supply: 94800000000, price: 0.116, tier: 5 },
  { name: 'Band Protocol', code: 'BAND', sector: 'infra', supply: 139000000, price: 1.18, tier: 3 },
  { name: 'API3', code: 'API3', sector: 'infra', supply: 122000000, price: 1.54, tier: 3 },
  { name: 'Helium', code: 'HNT', sector: 'infra', supply: 108000000, price: 2.96, tier: 5 },
  { name: 'Livepeer', code: 'LPT', sector: 'infra', supply: 2890000, price: 23.7, tier: 4 },
];

export const TIER_LABELS: Record<number, string> = { 1: '微型', 2: '小型', 3: '中型', 4: '大型', 5: '巨型', 6: '巨鲸' };
export const TIER_COLORS: Record<number, string> = { 1: '#8b949e', 2: '#58a6ff', 3: '#d29922', 4: '#f0883e', 5: '#f6465d', 6: '#9333ea' };

// ============ AI交易员初始数据 ============
// 10名AI交易员，初始资金从1000万到1亿，Crypto散户风格命名
// 类型分布：3名套利机器人、4名趋势交易员、3名随机交易员
export const INITIAL_AITRADERS: AITrader[] = [
  // 套利机器人（3名）- 专注于CEX/DEX价差套利
  { id: 'ai_trader_1', name: 'ArbBot_Alpha', type: 'arbitrageur', initialCapital: 10000000, availableCapital: 10000000, positions: [], futuresPositions: [], assetHistory: [10000000], lastTradeRound: 0, tradingStyle: 'moderate', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 2, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_trader_2', name: 'ArbBot_Beta', type: 'arbitrageur', initialCapital: 20000000, availableCapital: 20000000, positions: [], futuresPositions: [], assetHistory: [20000000], lastTradeRound: 0, tradingStyle: 'conservative', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.008, maxSlippage: 0.015, cooldownRounds: 3, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_trader_3', name: 'ArbBot_Gamma', type: 'arbitrageur', initialCapital: 30000000, availableCapital: 30000000, positions: [], futuresPositions: [], assetHistory: [30000000], lastTradeRound: 0, tradingStyle: 'aggressive', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.003, maxSlippage: 0.025, cooldownRounds: 1, lastArbRound: 0, arbProfitHistory: [] },
  // 趋势交易员（4名）- 基于EMA策略跟随趋势
  { id: 'ai_trader_4', name: 'TrendRider_1', type: 'trend_follower', initialCapital: 40000000, availableCapital: 40000000, positions: [], futuresPositions: [], assetHistory: [40000000], lastTradeRound: 0, tradingStyle: 'moderate', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_trader_5', name: 'TrendRider_2', type: 'trend_follower', initialCapital: 50000000, availableCapital: 50000000, positions: [], futuresPositions: [], assetHistory: [50000000], lastTradeRound: 0, tradingStyle: 'aggressive', pendingLimitOrders: [], emaShort: 9, emaLong: 21, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_trader_6', name: 'TrendRider_3', type: 'trend_follower', initialCapital: 60000000, availableCapital: 60000000, positions: [], futuresPositions: [], assetHistory: [60000000], lastTradeRound: 0, tradingStyle: 'conservative', pendingLimitOrders: [], emaShort: 20, emaLong: 50, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_trader_7', name: 'TrendRider_4', type: 'trend_follower', initialCapital: 70000000, availableCapital: 70000000, positions: [], futuresPositions: [], assetHistory: [70000000], lastTradeRound: 0, tradingStyle: 'moderate', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  // 随机交易员（3名）- 保持原有随机行为
  { id: 'ai_trader_8', name: 'RandomApe', type: 'random_trader', initialCapital: 80000000, availableCapital: 80000000, positions: [], futuresPositions: [], assetHistory: [80000000], lastTradeRound: 0, tradingStyle: 'moderate', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_trader_9', name: 'RektKing', type: 'random_trader', initialCapital: 90000000, availableCapital: 90000000, positions: [], futuresPositions: [], assetHistory: [90000000], lastTradeRound: 0, tradingStyle: 'aggressive', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_trader_10', name: 'DCAstacker', type: 'random_trader', initialCapital: 100000000, availableCapital: 100000000, positions: [], futuresPositions: [], assetHistory: [100000000], lastTradeRound: 0, tradingStyle: 'conservative', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  // 10名巨鲸交易员，初始资金从1亿到10亿，加密市场巨鲸风格命名
  // 类型分布：2名套利机器人、4名趋势交易员、4名随机交易员
  { id: 'ai_whale_1', name: 'WhaleArb_1', type: 'arbitrageur', initialCapital: 100000000, availableCapital: 100000000, positions: [], futuresPositions: [], assetHistory: [100000000], lastTradeRound: 0, tradingStyle: 'moderate', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.004, maxSlippage: 0.015, cooldownRounds: 2, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_2', name: 'WhaleTrend_1', type: 'trend_follower', initialCapital: 200000000, availableCapital: 200000000, positions: [], futuresPositions: [], assetHistory: [200000000], lastTradeRound: 0, tradingStyle: 'moderate', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_3', name: 'SatoshisVault', type: 'trend_follower', initialCapital: 300000000, availableCapital: 300000000, positions: [], futuresPositions: [], assetHistory: [300000000], lastTradeRound: 0, tradingStyle: 'conservative', pendingLimitOrders: [], emaShort: 20, emaLong: 50, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_4', name: 'WhaleAlert', type: 'random_trader', initialCapital: 400000000, availableCapital: 400000000, positions: [], futuresPositions: [], assetHistory: [400000000], lastTradeRound: 0, tradingStyle: 'aggressive', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_5', name: 'WhaleTrend_2', type: 'trend_follower', initialCapital: 500000000, availableCapital: 500000000, positions: [], futuresPositions: [], assetHistory: [500000000], lastTradeRound: 0, tradingStyle: 'moderate', pendingLimitOrders: [], emaShort: 9, emaLong: 21, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_6', name: 'BigFish', type: 'random_trader', initialCapital: 600000000, availableCapital: 600000000, positions: [], futuresPositions: [], assetHistory: [600000000], lastTradeRound: 0, tradingStyle: 'conservative', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_7', name: 'WhaleArb_2', type: 'arbitrageur', initialCapital: 700000000, availableCapital: 700000000, positions: [], futuresPositions: [], assetHistory: [700000000], lastTradeRound: 0, tradingStyle: 'aggressive', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.003, maxSlippage: 0.02, cooldownRounds: 1, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_8', name: 'WhaleTrend_3', type: 'trend_follower', initialCapital: 800000000, availableCapital: 800000000, positions: [], futuresPositions: [], assetHistory: [800000000], lastTradeRound: 0, tradingStyle: 'moderate', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_9', name: 'MegaBagHolder', type: 'random_trader', initialCapital: 900000000, availableCapital: 900000000, positions: [], futuresPositions: [], assetHistory: [900000000], lastTradeRound: 0, tradingStyle: 'conservative', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
  { id: 'ai_whale_10', name: 'TitanCapital', type: 'random_trader', initialCapital: 1000000000, availableCapital: 1000000000, positions: [], futuresPositions: [], assetHistory: [1000000000], lastTradeRound: 0, tradingStyle: 'aggressive', pendingLimitOrders: [], emaShort: 12, emaLong: 26, priceHistory: {}, lastSignal: 'none', arbThreshold: 0.005, maxSlippage: 0.02, cooldownRounds: 0, lastArbRound: 0, arbProfitHistory: [] },
];

// 判断是否为巨鲸（初始资金>=1亿）
export const isWhale = (trader: AITrader): boolean => trader.initialCapital >= 100000000;

// ============ AI庄家初始数据 ============
// 5名AI庄家，初始资金从20亿到100亿，Crypto做市商机构风格命名
export const INITIAL_AI_MARKET_MAKERS: AIMarketMaker[] = [
  { id: 'ai_mm_1', name: 'DWF Labs', initialCapital: 2000000000, availableCapital: 2000000000, positions: [], futuresPositions: [], assetHistory: [2000000000], targetTokenId: null, phase: 'idle', phaseStartRound: 0, phaseTargetPrice: 0, accumulatedQuantity: 0, targetControlRatio: 0.65, pumpTargetPercent: 200, pumpWashCycle: 0, totalPumpRounds: 0, history: [], cycleStartAsset: 2000000000, cycleStartRound: 0, lastPumpPrice: 0, pumpStepIndex: 0, washTargetPrice: 0, dumpStartPrice: 0, dumpRemainingRatio: 1, avgCostPrice: 0, totalCostSpent: 0, totalBoughtQuantity: 0, pendingLimitOrders: [], cycleStartPrice: 0, consecutiveUpRounds: 0, lastRoundPrice: 0, suppressModeActive: false, lastMarketBuyPrice: 0, suppressTriggerPrice: 0, isSuppressing: false, pendingSuppressOrders: [], suppressRounds: 0, priceBeforeSuppress: 0, marketMakingStartPrice: 0, lastRoundLimitOrderIds: [], twoRoundsAgoLimitOrderIds: [], firstBuyPrice: 0, firstBuyPriceSuppressActive: false, firstBuySuppressRounds: 0, firstBuySuppressOrderId: '', forceDumpActive: false, forceDumpRounds: 0, forceDumpOrderId: '', accumulationCyclePhase: 'buy', lastMarketBuyQuantity: 0, lastMarketBuyRound: 0, priceBeforeAccumulation: 0, accumulationSuppressActive: false, accumulationSuppressRounds: 0, accumulationSuppressOrderId: '', secondaryTargetTokenId: null, secondaryPhase: 'idle', secondaryPhaseStartRound: 0, secondaryPhaseTargetPrice: 0, secondaryAccumulatedQuantity: 0, secondaryTargetControlRatio: 0.65, secondaryPumpTargetPercent: 200, secondaryPumpWashCycle: 0, secondaryTotalPumpRounds: 0, secondaryLastPumpPrice: 0, secondaryPumpStepIndex: 0, secondaryWashTargetPrice: 0, secondaryAvgCostPrice: 0, secondaryTotalCostSpent: 0, secondaryTotalBoughtQuantity: 0, secondaryFirstBuyPrice: 0, secondaryCycleStartAsset: 0, secondaryCycleStartRound: 0, secondaryMarketMakingStartPrice: 0, secondaryLastRoundLimitOrderIds: [], completedTokens: [], aggressiveDumpEndMarketMaking: false, aggressiveDumpOrderId: '', liquidityProvided: {}, targetLiquidityLevel: 0.3, liquidityScore: 0, liquiditySectorId: null, liquiditySectorAssignedRound: 0, liquidityTargetTokenIds: [], liquidityCapital: 0, testStartPrice: 0, testRounds: 0, testSellOrderId: '', testBuyOrderId: '', testPassed: false, distributeStartPrice: 0, distributeSellRatio: 0, distributeRounds: 0, distributeSupportOrderId: '', distributeStartHoldings: 0, washTradeCooldown: 0, washTradeBuyOrderId: '', washTradeSellOrderId: '', washTradeRound: 0, announcedPumpRound: 0, announcedDistributeRound: 0, washTradeVolume: 0, performanceMetrics: { totalTrades: 0, winRate: 0, avgProfitPercent: 0, maxDrawdown: 0, sharpeRatio: 0 }, cooldownActive: false, cooldownEndRound: 0 },
  { id: 'ai_mm_2', name: 'Wintermute', initialCapital: 4000000000, availableCapital: 4000000000, positions: [], futuresPositions: [], assetHistory: [4000000000], targetTokenId: null, phase: 'idle', phaseStartRound: 0, phaseTargetPrice: 0, accumulatedQuantity: 0, targetControlRatio: 0.65, pumpTargetPercent: 200, pumpWashCycle: 0, totalPumpRounds: 0, history: [], cycleStartAsset: 4000000000, cycleStartRound: 0, lastPumpPrice: 0, pumpStepIndex: 0, washTargetPrice: 0, dumpStartPrice: 0, dumpRemainingRatio: 1, avgCostPrice: 0, totalCostSpent: 0, totalBoughtQuantity: 0, pendingLimitOrders: [], cycleStartPrice: 0, consecutiveUpRounds: 0, lastRoundPrice: 0, suppressModeActive: false, lastMarketBuyPrice: 0, suppressTriggerPrice: 0, isSuppressing: false, pendingSuppressOrders: [], suppressRounds: 0, priceBeforeSuppress: 0, marketMakingStartPrice: 0, lastRoundLimitOrderIds: [], twoRoundsAgoLimitOrderIds: [], firstBuyPrice: 0, firstBuyPriceSuppressActive: false, firstBuySuppressRounds: 0, firstBuySuppressOrderId: '', forceDumpActive: false, forceDumpRounds: 0, forceDumpOrderId: '', accumulationCyclePhase: 'buy', lastMarketBuyQuantity: 0, lastMarketBuyRound: 0, priceBeforeAccumulation: 0, accumulationSuppressActive: false, accumulationSuppressRounds: 0, accumulationSuppressOrderId: '', secondaryTargetTokenId: null, secondaryPhase: 'idle', secondaryPhaseStartRound: 0, secondaryPhaseTargetPrice: 0, secondaryAccumulatedQuantity: 0, secondaryTargetControlRatio: 0.65, secondaryPumpTargetPercent: 200, secondaryPumpWashCycle: 0, secondaryTotalPumpRounds: 0, secondaryLastPumpPrice: 0, secondaryPumpStepIndex: 0, secondaryWashTargetPrice: 0, secondaryAvgCostPrice: 0, secondaryTotalCostSpent: 0, secondaryTotalBoughtQuantity: 0, secondaryFirstBuyPrice: 0, secondaryCycleStartAsset: 0, secondaryCycleStartRound: 0, secondaryMarketMakingStartPrice: 0, secondaryLastRoundLimitOrderIds: [], completedTokens: [], aggressiveDumpEndMarketMaking: false, aggressiveDumpOrderId: '', liquidityProvided: {}, targetLiquidityLevel: 0.3, liquidityScore: 0, liquiditySectorId: null, liquiditySectorAssignedRound: 0, liquidityTargetTokenIds: [], liquidityCapital: 0, testStartPrice: 0, testRounds: 0, testSellOrderId: '', testBuyOrderId: '', testPassed: false, distributeStartPrice: 0, distributeSellRatio: 0, distributeRounds: 0, distributeSupportOrderId: '', distributeStartHoldings: 0, washTradeCooldown: 0, washTradeBuyOrderId: '', washTradeSellOrderId: '', washTradeRound: 0, announcedPumpRound: 0, announcedDistributeRound: 0, washTradeVolume: 0, performanceMetrics: { totalTrades: 0, winRate: 0, avgProfitPercent: 0, maxDrawdown: 0, sharpeRatio: 0 }, cooldownActive: false, cooldownEndRound: 0 },
  { id: 'ai_mm_3', name: 'Jump Trading', initialCapital: 6000000000, availableCapital: 6000000000, positions: [], futuresPositions: [], assetHistory: [6000000000], targetTokenId: null, phase: 'idle', phaseStartRound: 0, phaseTargetPrice: 0, accumulatedQuantity: 0, targetControlRatio: 0.65, pumpTargetPercent: 200, pumpWashCycle: 0, totalPumpRounds: 0, history: [], cycleStartAsset: 6000000000, cycleStartRound: 0, lastPumpPrice: 0, pumpStepIndex: 0, washTargetPrice: 0, dumpStartPrice: 0, dumpRemainingRatio: 1, avgCostPrice: 0, totalCostSpent: 0, totalBoughtQuantity: 0, pendingLimitOrders: [], cycleStartPrice: 0, consecutiveUpRounds: 0, lastRoundPrice: 0, suppressModeActive: false, lastMarketBuyPrice: 0, suppressTriggerPrice: 0, isSuppressing: false, pendingSuppressOrders: [], suppressRounds: 0, priceBeforeSuppress: 0, marketMakingStartPrice: 0, lastRoundLimitOrderIds: [], twoRoundsAgoLimitOrderIds: [], firstBuyPrice: 0, firstBuyPriceSuppressActive: false, firstBuySuppressRounds: 0, firstBuySuppressOrderId: '', forceDumpActive: false, forceDumpRounds: 0, forceDumpOrderId: '', accumulationCyclePhase: 'buy', lastMarketBuyQuantity: 0, lastMarketBuyRound: 0, priceBeforeAccumulation: 0, accumulationSuppressActive: false, accumulationSuppressRounds: 0, accumulationSuppressOrderId: '', secondaryTargetTokenId: null, secondaryPhase: 'idle', secondaryPhaseStartRound: 0, secondaryPhaseTargetPrice: 0, secondaryAccumulatedQuantity: 0, secondaryTargetControlRatio: 0.65, secondaryPumpTargetPercent: 200, secondaryPumpWashCycle: 0, secondaryTotalPumpRounds: 0, secondaryLastPumpPrice: 0, secondaryPumpStepIndex: 0, secondaryWashTargetPrice: 0, secondaryAvgCostPrice: 0, secondaryTotalCostSpent: 0, secondaryTotalBoughtQuantity: 0, secondaryFirstBuyPrice: 0, secondaryCycleStartAsset: 0, secondaryCycleStartRound: 0, secondaryMarketMakingStartPrice: 0, secondaryLastRoundLimitOrderIds: [], completedTokens: [], aggressiveDumpEndMarketMaking: false, aggressiveDumpOrderId: '', liquidityProvided: {}, targetLiquidityLevel: 0.3, liquidityScore: 0, liquiditySectorId: null, liquiditySectorAssignedRound: 0, liquidityTargetTokenIds: [], liquidityCapital: 0, testStartPrice: 0, testRounds: 0, testSellOrderId: '', testBuyOrderId: '', testPassed: false, distributeStartPrice: 0, distributeSellRatio: 0, distributeRounds: 0, distributeSupportOrderId: '', distributeStartHoldings: 0, washTradeCooldown: 0, washTradeBuyOrderId: '', washTradeSellOrderId: '', washTradeRound: 0, announcedPumpRound: 0, announcedDistributeRound: 0, washTradeVolume: 0, performanceMetrics: { totalTrades: 0, winRate: 0, avgProfitPercent: 0, maxDrawdown: 0, sharpeRatio: 0 }, cooldownActive: false, cooldownEndRound: 0 },
  { id: 'ai_mm_4', name: 'Amber Group', initialCapital: 8000000000, availableCapital: 8000000000, positions: [], futuresPositions: [], assetHistory: [8000000000], targetTokenId: null, phase: 'idle', phaseStartRound: 0, phaseTargetPrice: 0, accumulatedQuantity: 0, targetControlRatio: 0.65, pumpTargetPercent: 200, pumpWashCycle: 0, totalPumpRounds: 0, history: [], cycleStartAsset: 8000000000, cycleStartRound: 0, lastPumpPrice: 0, pumpStepIndex: 0, washTargetPrice: 0, dumpStartPrice: 0, dumpRemainingRatio: 1, avgCostPrice: 0, totalCostSpent: 0, totalBoughtQuantity: 0, pendingLimitOrders: [], cycleStartPrice: 0, consecutiveUpRounds: 0, lastRoundPrice: 0, suppressModeActive: false, lastMarketBuyPrice: 0, suppressTriggerPrice: 0, isSuppressing: false, pendingSuppressOrders: [], suppressRounds: 0, priceBeforeSuppress: 0, marketMakingStartPrice: 0, lastRoundLimitOrderIds: [], twoRoundsAgoLimitOrderIds: [], firstBuyPrice: 0, firstBuyPriceSuppressActive: false, firstBuySuppressRounds: 0, firstBuySuppressOrderId: '', forceDumpActive: false, forceDumpRounds: 0, forceDumpOrderId: '', accumulationCyclePhase: 'buy', lastMarketBuyQuantity: 0, lastMarketBuyRound: 0, priceBeforeAccumulation: 0, accumulationSuppressActive: false, accumulationSuppressRounds: 0, accumulationSuppressOrderId: '', secondaryTargetTokenId: null, secondaryPhase: 'idle', secondaryPhaseStartRound: 0, secondaryPhaseTargetPrice: 0, secondaryAccumulatedQuantity: 0, secondaryTargetControlRatio: 0.65, secondaryPumpTargetPercent: 200, secondaryPumpWashCycle: 0, secondaryTotalPumpRounds: 0, secondaryLastPumpPrice: 0, secondaryPumpStepIndex: 0, secondaryWashTargetPrice: 0, secondaryAvgCostPrice: 0, secondaryTotalCostSpent: 0, secondaryTotalBoughtQuantity: 0, secondaryFirstBuyPrice: 0, secondaryCycleStartAsset: 0, secondaryCycleStartRound: 0, secondaryMarketMakingStartPrice: 0, secondaryLastRoundLimitOrderIds: [], completedTokens: [], aggressiveDumpEndMarketMaking: false, aggressiveDumpOrderId: '', liquidityProvided: {}, targetLiquidityLevel: 0.3, liquidityScore: 0, liquiditySectorId: null, liquiditySectorAssignedRound: 0, liquidityTargetTokenIds: [], liquidityCapital: 0, testStartPrice: 0, testRounds: 0, testSellOrderId: '', testBuyOrderId: '', testPassed: false, distributeStartPrice: 0, distributeSellRatio: 0, distributeRounds: 0, distributeSupportOrderId: '', distributeStartHoldings: 0, washTradeCooldown: 0, washTradeBuyOrderId: '', washTradeSellOrderId: '', washTradeRound: 0, announcedPumpRound: 0, announcedDistributeRound: 0, washTradeVolume: 0, performanceMetrics: { totalTrades: 0, winRate: 0, avgProfitPercent: 0, maxDrawdown: 0, sharpeRatio: 0 }, cooldownActive: false, cooldownEndRound: 0 },
  { id: 'ai_mm_5', name: 'B2C2', initialCapital: 10000000000, availableCapital: 10000000000, positions: [], futuresPositions: [], assetHistory: [10000000000], targetTokenId: null, phase: 'idle', phaseStartRound: 0, phaseTargetPrice: 0, accumulatedQuantity: 0, targetControlRatio: 0.65, pumpTargetPercent: 200, pumpWashCycle: 0, totalPumpRounds: 0, history: [], cycleStartAsset: 10000000000, cycleStartRound: 0, lastPumpPrice: 0, pumpStepIndex: 0, washTargetPrice: 0, dumpStartPrice: 0, dumpRemainingRatio: 1, avgCostPrice: 0, totalCostSpent: 0, totalBoughtQuantity: 0, pendingLimitOrders: [], cycleStartPrice: 0, consecutiveUpRounds: 0, lastRoundPrice: 0, suppressModeActive: false, lastMarketBuyPrice: 0, suppressTriggerPrice: 0, isSuppressing: false, pendingSuppressOrders: [], suppressRounds: 0, priceBeforeSuppress: 0, marketMakingStartPrice: 0, lastRoundLimitOrderIds: [], twoRoundsAgoLimitOrderIds: [], firstBuyPrice: 0, firstBuyPriceSuppressActive: false, firstBuySuppressRounds: 0, firstBuySuppressOrderId: '', forceDumpActive: false, forceDumpRounds: 0, forceDumpOrderId: '', accumulationCyclePhase: 'buy', lastMarketBuyQuantity: 0, lastMarketBuyRound: 0, priceBeforeAccumulation: 0, accumulationSuppressActive: false, accumulationSuppressRounds: 0, accumulationSuppressOrderId: '', secondaryTargetTokenId: null, secondaryPhase: 'idle', secondaryPhaseStartRound: 0, secondaryPhaseTargetPrice: 0, secondaryAccumulatedQuantity: 0, secondaryTargetControlRatio: 0.65, secondaryPumpTargetPercent: 200, secondaryPumpWashCycle: 0, secondaryTotalPumpRounds: 0, secondaryLastPumpPrice: 0, secondaryPumpStepIndex: 0, secondaryWashTargetPrice: 0, secondaryAvgCostPrice: 0, secondaryTotalCostSpent: 0, secondaryTotalBoughtQuantity: 0, secondaryFirstBuyPrice: 0, secondaryCycleStartAsset: 0, secondaryCycleStartRound: 0, secondaryMarketMakingStartPrice: 0, secondaryLastRoundLimitOrderIds: [], completedTokens: [], aggressiveDumpEndMarketMaking: false, aggressiveDumpOrderId: '', liquidityProvided: {}, targetLiquidityLevel: 0.3, liquidityScore: 0, liquiditySectorId: null, liquiditySectorAssignedRound: 0, liquidityTargetTokenIds: [], liquidityCapital: 0, testStartPrice: 0, testRounds: 0, testSellOrderId: '', testBuyOrderId: '', testPassed: false, distributeStartPrice: 0, distributeSellRatio: 0, distributeRounds: 0, distributeSupportOrderId: '', distributeStartHoldings: 0, washTradeCooldown: 0, washTradeBuyOrderId: '', washTradeSellOrderId: '', washTradeRound: 0, announcedPumpRound: 0, announcedDistributeRound: 0, washTradeVolume: 0, performanceMetrics: { totalTrades: 0, winRate: 0, avgProfitPercent: 0, maxDrawdown: 0, sharpeRatio: 0 }, cooldownActive: false, cooldownEndRound: 0 },
];

// 散户名称列表
export const RETAIL_NAMES = [
  '钻石手Dave', '纸手Peter', '梭哈王', '韭菜小张', '追涨杀跌李',
  '佛系持币', '短线高手', '价值投资', '趋势跟踪', '逆势操作',
  '消息面交易', '技术流', '基本面分析', '量化交易', '套利大师'
];