import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';

export interface Strategy {
  name: string;
  id: string;
  execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
