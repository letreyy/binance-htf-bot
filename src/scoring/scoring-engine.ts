import { config } from '../config/index.js';
import { ConfidenceLabel, MarketRegimeType, SignalDirection } from '../core/constants/enums.js';
import { StrategyContext, StrategySignalCandidate } from '../core/types/bot-types.js';

const MEAN_REVERSION_STRATEGIES = new Set([
    'HTF VWAP Reversion',
    'HTF Delta Divergence',
    'HTF BB Reversal',
    'HTF Volume Climax',
    'HTF RSI Divergence',
    'HTF Funding Skew',
]);

const TREND_FOLLOWING_STRATEGIES = new Set([
    'HTF EMA Pullback',
    'HTF EMA Cross',
    'HTF Order Block',
    'HTF Fair Value Gap',
    'HTF Range Retest Continuation',
]);

export class ScoringEngine {
    static calculate(ctx: StrategyContext, candidate: StrategySignalCandidate): { score: number, label: string } {
        let score = candidate.confidence;

        // PANIC regime is force-muted elsewhere; defensive zero here.
        if (ctx.regime.type === MarketRegimeType.PANIC) {
            return { score: 0, label: ConfidenceLabel.IGNORE };
        }

        const isMeanRev = MEAN_REVERSION_STRATEGIES.has(candidate.strategyName);
        const isTrendFollow = TREND_FOLLOWING_STRATEGIES.has(candidate.strategyName);

        // Trend-following bonus only applies to trend-following strategies
        if (ctx.regime.type === MarketRegimeType.TREND && isTrendFollow) {
            score += config.weights.regimeAlignment;
        }
        // Mean-reversion in TREND regime gets penalized — real data shows they lose badly
        if (ctx.regime.type === MarketRegimeType.TREND && isMeanRev) {
            score -= 15;
        }
        // High ADX penalizes mean-reversion further (ADX > 28 = strong trend)
        if (isMeanRev && ctx.indicators.adx > 28) {
            score -= 10;
        }

        const last = ctx.candles[ctx.candles.length - 1];
        if (ctx.indicators.volumeSma > 0 && last.volume > ctx.indicators.volumeSma * 1.5) {
            score += config.weights.volumeSpike;
        }
        if (ctx.liquidity.isWickSweep) score += config.weights.liquidityContext;

        if (ctx.funding) {
            // Extreme funding = crowded trade, contrarian edge
            if (ctx.funding.rate > 0.0005 && candidate.direction === SignalDirection.SHORT) score += 7;
            if (ctx.funding.rate < -0.0005 && candidate.direction === SignalDirection.LONG) score += 7;
            // Normal-range funding alignment
            if (ctx.funding.rate > 0.0001 && candidate.direction === SignalDirection.SHORT) score += 3;
            if (ctx.funding.rate < -0.0001 && candidate.direction === SignalDirection.LONG) score += 3;
        }

        if (ctx.openInterest && ctx.openInterest.oiHistory.length > 0) {
            const currentOi = ctx.openInterest.oi;
            const pastOi = ctx.openInterest.oiHistory[0];
            const oiIncreasing = currentOi > pastOi;
            // OI confirms trend-follow signals; diverging OI weakens them
            if (isTrendFollow) {
                if (oiIncreasing) score += 5;
                else score -= 3;
            }
        }

        // 4H candle alignment — soft signal (trend follow only)
        if (ctx.candles4h && ctx.candles4h.length > 0 && isTrendFollow) {
            const htf = ctx.candles4h[ctx.candles4h.length - 1];
            const htfBullish = htf.close > htf.open;
            if (
                (candidate.direction === SignalDirection.LONG && htfBullish) ||
                (candidate.direction === SignalDirection.SHORT && !htfBullish)
            ) {
                score += 5;
            } else {
                score -= 5; // conflicting 4H candle = small penalty
            }
        }

        // Hard BTC gate for ALL strategies (real-data: counter-BTC trades net negative
        // regardless of category — mean-reversion shorts in BTC bullish lost -61% / 16 trades).
        if (ctx.btcContext) {
            if (candidate.direction === SignalDirection.LONG && ctx.btcContext.trend === 'BEARISH') return { score: 0, label: ConfidenceLabel.IGNORE };
            if (candidate.direction === SignalDirection.SHORT && ctx.btcContext.trend === 'BULLISH') return { score: 0, label: ConfidenceLabel.IGNORE };
        }

        // Cap at 95 so bonus stacking can't clip every signal to a ceiling 100.
        // Real-data showed the 100-bucket had the worst PnL (-50% on 13 trades) because
        // many disparate setups all flattened to "perfect" — ranking became meaningless.
        score = Math.min(95, Math.max(0, score));

        let label = ConfidenceLabel.IGNORE;
        if (score >= 90) label = ConfidenceLabel.A_PLUS;
        else if (score >= 80) label = ConfidenceLabel.A;
        else if (score >= 70) label = ConfidenceLabel.B;
        else if (score >= 60) label = ConfidenceLabel.C;

        return { score, label };
    }
}
