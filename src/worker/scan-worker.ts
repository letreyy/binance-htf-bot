import { binanceClient } from '../exchange/binance/binance-client.js';
import { universeLoader } from '../market/universe/universe-loader.js';
import { logger } from '../core/utils/logger.js';
import { TechnicalIndicators } from '../market/indicators/indicator-engine.js';
import { MarketRegimeEngine } from '../market/regime/regime-engine.js';
import { LiquidityEngine } from '../market/liquidity/liquidity-engine.js';
import { strategyRegistry } from '../strategies/strategy-registry.js';
import { ScoringEngine } from '../scoring/scoring-engine.js';
import { RiskEngine } from '../risk/risk-engine.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';
import { tradeExecutor } from '../trading/trade-executor.js';
import { dedupStore } from '../state/dedup-store.js';
import { config } from '../config/index.js';
import { FinalSignal, StrategyContext, StrategySignalCandidate } from '../core/types/bot-types.js';
import { passesGlobalFilters, passesDirectionFilter } from '../strategies/global-filters.js';
import { TimeFilters } from '../market/time-filters.js';
import { CombinationEngine } from '../strategies/combination-engine.js';
import { statsService } from '../stats/stats-service.js';
import { TelemetryLogger } from './telemetry-logger.js';

export class ScanWorker {
    private isRunning: boolean = false;

    async start() {
        this.isRunning = true;
        logger.info('HTF Scan Worker started (1H timeframe)');
        this.runLoop();
    }

