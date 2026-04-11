import { SignalDirection } from '../core/constants/enums.js';
import { StrategyContext, SignalLevels, StrategySignalCandidate } from '../core/types/bot-types.js';

// HTF: wider risk corridor (1H candles have naturally larger ATR)
const MIN_RISK_PERCENT = 1.0;  // Minimum SL distance: 1.0%
const MAX_RISK_PERCENT = 7.0;  // HTF: Capped at 7% to prevent catastrophic losses on volatile coins

const TP_WEIGHTS = [0.35, 0.35, 0.15, 0.15];

export class RiskEngine {
    static calculateLevels(ctx: StrategyContext, candidate: StrategySignalCandidate): SignalLevels {
        const { direction, suggestedEntry, suggestedTarget, suggestedSl } = candidate;
        const last = ctx.candles[ctx.candles.length - 1];
        const atr = ctx.indicators.atr;
        const entry = suggestedEntry || last.close;
        
        let sl: number;
        if (suggestedSl) {
            sl = suggestedSl;
        } else if (direction === SignalDirection.LONG) {
            sl = Math.min(ctx.liquidity.localRangeLow || (entry - 3 * atr), entry - 2.5 * atr);
        } else {
            sl = Math.max(ctx.liquidity.localRangeHigh || (entry + 3 * atr), entry + 2.5 * atr);
        }

        let risk = Math.abs(entry - sl);
        let currentRiskPct = (risk / entry) * 100;

        if (currentRiskPct > MAX_RISK_PERCENT) {
            risk = entry * (MAX_RISK_PERCENT / 100);
            sl = direction === SignalDirection.LONG ? entry - risk : entry + risk;
        } else if (currentRiskPct < MIN_RISK_PERCENT) {
            risk = entry * (MIN_RISK_PERCENT / 100);
            sl = direction === SignalDirection.LONG ? entry - risk : entry + risk;
        }

        let primaryTarget = suggestedTarget;

        if (!primaryTarget) {
            primaryTarget = direction === SignalDirection.LONG 
                ? (ctx.liquidity.localRangeHigh || entry + risk * 4.0)
                : (ctx.liquidity.localRangeLow || entry - risk * 4.0);
        }

        if (direction === SignalDirection.LONG && primaryTarget <= entry) {
            primaryTarget = ctx.liquidity.localRangeHigh && ctx.liquidity.localRangeHigh > entry
                ? ctx.liquidity.localRangeHigh
                : entry + risk * 4.0;
        }
        if (direction === SignalDirection.SHORT && primaryTarget >= entry) {
            primaryTarget = ctx.liquidity.localRangeLow && ctx.liquidity.localRangeLow < entry
                ? ctx.liquidity.localRangeLow
                : entry - risk * 4.0;
        }

        const targetDistance = Math.abs(primaryTarget - entry);
        if (targetDistance < risk * 2.5) {
            primaryTarget = direction === SignalDirection.LONG
                ? entry + risk * 3.0
                : entry - risk * 3.0;
        }

        let tp: number[] = [];
        if (direction === SignalDirection.LONG) {
            tp[0] = entry + (primaryTarget - entry) * 0.6; // TP1 is 60% of the movement towards main target
            tp[1] = primaryTarget;                         // TP2 is main target
            tp[2] = Math.max(primaryTarget + atr * 2, entry + risk * 4.0); // Extending tail targets significantly
            tp[3] = Math.max(primaryTarget + atr * 4, entry + risk * 5.5);
        } else {
            tp[0] = entry - (entry - primaryTarget) * 0.6;
            tp[1] = primaryTarget;
            tp[2] = Math.min(primaryTarget - atr * 2, entry - risk * 4.0);
            tp[3] = Math.min(primaryTarget - atr * 4, entry - risk * 5.5);
        }

        if (direction === SignalDirection.LONG) {
            tp = tp.map((t, i) => t > entry ? t : entry + risk * (2.0 + i * 0.8));
        } else {
            tp = tp.map((t, i) => t < entry ? t : entry - risk * (2.0 + i * 0.8));
        }

        const rrLadder = tp.map(t => Math.abs(t - entry) / risk);
        const riskPercent = (risk / entry) * 100;
        const weightedRR = rrLadder.reduce((sum, current_rr, i) => sum + current_rr * TP_WEIGHTS[i], 0);

        return {
            entry,
            sl,
            tp,
            riskPercent,
            rrRatio: parseFloat(weightedRR.toFixed(2))
        };
    }
}
