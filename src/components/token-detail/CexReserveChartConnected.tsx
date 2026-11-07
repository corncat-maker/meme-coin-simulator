/**
 * CEX 库存图表（store 订阅版）
 *
 * 抽离后由组件自己订阅 `cexReserveHistory`，App 只负责写入、
 * 不再因库存历史更新而整树重渲染。
 */
import { useMarketValue } from '../../store/marketStore';
import { CexReserveChart } from './CexReserveChart';

interface CexReserveChartConnectedProps {
  tokenId: string;
  tokenCode: string;
  currentRound: number;
}

export function CexReserveChartConnected({ tokenId, tokenCode, currentRound }: CexReserveChartConnectedProps) {
  const cexReserveHistory = useMarketValue('cexReserveHistory');
  const history = cexReserveHistory[tokenId] || [];
  return <CexReserveChart tokenCode={tokenCode} history={history} currentRound={currentRound} />;
}
