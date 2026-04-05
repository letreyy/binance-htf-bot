import { SignalDirection } from '../core/constants/enums.js';
// HTF: wider risk corridor (1H candles have naturally larger ATR)
const MIN_RISK_PERCENT = 0.5; // Minimum SL distance: 0.5%
const MAX_RISK_PERCENT = 3.0; // Maximum SL distance: 3.0% (wider for 1H)
const TP_WEIGHTS = [0.35, 0.35, 0.15, 0.15];
export class RiskEngine {
    static calculateLevels(ctx, candidate) {
        const { direction, suggestedEntry, suggestedTarget, suggestedSl } = candidate;
        const last = ctx.candles[ctx.candles.length - 1];
        const atr = ctx.indicators.atr;
        const entry = suggestedEntry || last.close;
        let sl;
        if (suggestedSl) {
            sl = suggestedSl;
        }
        else if (direction === SignalDirection.LONG) {
            sl = Math.min(ctx.liquidity.localRangeLow || (entry - 2 * atr), entry - 1.5 * atr);
        }
        else {
            sl = Math.max(ctx.liquidity.localRangeHigh || (entry + 2 * atr), entry + 1.5 * atr);
        }
        let risk = Math.abs(entry - sl);
        let currentRiskPct = (risk / entry) * 100;
        if (currentRiskPct > MAX_RISK_PERCENT) {
            risk = entry * (MAX_RISK_PERCENT / 100);
            sl = direction === SignalDirection.LONG ? entry - risk : entry + risk;
        }
        else if (currentRiskPct < MIN_RISK_PERCENT) {
            risk = entry * (MIN_RISK_PERCENT / 100);
            sl = direction === SignalDirection.LONG ? entry - risk : entry + risk;
        }
        let primaryTarget = suggestedTarget;
        if (!primaryTarget) {
            primaryTarget = direction === SignalDirection.LONG
                ? (ctx.liquidity.localRangeHigh || entry + risk * 3.0)
                : (ctx.liquidity.localRangeLow || entry - risk * 3.0);
        }
        if (direction === SignalDirection.LONG && primaryTarget <= entry) {
            primaryTarget = ctx.liquidity.localRangeHigh && ctx.liquidity.localRangeHigh > entry
                ? ctx.liquidity.localRangeHigh
                : entry + risk * 3.0;
        }
        if (direction === SignalDirection.SHORT && primaryTarget >= entry) {
            primaryTarget = ctx.liquidity.localRangeLow && ctx.liquidity.localRangeLow < entry
                ? ctx.liquidity.localRangeLow
                : entry - risk * 3.0;
        }
        const targetDistance = Math.abs(primaryTarget - entry);
        if (targetDistance < risk * 2.0) {
            primaryTarget = direction === SignalDirection.LONG
                ? entry + risk * 2.5
                : entry - risk * 2.5;
        }
        let tp = [];
        if (direction === SignalDirection.LONG) {
            tp[0] = entry + (primaryTarget - entry) * 0.5;
            tp[1] = primaryTarget;
            tp[2] = Math.max(primaryTarget + atr, entry + risk * 2.5);
            tp[3] = Math.max(primaryTarget + 2 * atr, entry + risk * 3.5);
        }
        else {
            tp[0] = entry - (entry - primaryTarget) * 0.5;
            tp[1] = primaryTarget;
            tp[2] = Math.min(primaryTarget - atr, entry - risk * 2.5);
            tp[3] = Math.min(primaryTarget - 2 * atr, entry - risk * 3.5);
        }
        if (direction === SignalDirection.LONG) {
            tp = tp.map((t, i) => t > entry ? t : entry + risk * (1.5 + i * 0.5));
        }
        else {
            tp = tp.map((t, i) => t < entry ? t : entry - risk * (1.5 + i * 0.5));
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
//# sourceMappingURL=risk-engine.js.map