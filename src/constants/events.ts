// ============ 每日市场事件机制 ============
// 每日20:00 25%概率触发市场事件（利空/利多），同一事件30日内不重复
// 事件影响：盘口生成基准价格与K线收盘价按代币分级（tier）涨跌

export interface GameEventDef {
  id: string;            // 事件ID
  type: 'bull' | 'bear'; // 利多 / 利空
  title: string;         // 事件标题
  desc: string;          // 事件文案
  level: number;         // 影响等级 1-4
  image: string;         // 事件图片URL
  emoji: string;         // 兜底图标（图片加载失败时使用）
}

export interface ActiveGameEvent {
  eventId: string;
  type: 'bull' | 'bear';
  level: number;
  day: number;                 // 触发当天（第N天）
  announcementRound: number;   // 公布回合（当天20:00）
}

// 影响等级效果表（单位：小数，如0.03 = +3%)
// tier: 1=微型 2=小型 3=中型 4=大型 5=巨型 6=巨鲸
// announce: 事件公布当回合的涨幅（盘口生成基准价格与K线收盘价）
// upProb: 事件公布后24回合内，代币随机波动机制每回合上涨的概率（利多）；利空则上下概率对调
// fearGreed: 恐惧贪婪指数变化点数（利多正向、利空负向）
export const EVENT_LEVEL_EFFECTS: Record<number, {
  announce: Record<number, number>;
  upProb: number;
  fearGreed: number;
}> = {
  1: {
    announce: { 6: 0.03, 5: 0.05, 4: 0.08, 3: 0.10, 2: 0.15, 1: 0.20 },
    upProb: 0.80,
    fearGreed: 10,
  },
  2: {
    announce: { 6: 0.02, 5: 0.03, 4: 0.05, 3: 0.08, 2: 0.10, 1: 0.10 },
    upProb: 0.70,
    fearGreed: 5,
  },
  3: {
    announce: { 6: 0.01, 5: 0.02, 4: 0.03, 3: 0.05, 2: 0.08, 1: 0.10 },
    upProb: 0.60,
    fearGreed: 3,
  },
  4: {
    announce: { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    upProb: 0.60,
    fearGreed: 2,
  },
};

export const TIER_LABEL_ARR: Record<number, string> = { 1: '微型', 2: '小型', 3: '中型', 4: '大型', 5: '巨型', 6: '巨鲸' };

// ============ 利空事件（30个） ============
export const BEAR_EVENTS: GameEventDef[] = [
  { id: 'bear-1', type: 'bear', title: 'CPI超预期', desc: '美国CPI数据大幅超出预期，通胀粘性持续，风险资产集体承压。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375481140_Usecasestylizedc.png', emoji: '📈' },
  { id: 'bear-2', type: 'bear', title: '非农数据爆冷强劲（加息预期升温）', desc: '非农就业远超预期，市场对美联储加息的担忧再度升温。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375480771_Usecasestylizedc.png', emoji: '💼' },
  { id: 'bear-3', type: 'bear', title: '美联储宣布加息', desc: '美联储宣布上调基准利率，市场流动性收紧预期急剧升温。', level: 1, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375482792_Usecasestylizedc.png', emoji: '🏦' },
  { id: 'bear-4', type: 'bear', title: '美联储释放鹰派信号', desc: '美联储官员密集释放鹰派言论，暗示高利率将持续更久。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375480446_Usecasestylizedc.png', emoji: '🦅' },
  { id: 'bear-5', type: 'bear', title: 'ETF申请被SEC驳回', desc: 'SEC驳回多支现货ETF申请，机构资金入场预期严重受挫。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375478944_Usecasestylizedc.png', emoji: '📋' },
  { id: 'bear-6', type: 'bear', title: 'ETF单日巨额净流出', desc: '现货ETF单日净流出创下纪录，机构资金加速撤离市场。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375479707_Usecasestylizedc.png', emoji: '💸' },
  { id: 'bear-7', type: 'bear', title: '上市公司抛售持币', desc: '多家上市公司集中抛售加密储备，市场抛压骤然增加。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375498294_Usecasestylizedc.png', emoji: '🏢' },
  { id: 'bear-8', type: 'bear', title: '某国全面禁止加密交易', desc: '某国宣布全面禁止加密货币交易，监管恐慌情绪蔓延。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375499073_Usecasestylizedc.png', emoji: '🚫' },
  { id: 'bear-9', type: 'bear', title: '支付渠道切断出金', desc: '主要支付渠道切断加密货币出金通道，市场流动性受损。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375503261_Usecasestylizedc.png', emoji: '🔌' },
  { id: 'bear-10', type: 'bear', title: '大型银行拒绝加密业务', desc: '大型银行集体拒绝为加密企业提供服务，行业融资渠道受阻。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375499430_Usecasestylizedc.png', emoji: '🏛️' },
  { id: 'bear-11', type: 'bear', title: '稳定币被认定为证券', desc: '法院裁定稳定币属于证券，发行方面临严格监管。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375500247_Usecasestylizedc.png', emoji: '⚖️' },
  { id: 'bear-12', type: 'bear', title: '监管重罚头部交易所', desc: '监管机构对头部交易所开出天价罚单，行业风声鹤唳。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375500639_Usecasestylizedc.png', emoji: '🧾' },
  { id: 'bear-13', type: 'bear', title: 'SEC起诉知名项目方', desc: 'SEC对知名项目方提起诉讼，市场恐慌情绪迅速升温。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375518581_Usecasestylizedc.png', emoji: '⚡' },
  { id: 'bear-14', type: 'bear', title: '交易所被黑客攻击', desc: '知名交易所遭黑客攻击，大量用户资产被盗。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375520613_Usecasestylizedc.png', emoji: '👾' },
  { id: 'bear-15', type: 'bear', title: '交易所暂停提币', desc: '头部交易所宣布暂停提币，用户信任体系崩塌。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375520970_Usecasestylizedc.png', emoji: '⏸️' },
  { id: 'bear-16', type: 'bear', title: '头部交易所倒闭', desc: '头部交易所宣布倒闭清算，市场信心遭受重创。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375520250_Usecasestylizedc.png', emoji: '💥' },
  { id: 'bear-17', type: 'bear', title: '稳定币脱锚', desc: '主流稳定币突然脱锚，市场避险情绪急剧上升。', level: 1, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375521791_Usecasestylizedc.png', emoji: '⚓' },
  { id: 'bear-18', type: 'bear', title: 'DeFi协议被漏洞攻击', desc: '主流DeFi协议遭漏洞攻击，资金池被大量掏空。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375519392_Usecasestylizedc.png', emoji: '🕳️' },
  { id: 'bear-19', type: 'bear', title: '跨链桥巨额被盗', desc: '跨链桥遭黑客攻击被盗数亿美元，安全恐慌迅速蔓延。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375540377_Usecasestylizedc.png', emoji: '🌉' },
  { id: 'bear-20', type: 'bear', title: 'RUG跑路事件曝光', desc: '大型项目RUG跑路被曝光，投资者信心彻底崩塌。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375538204_Usecasestylizedc.png', emoji: '🏃' },
  { id: 'bear-21', type: 'bear', title: '巨鲸大额转入交易所', desc: '巨鲸将巨额代币转入交易所，抛售信号极为强烈。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375542905_Usecasestylizedc.png', emoji: '🐋' },
  { id: 'bear-22', type: 'bear', title: '长期矿工集中抛售', desc: '长期持有矿工集中抛售，市场供应压力骤增。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375539986_Usecasestylizedc.png', emoji: '⛏️' },
  { id: 'bear-23', type: 'bear', title: '多头集中爆仓', desc: '多头集中爆仓引发连环清算，价格加速下跌。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375539213_Usecasestylizedc.png', emoji: '💥' },
  { id: 'bear-24', type: 'bear', title: '资金费率过热（杠杆拥挤）', desc: '资金费率过热，杠杆拥挤度达到历史极值。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375541234_Usecasestylizedc.png', emoji: '🔥' },
  { id: 'bear-25', type: 'bear', title: '美元指数走强', desc: '美元指数强势走高，持续压制风险资产估值。', level: 1, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375558977_Usecasestylizedc.png', emoji: '💵' },
  { id: 'bear-26', type: 'bear', title: '美股大跌拖累风险资产', desc: '美股大幅下跌，全球风险偏好急转直下。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375559835_Usecasestylizedc.png', emoji: '📉' },
  { id: 'bear-27', type: 'bear', title: '代币大额解锁', desc: '巨量代币解锁进入流通，市场抛压巨大。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375558223_Usecasestylizedc.png', emoji: '🔓' },
  { id: 'bear-28', type: 'bear', title: '政府查封扣押币拍卖', desc: '政府拍卖查封扣押的加密货币，市场明显承压。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375557888_Usecasestylizedc.png', emoji: '🔨' },
  { id: 'bear-29', type: 'bear', title: '主流公链升级失败/宕机', desc: '主流公链升级失败导致网络宕机，生态活动停滞。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375557552_Usecasestylizedc.png', emoji: '🛑' },
  { id: 'bear-30', type: 'bear', title: '市场恐慌指数飙升', desc: '恐慌指数飙升，市场陷入恐慌性抛售。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375560199_Usecasestylizedc.png', emoji: '😱' },
];

// ============ 利多事件（30个） ============
export const BULL_EVENTS: GameEventDef[] = [
  { id: 'bull-1', type: 'bull', title: 'CPI低于预期', desc: '美国CPI数据低于预期，通胀降温大幅提振风险资产。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375578752_Usecasestylizedc.png', emoji: '📉' },
  { id: 'bull-2', type: 'bull', title: '非农数据疲软（降息预期升温）', desc: '非农就业数据疲软，市场降息预期升温利好加密市场。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375576279_Usecasestylizedc.png', emoji: '💼' },
  { id: 'bull-3', type: 'bull', title: '美联储宣布降息', desc: '美联储宣布下调基准利率，流动性宽松预期全面升温。', level: 1, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375577903_Usecasestylizedc.png', emoji: '🏦' },
  { id: 'bull-4', type: 'bull', title: '美联储暂停加息', desc: '美联储宣布暂停加息，紧缩周期有望迎来终点。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375577129_Usecasestylizedc.png', emoji: '🕊️' },
  { id: 'bull-5', type: 'bull', title: '比特币现货ETF获批', desc: '比特币现货ETF正式获批，机构资金大规模涌入。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375581012_Usecasestylizedc.png', emoji: '✅' },
  { id: 'bull-6', type: 'bull', title: 'ETF单日巨额净流入', desc: '现货ETF单日净流入创下纪录，机构抢筹迹象明显。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375580181_Usecasestylizedc.png', emoji: '💰' },
  { id: 'bull-7', type: 'bull', title: '上市公司宣布囤币', desc: '上市公司宣布将加密资产纳入储备，市场情绪沸腾。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375903132_Usecasestylizedc.png', emoji: '🏢' },
  { id: 'bull-8', type: 'bull', title: '某国宣布比特币为法定货币', desc: '某国宣布比特币为法定货币，加密采用率再上台阶。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375903986_Usecasestylizedc.png', emoji: '🌍' },
  { id: 'bull-9', type: 'bull', title: '支付巨头接入加密货币', desc: '支付巨头宣布接入加密货币支付，应用场景全面爆发。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375902615_Usecasestylizedc.png', emoji: '💳' },
  { id: 'bull-10', type: 'bull', title: '大型银行托管加密资产', desc: '大型银行推出加密资产托管服务，机构化进程加速。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375916397_Usecasestylizedc.png', emoji: '🏛️' },
  { id: 'bull-11', type: 'bull', title: '稳定币法案通过', desc: '稳定币监管法案正式通过，行业合规化进程提速。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375916836_Usecasestylizedc.png', emoji: '📜' },
  { id: 'bull-12', type: 'bull', title: '监管沙盒试点启动', desc: '多国启动加密监管沙盒试点，政策风向转向友好。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375915487_Usecasestylizedc.png', emoji: '🧪' },
  { id: 'bull-13', type: 'bull', title: '山寨币集体拉升', desc: '山寨币集体拉升，市场赚钱效应显著回归。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375929516_Usecasestylizedc.png', emoji: '🚀' },
  { id: 'bull-14', type: 'bull', title: '减半周期临近', desc: '减半周期临近，市场对供应减半的预期持续升温。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375929121_Usecasestylizedc.png', emoji: '⏳' },
  { id: 'bull-15', type: 'bull', title: '链上活跃地址创新高', desc: '链上活跃地址数创下历史新高，用户采用加速。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375928302_Usecasestylizedc.png', emoji: '🌐' },
  { id: 'bull-16', type: 'bull', title: '交易所比特币储备降至新低', desc: '交易所比特币储备降至历史新低，供应持续紧张。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375943625_Usecasestylizedc.png', emoji: '📦' },
  { id: 'bull-17', type: 'bull', title: '巨鲸持续增持', desc: '巨鲸地址持续增持，市场筹码不断集中。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375940791_Usecasestylizedc.png', emoji: '🐋' },
  { id: 'bull-18', type: 'bull', title: '长期持有者拒绝抛售', desc: '长期持有者持仓创历史新高，市场供应被牢牢锁定。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375941194_Usecasestylizedc.png', emoji: '💎' },
  { id: 'bull-19', type: 'bull', title: '全网算力创新高', desc: '全网算力创下历史新高，矿工信心十足。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375955759_Usecasestylizedc.png', emoji: '⚙️' },
  { id: 'bull-20', type: 'bull', title: '主流公链重大升级成功', desc: '主流公链重大升级成功，性能与体验大幅提升。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375957401_Usecasestylizedc.png', emoji: '🛠️' },
  { id: 'bull-21', type: 'bull', title: 'DeFi锁仓量大涨', desc: 'DeFi总锁仓量大幅上涨，资金疯狂涌入链上。', level: 4, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375954040_Usecasestylizedc.png', emoji: '🔒' },
  { id: 'bull-22', type: 'bull', title: '新叙事板块爆发', desc: '新叙事板块全面爆发，市场热点快速轮动。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375968876_Usecasestylizedc.png', emoji: '✨' },
  { id: 'bull-23', type: 'bull', title: '空头集中爆仓', desc: '空头集中爆仓引发逼空行情，价格急速拉升。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375970217_Usecasestylizedc.png', emoji: '💥' },
  { id: 'bull-24', type: 'bull', title: '资金费率转负后反弹', desc: '资金费率转负后快速反弹，空头被迫回补。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375969328_Usecasestylizedc.png', emoji: '↩️' },
  { id: 'bull-25', type: 'bull', title: '美元指数走弱', desc: '美元指数走弱，风险资产估值迎来修复。', level: 1, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375982941_Usecasestylizedc.png', emoji: '💵' },
  { id: 'bull-26', type: 'bull', title: '股市大涨带动风险偏好', desc: '股市大涨带动风险偏好回升，加密市场联动上行。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375981937_Usecasestylizedc.png', emoji: '📈' },
  { id: 'bull-27', type: 'bull', title: '主权基金配置加密资产', desc: '主权基金宣布配置加密资产，长期资金正式入市。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375983380_Usecasestylizedc.png', emoji: '🏛️' },
  { id: 'bull-28', type: 'bull', title: '头部项目宣布大额回购', desc: '头部项目宣布大额回购计划，市场抛压骤减。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375994464_Usecasestylizedc.png', emoji: '🔄' },
  { id: 'bull-29', type: 'bull', title: '矿工惜售、囤币观望', desc: '矿工惜售囤币，市场供应持续收紧。', level: 2, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375996749_Usecasestylizedc.png', emoji: '⛏️' },
  { id: 'bull-30', type: 'bull', title: '知名投资人公开唱多', desc: '知名投资人公开唱多加密市场，市场情绪高涨。', level: 3, image: 'https://mdn.alipayobjects.com/asap_serivce/uri/file/as/aigc_1789375994887_Usecasestylizedc.png', emoji: '📣' },
];

export const ALL_EVENTS: GameEventDef[] = [...BEAR_EVENTS, ...BULL_EVENTS];

export function getEventById(id: string): GameEventDef | null {
  return ALL_EVENTS.find(e => e.id === id) || null;
}

// 每日判定：25%概率成为事件日，从30天内未触发过的事件中随机选一个
// @param day 当前第几天
// @param history 事件ID -> 上次触发的天数
export function pickDailyEvent(day: number, history: Record<string, number>): { day: number; eventId: string } | null {
  if (Math.random() >= 0.25) return null;
  const eligible = ALL_EVENTS.filter(e => {
    const lastDay = history[e.id];
    return typeof lastDay !== 'number' || day - lastDay > 30;
  });
  if (eligible.length === 0) return null;
  const chosen = eligible[Math.floor(Math.random() * eligible.length)];
  return { day, eventId: chosen.id };
}

// 计算事件对价格的影响乘数（当前回合适用）
// 仅在事件公布当回合生效：按代币分级（tier）调整盘口生成基准价格与K线收盘价
// 公布后的24回合不再直接改变价格方向，改为调整代币随机波动机制的涨跌概率（见 getEventUpProbability）
export function getEventPriceMultiplier(active: ActiveGameEvent | null, currentRound: number, tier: number): number {
  if (!active) return 1;
  const roundsAfter = currentRound - active.announcementRound;
  if (roundsAfter !== 0) return 1;
  const effects = EVENT_LEVEL_EFFECTS[active.level] || EVENT_LEVEL_EFFECTS[1];
  const pct = effects.announce[tier] ?? 0;
  if (pct <= 0) return 1;
  return active.type === 'bull' ? 1 + pct : 1 - pct;
}

// 计算事件公布后24回合内，代币随机波动机制每回合上涨的概率
// 利多：按等级 80%/70%/60%/60%；利空：上下概率对调（20%/30%/40%/40%）
// 公布当回合（roundsAfter === 0）或窗口外返回 null（维持50/50随机）
export function getEventUpProbability(active: ActiveGameEvent | null, currentRound: number): number | null {
  if (!active) return null;
  const roundsAfter = currentRound - active.announcementRound;
  if (roundsAfter <= 0 || roundsAfter > 24) return null;
  const effects = EVENT_LEVEL_EFFECTS[active.level] || EVENT_LEVEL_EFFECTS[1];
  const upProb = effects.upProb;
  return active.type === 'bull' ? upProb : 1 - upProb;
}

// ============ 突发事件机制（针对单一代币或全市场） ============
// 与市场事件不同：每回合1%概率触发，随机选择一个突发事件并随机选择一个代币触发，一回合最多一次
export interface SuddenEventDef {
  id: string;
  title: string;
  desc: string;
  emoji: string;
  durationRounds: number; // 持续时间（回合数，7天 = 168回合）
  type: 'bull' | 'bear';  // 触发当回合价格方向（利多/利空1级）
  scope: 'single' | 'all' | 'top-gainer'; // 影响范围：单一代币 / 全市场所有代币 / 涨幅榜榜一代币
  spotSuspend?: boolean;      // 现货交易暂停7天（触发当回合不暂停，随后7天暂停，与黑客攻击一致）
  futuresOpenBlock?: boolean; // 合约暂停开仓7天（仅允许平仓）
  orderReduce?: boolean;      // 现货盘口与合约盘口生成订单减少50%
  exchangeDown?: boolean;     // 交易所宕机：全市场暂停合约交易一回合
}

export const SUDDEN_EVENTS: SuddenEventDef[] = [
  {
    id: 'sudden-hack',
    title: '黑客攻击',
    desc: '链上安全监控系统监测到异常：该代币的官方合约遭到黑客攻击，攻击者已批量转移大量代币并持续抛售，社区陷入恐慌，项目方宣布紧急停机排查。受此影响，该代币现货交易（CEX/DEX）将暂停7天，期间仅保留合约交易，安全团队正全力追查资金流向。',
    emoji: '👾',
    durationRounds: 168, // 7天 = 168回合
    type: 'bear',
    scope: 'single',
    spotSuspend: true,
  },
  {
    id: 'sudden-wallet-stolen',
    title: '项目方钱包被盗',
    desc: '噩耗传来：该代币项目方热钱包遭黑客入侵，大批代币被转走并流向市场，投资者对项目资金安全彻底失去信心，社群里挤满了恐慌的质问。受此影响，该代币现货交易（CEX/DEX）将暂停7天，期间仅保留合约交易，项目方连夜发布声明安抚社区。',
    emoji: '💰',
    durationRounds: 168,
    type: 'bear',
    scope: 'single',
    spotSuspend: true,
  },
  {
    id: 'sudden-regulatory',
    title: '监管叫停',
    desc: '监管机构向该代币项目下达责令整改通知，要求其暂停相关业务运营并配合调查，消息一出市场风声鹤唳，大户纷纷撤单观望。受此影响，该代币现货交易（CEX/DEX）将暂停7天，合约市场同步暂停开仓、仅允许平仓，恢复时间视监管进展而定。',
    emoji: '🚨',
    durationRounds: 168,
    type: 'bear',
    scope: 'single',
    spotSuspend: true,
    futuresOpenBlock: true,
  },
  {
    id: 'sudden-squeeze',
    title: '逼空行情',
    desc: '该代币空头仓位遭遇集中爆仓，连环强平推动价格急速拉升，多头情绪彻底点燃，社交媒体上“上车”喊单刷屏。本次行情仅针对当前涨幅榜榜首代币（24h涨幅需超过20%），触发当回合价格强势上涨，空头损失惨重。',
    emoji: '🚀',
    durationRounds: 1,
    type: 'bull',
    scope: 'top-gainer',
  },
  {
    id: 'sudden-mm-bankrupt',
    title: '做市商破产',
    desc: '负责该代币流动性的做市商因风控失当宣告破产清算，做市账户被冻结，盘口深度骤降，买卖价差迅速拉大，散户叫苦不迭。受此影响，该代币现货与合约盘口订单生成量将减少50%，持续7天，流动性修复尚需时日。',
    emoji: '💥',
    durationRounds: 168,
    type: 'bear',
    scope: 'single',
    orderReduce: true,
  },
  {
    id: 'sudden-exchange-down',
    title: '交易所宕机',
    desc: '交易所核心撮合系统突发宕机，全站合约交易被迫中断，海量挂单无法成交，客服渠道被挤爆，用户恐慌情绪蔓延至整个市场。宕机当回合全市场所有代币暂停合约交易，预计恢复交易后波动将异常剧烈，请谨慎操作。',
    emoji: '⛔',
    durationRounds: 1,
    type: 'bear',
    scope: 'all',
    exchangeDown: true,
  },
  {
    id: 'sudden-rug',
    title: '项目方跑路',
    desc: '重磅暴雷：该代币项目方已将流动性及募资资金全部转移，团队集体失联，疑似卷款跑路（RUG），维权群瞬间涌进成千上万名受害者。消息传出当回合，该代币遭遇恐慌性抛售，价格大幅下跌。',
    emoji: '🏃',
    durationRounds: 1,
    type: 'bear',
    scope: 'single',
  },
  {
    id: 'sudden-treasury',
    title: '项目国库被盗',
    desc: '该代币项目国库多签钱包遭黑客突破，国库资金被大量盗走，项目开发与生态建设陷入停滞，投资者纷纷质疑项目还能否维持运营。消息传出当回合，该代币遭遇恐慌性抛售，价格大幅下跌。',
    emoji: '🏦',
    durationRounds: 1,
    type: 'bear',
    scope: 'single',
  },
  {
    id: 'sudden-insurance',
    title: '保险基金不足',
    desc: '该代币合约的保险基金余额已跌破警戒线，无法覆盖潜在穿仓风险，平台风控系统自动介入熔断。受此影响，该代币合约市场将暂停开仓7天，仅允许平仓，以控制系统性风险，请持仓用户注意仓位安全。',
    emoji: '🛡️',
    durationRounds: 168,
    type: 'bear',
    scope: 'single',
    futuresOpenBlock: true,
  },
];

// 按ID查找突发事件定义
export function getSuddenEventDef(id: string): SuddenEventDef | null {
  return SUDDEN_EVENTS.find(e => e.id === id) || null;
}

// 每回合1%概率触发突发事件
export function rollSuddenEvent(): boolean {
  return Math.random() < 0.01;
}

// 突发事件当回合下跌乘数（等同利空1级事件，按代币tier）
// 复用 EVENT_LEVEL_EFFECTS[1].announce 的下跌比例
export function getSuddenEventBearMultiplier(tier: number): number {
  const effects = EVENT_LEVEL_EFFECTS[1];
  const pct = effects.announce[tier] ?? 0.2;
  return Math.max(0.5, 1 - pct);
}

// 突发事件当回合上涨乘数（等同利多1级事件，按代币tier）
export function getSuddenEventBullMultiplier(tier: number): number {
  const effects = EVENT_LEVEL_EFFECTS[1];
  const pct = effects.announce[tier] ?? 0.2;
  return 1 + pct;
}

// 生成事件影响文字说明（用于弹窗展示）
export function getEventEffectText(level: number, type: 'bull' | 'bear'): string {
  const effects = EVENT_LEVEL_EFFECTS[level] || EVENT_LEVEL_EFFECTS[1];
  const dir = type === 'bull' ? '上涨' : '下跌';
  const sign = type === 'bull' ? '+' : '-';
  const upProb = type === 'bull' ? effects.upProb : 1 - effects.upProb;
  const upPct = Math.round(upProb * 100);
  const downPct = 100 - upPct;
  const lines: string[] = [];
  lines.push(`事件公布当回合（20:00）：${type === 'bull' ? '利多' : '利空'}${level}级`);
  if (level === 4) {
    lines.push('• 当回合：无反应');
  }
  ([6, 5, 4, 3, 2, 1] as number[]).forEach(tier => {
    const pct = effects.announce[tier] ?? 0;
    if (pct > 0) {
      lines.push(`• ${TIER_LABEL_ARR[tier]}代币盘口基准价与K线收盘价${dir}${Math.round(pct * 100)}%`);
    }
  });
  lines.push(`公布后24回合内：代币随机波动机制每回合上涨概率 ${upPct}%、下跌概率 ${downPct}%`);
  lines.push(`恐惧贪婪指数${sign}${effects.fearGreed}`);
  return lines.join('\n');
}