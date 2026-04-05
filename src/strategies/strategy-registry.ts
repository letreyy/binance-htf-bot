import { HtfOrderBlockStrategy, HtfFairValueGapStrategy, HtfObMagnetStrategy, HtfFvgMagnetStrategy } from './modules/htf-smc-strategies.js';
import { HtfLiquiditySweepStrategy, HtfBreakoutFailureStrategy, HtfVwapReversionStrategy } from './modules/htf-core-strategies.js';
import { HtfEmaPullbackStrategy, HtfRsiDivergenceStrategy, HtfEmaCrossMomentumStrategy, HtfBollingerReversalStrategy, HtfVolumeClimaxStrategy, HtfDeltaDivergenceStrategy } from './modules/htf-swing-strategies.js';
import { Strategy } from './base/strategy.js';

// ═══════════════════════════════════════════════════════
// ACTIVE STRATEGIES — HTF (1H) strategies
// These are adapted versions of proven 15m strategies,
// plus new swing-trading setups designed for the 1H TF.
// ═══════════════════════════════════════════════════════
export const strategyRegistry: Strategy[] = [
    // SMC strategies — the bread and butter
    new HtfOrderBlockStrategy(),         // OB retest — institutional levels
    new HtfFairValueGapStrategy(),       // FVG fill — imbalance retest
    new HtfLiquiditySweepStrategy(),     // Liquidity sweeps on 1H

    // SMC Magnet trades (MARKET orders)
    new HtfObMagnetStrategy(),           // Trading pullbacks towards unmitigated OBs
    new HtfFvgMagnetStrategy(),          // Trading pullbacks towards unmitigated FVGs

    // Trend-following
    new HtfEmaPullbackStrategy(),        // NEW: swing pullback to EMA in trend
    new HtfEmaCrossMomentumStrategy(),   // Golden/Death cross on 1H

    // Mean-reversion
    new HtfVwapReversionStrategy(),      // VWAP mean reversion
    new HtfBollingerReversalStrategy(),  // BB band rejection
    new HtfDeltaDivergenceStrategy(),    // CVD proxy divergence

    // Reversal
    new HtfBreakoutFailureStrategy(),    // Failed breakout / bull-bear trap
    new HtfRsiDivergenceStrategy(),      // RSI divergence reversal
    new HtfVolumeClimaxStrategy(),       // Volume climax exhaustion
];
