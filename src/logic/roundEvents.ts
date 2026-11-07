// 域四-5：回合事件系统（纯函数）
// 从 src/App.tsx 的「每日市场事件 + 突发事件 + 开发者模式事件」机械搬迁：
// 只读入参（事件 ref 值 / 恐惧贪婪 / 代币列表），返回完整的下一状态（NextEventsState）与待渲染数据，
// 不在内部 setState、不写 ref、不触发 toast，也不生成全局随机数（随机源由入参 rnd 注入）。
import { getEventById, EVENT_LEVEL_EFFECTS, SUDDEN_EVENTS, getSuddenEventDef } from '../constants/events';
import type { ActiveGameEvent, SuddenEventDef } from '../constants/events';
import { isHackedToken, isFuturesOpenBlocked, isTokenOrderReduced } from '../data/tokenMeta';
import { roundToTime } from './delist';
import type { Announcement, Token } from '../types';

export interface TodayEvent {
  day: number;
  eventId: string;
}

export interface SuddenEventState {
  eventId: string;
  tokenId: string;
  tokenCode: string;
  tokenName: string;
  round: number;
  endRound?: number;
  affectAll?: boolean;
}

export interface DevTokenEventState {
  tokenId: string;
  type: 'bull' | 'bear';
  level: number;
  startRound: number;
}

export interface PendingDevTokenEvent {
  tokenId: string;
  type: 'bull' | 'bear';
  level: number;
}

export interface RoundEventsInput {
  /** 新回合号 */
  round: number;
  /** 新天数（第几回合内的天） */
  day: number;
  /** 本回合开始时的代币列表（只读） */
  tokens: Token[];
  eventHistory: Record<string, number>;
  todayEvent: TodayEvent | null;
  activeEvent: ActiveGameEvent | null;
  suddenEvent: SuddenEventState | null;
  exchangeDownRound: number | null;
  pendingDevHack: { eventId: string; tokenId: string } | null;
  pendingDevTokenEvent: PendingDevTokenEvent | null;
  devTokenEvent: DevTokenEventState | null;
  /** 事件处理前的恐惧贪婪指数（已完成本回合的随机波动） */
  fearGreedIndex: number;
  /** 随机源（调用顺序与旧实现一致） */
  rnd: () => number;
  makeId: () => string;
  /** 每日事件抽取（默认使用 constants/events 的实现；保留注入点便于后续确定性改造） */
  pickDaily?: (day: number, history: Record<string, number>) => TodayEvent | null;
  /** 突发事件判定（默认使用 constants/events 的实现） */
  rollSudden?: () => boolean;
}

export interface RoundEventsResult {
  eventHistory: Record<string, number>;
  todayEvent: TodayEvent | null;
  activeEvent: ActiveGameEvent | null;
  suddenEvent: SuddenEventState | null;
  exchangeDownRound: number | null;
  devTokenEvent: DevTokenEventState | null;
  /** devTokenEvent 是否发生变化（App 侧据此写 ref + setState） */
  devTokenEventChanged: boolean;
  pendingDevHackConsumed: boolean;
  pendingDevTokenEventConsumed: boolean;
  fearGreedIndex: number;
  /** 事件是否修改了恐惧贪婪指数（App 侧据此 setState） */
  fearGreedChanged: boolean;
  showEventModal: boolean;
  showSuddenEventModal: boolean;
  /** 待写入的社区公告（按时间顺序：先市场事件、后突发事件） */
  announcements: Announcement[];
  /** 本回合被现货停牌类事件影响的代币 ID */
  suddenHackTokenIds: string[];
  /** 本回合受当回合涨跌影响的代币 ID -> 方向 */
  suddenEventEffects: Record<string, 'bull' | 'bear'>;
  /** 本回合触发的代币 ID -> 事件定义 */
  suddenEventInfoByToken: Record<string, SuddenEventDef>;
}