    private async runLoop() {
        while (this.isRunning) {
            try {
                const startTime = Date.now();
                await this.scan();
                const elapsed = Date.now() - startTime;
                const waitTime = Math.max(0, config.bot.scanIntervalSeconds * 1000 - elapsed);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } catch (err: any) {
                logger.error('Error in HTF scan loop', { error: err.message });
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    }

    private async scan() {
        const topSymbols = await universeLoader.getTopSymbols();

        // BTC context: use 4H candles for global trend on HTF bot
        let btcContext: { trend: 'BULLISH' | 'BEARISH'; price: number; ema200: number } | undefined;
        try {
            const btcCandles = await binanceClient.getKlines('BTCUSDT', '4h', 250);
            if (btcCandles && btcCandles.length > 200) {
                const btcInds = TechnicalIndicators.calculateSnapshot(btcCandles);
                const btcPrice = btcCandles[btcCandles.length - 1].close;
                btcContext = {
                    trend: btcPrice > btcInds.ema200 ? 'BULLISH' : 'BEARISH',
                    price: btcPrice,
                    ema200: btcInds.ema200
                };
            }
        } catch (err: any) {
            logger.warn('Failed to fetch BTC 4H context', { error: err.message });
        }

        for (const symbol of topSymbols) {
            if (!this.isRunning) break;

            try {
                // Fetch 1H candles (primary timeframe)
                const candles = await binanceClient.getKlines(symbol, '1h', config.bot.klinesLimit);
                if (!candles || candles.length < 200) continue;

                // Optional: fetch 4H candles for HTF context
                let candles4h;
                try {
                    candles4h = await binanceClient.getKlines(symbol, '4h', 100);
                } catch {}

                const indicators = TechnicalIndicators.calculateSnapshot(candles);
                const prevCandles = candles.slice(0, -1);
                const prevIndicators = TechnicalIndicators.calculateSnapshot(prevCandles);
                const regime = MarketRegimeEngine.classify(candles, indicators);
                const liquidity = LiquidityEngine.getContext(candles);

                let funding;
                let openInterest;
                try {
                    const [fr, currentOI, oiHistory] = await Promise.all([
                        binanceClient.getFundingRate(symbol),
                        binanceClient.getOpenInterest(symbol),
                        binanceClient.getOpenInterestHist(symbol, '1h', 30)
                    ]);
                    funding = fr || undefined;
                    if (currentOI !== null && oiHistory.length > 0) {
                        openInterest = { oi: currentOI, oiHistory };
                    }
                } catch {}

                const ctx: StrategyContext = {
                    symbol, timeframe: '1h', candles, candles4h, indicators, prevIndicators, regime, liquidity, funding, openInterest, btcContext
                };

                await tradeExecutor.updatePaperTrades(ctx);

                const activeTrade = tradeExecutor.getActiveTrade(symbol);
                if (activeTrade) {
                    if (activeTrade.status === 'ACTIVE' && activeTrade.dcaCount > 0) continue;
                }

                if (!passesGlobalFilters(ctx)) continue;

                const individualSignals: StrategySignalCandidate[] = [];
                const currentSession = TimeFilters.getCurrentSession();

                for (const strategy of strategyRegistry) {
                    if (tradeExecutor.isStrategyDisabled(strategy.name)) continue;
                    if (!TimeFilters.isStrategyAllowed(strategy.id, currentSession)) continue;
                    if (tradeExecutor.isOnSlCooldown(symbol, strategy.name)) continue;

                    const candidate = strategy.execute(ctx);
                    if (candidate) {
                        if (!passesDirectionFilter(ctx, candidate.direction, candidate.strategyName)) continue;
                        individualSignals.push(candidate);
                    }
                }

                const comboSignals = CombinationEngine.evaluate(individualSignals, ctx);
                const allCandidates = [...individualSignals, ...comboSignals];

                const symbolSignals: FinalSignal[] = [];

                for (const candidate of allCandidates) {
                    const { score, label } = ScoringEngine.calculate(ctx, candidate);
                    const levels = RiskEngine.calculateLevels(ctx, candidate);
                    
                    TelemetryLogger.log(symbol, candidate, levels, score);
                    
                    if (score >= config.bot.minSignalScore) {
                        if (!dedupStore.isCooldown(symbol, candidate.strategyName, candidate.direction)) {
                            const leverageSuggestion = tradeExecutor.calculateLeverage(levels.riskPercent);
                            
                            const minRR = config.bot.minProfitLeveraged;
                            if (levels.rrRatio < minRR) {
                                logger.info(`[REJECTED LOW RR] ${symbol} ${candidate.strategyName}: R:R ${levels.rrRatio.toFixed(2)} < min ${minRR}`);
                                continue;
                            }

                            symbolSignals.push({
                                ...candidate,
                                symbol,
                                timeframe: '1h',
                                levels,
                                regime,
                                score,
                                confidenceLabel: label,
                                timestamp: Date.now(),
                                leverageSuggestion
                            });
                        }
                    }
                }

                if (symbolSignals.length > 0) {
                    symbolSignals.sort((a, b) => b.score - a.score);
                    const finalSignal = symbolSignals[0];
                    const currentPrice = candles[candles.length - 1].close;

                    if (!activeTrade) {
                        // 1. Total capacity check (lower for swing trading)
                        const activeCount = tradeExecutor.getActiveAndPendingCount();
                        if (activeCount >= 5) { // Hard limit 5 for HTF
                            logger.info(`[MAX CAPACITY REACHED] Ignoring ${symbol} signal. Active: ${activeCount}/5`);
                            continue;
                        }

                        // 2. Directional exposure check
                        const directionalCount = tradeExecutor.getActiveCountByDirection(finalSignal.direction);
                        const MAX_DIRECTIONAL = 2; // Max 2 LONGs or 2 SHORTs at once for swing
                        if (directionalCount >= MAX_DIRECTIONAL) {
                            logger.info(`[MAX DIRECTIONAL REACHED] Ignoring ${symbol} ${finalSignal.direction}. Already have ${directionalCount}/${MAX_DIRECTIONAL}`);
                            continue;
                        }

                        // 3. BTC Momentum check (don't Long if BTC is falling on 15m/1h)
                        if (btcContext) {
                            const btcKlines = await binanceClient.getKlines('BTCUSDT', '1h', 5);
                            const lastBtc = btcKlines[btcKlines.length - 1];
                            const btcChangePct = (lastBtc.close - lastBtc.open) / lastBtc.open * 100;
                            
                            if (finalSignal.direction === 'LONG' && btcChangePct < -0.4) {
                                logger.info(`[SHARP BTC DROP] Rejecting LONG on ${symbol} because BTC 1H is dropping (${btcChangePct.toFixed(2)}%)`);
                                continue;
                            }
                            if (finalSignal.direction === 'SHORT' && btcChangePct > 0.4) {
                                logger.info(`[SHARP BTC PUMP] Rejecting SHORT on ${symbol} because BTC 1H is pumping (${btcChangePct.toFixed(2)}%)`);
                                continue;
                            }
                        }

                        // 4. Global Kill Switch check
                        if (statsService.checkGlobalKillSwitch()) {
                            continue;
                        }

                        await tradeExecutor.processSignal(finalSignal, currentPrice);
                        await telegramNotifier.sendSignal(finalSignal, ctx);
                        dedupStore.recordAlert(symbol, finalSignal.strategyName, finalSignal.direction);
                    } else {
                        // Existing active trade: potentially do DCA
                        await tradeExecutor.processSignal(finalSignal, currentPrice);
                    }
                }

            } catch (err: any) {
                logger.error(`Error scanning ${symbol}`, { error: err.message });
            }
        }
        logger.info('HTF scan complete.');
    }

    stop() {
        this.isRunning = false;
        logger.info('HTF Scan Worker stopping...');
    }
}

export const scanWorker = new ScanWorker();