export function resolveRoundEvents(input: RoundEventsInput): RoundEventsResult {
  const {
    round: newRound,
    day: newDayCount,
    tokens,
    fearGreedIndex,
    rnd,
    makeId,
    pickDaily = () => null,
    rollSudden = () => false,
  } = input;

  const tokenMap = new Map<string, Token>();
  tokens.forEach(t => tokenMap.set(t.id, t));

  const announcements: Announcement[] = [];

  let eventHistory = { ...input.eventHistory };
  let todayEvent = input.todayEvent;
  let activeEvent = input.activeEvent;
  let showEventModal = false;

  // 事件影响窗口过期清理（公布后24回合结束）
  if (activeEvent && newRound > activeEvent.announcementRound + 24) {
    activeEvent = null;
  }

  // 每日00:00判定新一天是否为事件日
  if (newRound % 24 === 0) {
    todayEvent = pickDaily(newDayCount, eventHistory);
  }

  // 每日20:00触发当日事件
  let fearGreed = fearGreedIndex;
  let fearGreedChanged = false;
  if (newRound % 24 === 20 && todayEvent && todayEvent.day === newDayCount) {
    const evDef = getEventById(todayEvent.eventId);
    if (evDef) {
      activeEvent = {
        eventId: evDef.id,
        type: evDef.type,
        level: evDef.level,
        day: newDayCount,
        announcementRound: newRound,
      };
      eventHistory[evDef.id] = newDayCount;
      todayEvent = null;
      showEventModal = true;
      announcements.push({
        id: makeId(),
        type: 'market',
        title: `${evDef.emoji} ${evDef.title}`,
        content: `今日市场事件公布：${evDef.type === 'bull' ? '利多' : '利空'}${evDef.level}级。${evDef.desc}`,
        round: newRound,
        day: newDayCount,
      });
      // 事件影响恐惧贪婪指数（利多上涨、利空下跌）
      const fgDelta = EVENT_LEVEL_EFFECTS[evDef.level].fearGreed * (evDef.type === 'bull' ? 1 : -1);
      fearGreed = Math.max(0, Math.min(100, Math.floor(fearGreed + fgDelta)));
      fearGreedChanged = true;
    }
  }

  // ========== 突发事件机制（单一代币 / 全市场） ==========
  let suddenEvent = input.suddenEvent;
  let showSuddenEventModal = false;
  let exchangeDownRound = input.exchangeDownRound;
  const suddenHackTokenIds = new Set<string>();
  const suddenEventEffects: Record<string, 'bull' | 'bear'> = {};
  const suddenEventInfoByToken: Record<string, SuddenEventDef> = {};

  // 触发一个突发事件（evDef：事件定义；tokenId：指定代币，仅 scope=single 时使用）
  const triggerSuddenEvent = (evDef: SuddenEventDef, tokenId: string | null): boolean => {
    let affectedIds: string[] = [];
    if (evDef.scope === 'all') {
      affectedIds = tokens.filter(t => t.cexListed !== false).map(t => t.id);
    } else if (evDef.scope === 'top-gainer') {
      // 涨幅榜榜一：24h涨幅最高的已上架代币（需满足24h涨幅＞20%）
      const gainer = [...tokens]
        .filter(t => t.cexListed !== false && typeof t.change24h === 'number' && t.change24h > 20)
        .sort((a, b) => (b.change24h || 0) - (a.change24h || 0))[0];
      if (!gainer) return false;
      affectedIds = [gainer.id];
    } else {
      if (!tokenId) return false;
      const target = tokenMap.get(tokenId);
      if (!target || target.cexListed === false) return false;
      affectedIds = [tokenId];
    }
    if (affectedIds.length === 0) return false;

    affectedIds.forEach(tid => {
      suddenEventEffects[tid] = evDef.type;
      suddenEventInfoByToken[tid] = evDef;
      if (evDef.spotSuspend) suddenHackTokenIds.add(tid);
    });

    // 交易所宕机：记录宕机回合（当回合全市场合约暂停）
    if (evDef.exchangeDown) {
      exchangeDownRound = newRound;
    }

    // 弹窗信息
    const firstAffectedToken = tokenMap.get(affectedIds[0]);
    if (evDef.scope === 'all') {
      suddenEvent = { eventId: evDef.id, tokenId: 'all', tokenCode: '全市场', tokenName: '全部代币', round: newRound, endRound: newRound, affectAll: true };
    } else if (firstAffectedToken) {
      suddenEvent = {
        eventId: evDef.id,
        tokenId: firstAffectedToken.id,
        tokenCode: firstAffectedToken.code,
        tokenName: firstAffectedToken.name,
        round: newRound,
        endRound: evDef.durationRounds > 1 ? newRound + evDef.durationRounds + 1 : newRound,
      };
    }
    showSuddenEventModal = true;

    // 【社区公告】记录突发事件公告
    const scopeText = evDef.scope === 'all'
      ? '全市场所有代币'
      : evDef.scope === 'top-gainer'
        ? `受影响代币：${firstAffectedToken ? `${firstAffectedToken.code}（${firstAffectedToken.name}）` : '涨幅榜榜一'}`
        : `受影响代币：${firstAffectedToken ? `${firstAffectedToken.code}（${firstAffectedToken.name}）` : ''}`;
    const effectText = evDef.spotSuspend
      ? ` 该代币现货交易暂停至 ${roundToTime(newRound + evDef.durationRounds + 1)}，期间仅保留合约交易。`
      : evDef.exchangeDown
        ? ' 全市场合约交易暂停一回合，恢复后波动剧烈，请注意风险。'
        : '';
    const watchNoteText = evDef.exchangeDown
      ? ''
      : ' 该代币已被标记为"观察"，突发事件影响结束后将恢复正常标签。';
    announcements.push({
      id: makeId(),
      type: 'sudden',
      title: `${evDef.emoji} ${evDef.title}（突发${evDef.type === 'bull' ? '利好' : '利空'}）`,
      content: `${scopeText}。${evDef.desc}${effectText}${watchNoteText}`,
      round: newRound,
      day: newDayCount,
      tokenCode: evDef.scope === 'all' ? '全市场' : (firstAffectedToken?.code || ''),
      tokenName: evDef.scope === 'all' ? '全部代币' : (firstAffectedToken?.name || ''),
    });
    return true;
  };

  // 判断代币是否可触发某事件（未处于同类事件效果中）
  const canTriggerOnToken = (evDef: SuddenEventDef, t: Token): boolean => {
    if (t.cexListed === false) return false;
    if (evDef.spotSuspend && isHackedToken(t, newRound)) return false;
    if (evDef.futuresOpenBlock && isFuturesOpenBlocked(t, newRound)) return false;
    if (evDef.orderReduce && isTokenOrderReduced(t, newRound)) return false;
    return true;
  };

  // 开发者模式：指定事件+代币触发突发事件（下一回合生效）
  let pendingDevHackConsumed = false;
  if (input.pendingDevHack) {
    const devSe = input.pendingDevHack;
    const evDef = getSuddenEventDef(devSe.eventId);
    if (evDef) {
      if (evDef.scope === 'single') {
        const devTarget = tokenMap.get(devSe.tokenId);
        if (devTarget && canTriggerOnToken(evDef, devTarget)) {
          triggerSuddenEvent(evDef, devSe.tokenId);
        }
      } else {
        // 交易所宕机（全市场）/ 逼空行情（涨幅榜榜一）无需指定代币，直接触发
        triggerSuddenEvent(evDef, null);
      }
    }
    pendingDevHackConsumed = true;
  }

  // 开发者模式：指定代币触发利多/利空事件（下一回合生效）
  let devTokenEvent = input.devTokenEvent;
  let devTokenEventChanged = false;
  let pendingDevTokenEventConsumed = false;
  if (input.pendingDevTokenEvent) {
    const devTe = input.pendingDevTokenEvent;
    const devTarget = tokenMap.get(devTe.tokenId);
    if (devTarget && devTarget.cexListed !== false) {
      devTokenEvent = { ...devTe, startRound: newRound };
      devTokenEventChanged = true;
    }
    pendingDevTokenEventConsumed = true;
  }

  // 开发者模式：指定代币事件超过24回合窗口后自动结束
  if (devTokenEvent && newRound > devTokenEvent.startRound + 24) {
    devTokenEvent = null;
    devTokenEventChanged = true;
  }

  // 随机触发：每回合1%概率，随机选择一个突发事件，再随机选择一个代币触发
  if (Object.keys(suddenEventEffects).length === 0 && rollSudden() && tokens.length > 0) {
    const evDef = SUDDEN_EVENTS[Math.floor(rnd() * SUDDEN_EVENTS.length)];
    if (evDef.scope === 'all' || evDef.scope === 'top-gainer') {
      triggerSuddenEvent(evDef, null);
    } else {
      const eligibleTokens = tokens.filter(t => canTriggerOnToken(evDef, t));
      if (eligibleTokens.length > 0) {
        triggerSuddenEvent(evDef, eligibleTokens[Math.floor(rnd() * eligibleTokens.length)].id);
      }
    }
  }

  return {
    eventHistory,
    todayEvent,
    activeEvent,
    suddenEvent,
    exchangeDownRound,
    devTokenEvent,
    devTokenEventChanged,
    pendingDevHackConsumed,
    pendingDevTokenEventConsumed,
    fearGreedIndex: fearGreed,
    fearGreedChanged,
    showEventModal,
    showSuddenEventModal,
    announcements,
    suddenHackTokenIds: [...suddenHackTokenIds],
    suddenEventEffects,
    suddenEventInfoByToken,
  };
}
