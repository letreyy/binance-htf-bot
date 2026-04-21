import { FinalSignal, StrategyContext } from '../core/types/bot-types.js';
import { config } from '../config/index.js';
import * as ccxt from 'ccxt';
import { logger } from '../core/utils/logger.js';
import { SignalDirection } from '../core/constants/enums.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';
import { Strategy } from '../strategies/base/strategy.js';
import { universeLoader } from '../market/universe/universe-loader.js';
import { COMBO_DEFINITIONS } from '../strategies/combination-engine.js';
import { statsService } from '../stats/stats-service.js';

interface PaperTrade {
    id: string;
    symbol: string;
    direction: SignalDirection;
    entryPrice: number;
    initialSl: number;
    sl: number;
    tp: number[];
    tpHit: number;
    remainingPortion: number;
    leverage: number;
    accumulatedPnl: number;
    timestamp: number;
    strategyName: string;
    history: string[];
    status: 'PENDING' | 'ACTIVE';
    expireAt: number;
    orderType: 'MARKET' | 'LIMIT';
    activatedAt: number; // ms when trade became ACTIVE (for time stop)
    mfe: number;         // max favorable excursion (R multiples)
    mae: number;         // max adverse excursion (R multiples)
}

interface LeverageConfig {
    mode: 'dynamic' | 'fixed';
    fixedValue: number;
    minValue: number;
    maxValue: number;
}

type SlCooldownMap = Map<string, number>;

// HTF: 4-hour cooldown after SL (vs 1h on scalp bot)
const SL_COOLDOWN_MS = 4 * 60 * 60 * 1000;
// Time stop: close at BE if 6h elapsed and trade hasn't reached 1R MFE
const TIME_STOP_MS = 6 * 60 * 60 * 1000;

// Correlation groups. A symbol matches a group if any token here appears in its ticker.
// Max 2 concurrent positions per group to avoid stacking highly correlated exposure.
const CORRELATION_GROUPS: Record<string, string[]> = {
    MAJORS: ['BTC', 'ETH'],
    L1:     ['SOL', 'AVAX', 'NEAR', 'APT', 'SUI', 'SEI', 'INJ', 'TIA', 'ATOM', 'DOT', 'ADA'],
    L2:     ['ARB', 'OP', 'MATIC', 'IMX', 'METIS', 'STRK', 'MANTA'],
    DEFI:   ['UNI', 'AAVE', 'MKR', 'CRV', 'COMP', 'LDO', 'SUSHI', 'DYDX', 'GMX'],
    AI:     ['FET', 'AGIX', 'RNDR', 'OCEAN', 'TAO', 'WLD', 'NMR', 'ARKM'],
    GAMING: ['GALA', 'ENJ', 'SAND', 'MANA', 'AXS', 'APE', 'ILV'],
};
const MAX_PER_GROUP = 2;

// Directional daily cap: if > 60% of last-24h signals are in one direction, block new ones
const DIRECTIONAL_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
const DIRECTIONAL_CAP_MIN_SIGNALS = 5;
const DIRECTIONAL_CAP_PCT = 0.60;

function resolveGroup(symbol: string): string | null {
    const upper = symbol.toUpperCase();
    for (const [groupName, tokens] of Object.entries(CORRELATION_GROUPS)) {
        for (const token of tokens) {
            if (upper.startsWith(token)) return groupName;
        }
    }
    return null;
}

function getTimestamp(): string {
    return `[${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })}]`;
}

export class TradeExecutor {
    private exchange: ccxt.Exchange | null = null;
    private isLive: boolean = config.binance.isLiveMode;
    private activeTrades: PaperTrade[] = [];
    private todaysPnlPercent: number = 0;
    private strategyStats: Record<string, { win: number, loss: number, pnl: number }> = {};
    private disabledStrategies: Set<string> = new Set();
    private slCooldown: SlCooldownMap = new Map();
    private targetRiskPercent: number = config.bot.targetRiskPercent;
    // HTF: lower default max leverage (swing positions = less leverage)
    private leverageConfig: LeverageConfig = { mode: 'dynamic', fixedValue: 10, minValue: 1, maxValue: 20 };
    private registeredStrategies: Strategy[] = [];
    // Rolling record of signal directions — used for 24h directional skew cap
    private recentSignalDirections: { direction: SignalDirection; timestamp: number }[] = [];

    async init(strategies: Strategy[]) {
        this.registeredStrategies = strategies;

        if (this.isLive) {
            if (!config.binance.apiKey || !config.binance.apiSecret) {
                logger.error('Binance API Key or Secret missing! Reverting to Paper Trading.');
                this.isLive = false;
            } else {
                try {
                    this.exchange = new ccxt.binance({
                        apiKey: config.binance.apiKey,
                        secret: config.binance.apiSecret,
                        options: { defaultType: 'swap' }
                    });
                    logger.info('Live Trading enabled on BINANCE.');
                } catch (err: any) {
                    logger.error('Failed to initialize CCXT binance client', { error: err.message });
                    this.isLive = false;
                }
            }
        } else {
            logger.info('Paper Trading mode active (simulated).');
        }
        logger.info('Trade Executor initialized. Status: ' + (this.isLive ? 'LIVE' : 'PAPER TRADING') + ' (BINANCE)');

        // ─── Telegram commands ───
        telegramNotifier.onCommand(/(\/stats|📊 Статистика)/, () => {
            const status = this.isLive ? 'LIVE' : 'PAPER TRADING';
            const sign = this.todaysPnlPercent > 0 ? '+' : '';
            
            const strategyBreakdown = Object.entries(this.strategyStats)
                .sort((a, b) => b[1].pnl - a[1].pnl)
                .map(([name, s]) => {
                    const sSign = s.pnl > 0 ? '+' : '';
                    const winrate = s.win + s.loss > 0 ? ((s.win / (s.win + s.loss)) * 100).toFixed(0) : '0';
                    const disabled = this.disabledStrategies.has(name) ? ' 🚫' : '';
                    return `• <b>${name}</b>${disabled}: ${sSign}${s.pnl.toFixed(2)}% (W:${s.win} L:${s.loss} ${winrate}%)`;
                }).join('\n');
            const stratMsg = strategyBreakdown ? `\n\n🎯 <b>Strategy Performance:</b>\n${strategyBreakdown}` : '';

            const levInfo = this.leverageConfig.mode === 'fixed'
                ? `x${this.leverageConfig.fixedValue} (fixed)`
                : `x${this.leverageConfig.minValue}-${this.leverageConfig.maxValue} (dynamic)`;

            const activePositions = this.activeTrades.filter(t => t.status === 'ACTIVE');
            const pendingOrders = this.activeTrades.filter(t => t.status === 'PENDING');

            const msg = `📊 <b>HTF Bot Statistics</b>
🤖 <b>Status:</b> ${status}
⏱ <b>Timeframe:</b> 1H (Swing)
💰 <b>Total PnL Today:</b> ${sign}${this.todaysPnlPercent.toFixed(2)}%
📐 <b>Leverage:</b> ${levInfo}${stratMsg}

📍 <b>Active Positions:</b> ${activePositions.length}
${activePositions.map(t => `- <b>${t.symbol}</b> ${t.direction} (Entry: ${t.entryPrice.toFixed(4)})`).join('\n') || '<i>None</i>'}

⏳ <b>Pending Limit Orders:</b> ${pendingOrders.length}
${pendingOrders.map(t => `- <b>${t.symbol}</b> ${t.direction} (Limit: ${t.entryPrice.toFixed(4)})`).join('\n') || '<i>None</i>'}`;
            telegramNotifier.sendTextMessage(msg);
        });

        telegramNotifier.onCommand(/(\/strategies|⚙️ Стратегии)/, () => {
            const lines = this.registeredStrategies.map(s => {
                const disabled = this.disabledStrategies.has(s.name);
                return `${disabled ? '🔴' : '🟢'} <b>${s.name}</b> [${s.id}]`;
            });
            const msg = `⚙️ <b>HTF Strategy Manager</b>\n\n${lines.join('\n')}\n\n<i>To toggle:</i>\n<code>/toggle StrategyName</code>`;
            telegramNotifier.sendTextMessage(msg);
        });

        telegramNotifier.onCommand(/(\/combos|🧩 Комбо)/, () => {
            const lines = COMBO_DEFINITIONS.map(c => {
                const reqStrats = c.requiredStrategies.join(', ');
                return `🔹 <b>${c.name}</b>\n└ <i>Requires ${c.minMatch} of:</i> ${reqStrats}`;
            });
            const msg = `🧩 <b>HTF Combo Strategies</b>\n\n${lines.join('\n\n')}`;
            telegramNotifier.sendTextMessage(msg);
        });

        telegramNotifier.onCommand(/\/toggle (.+)/, (_msg: any, match: any) => {
            const name = match[1].trim();
            if (this.disabledStrategies.has(name)) {
                this.disabledStrategies.delete(name);
                telegramNotifier.sendTextMessage(`🟢 Strategy <b>${name}</b> is now <b>ENABLED</b>`);
            } else {
                this.disabledStrategies.add(name);
                telegramNotifier.sendTextMessage(`🔴 Strategy <b>${name}</b> is now <b>DISABLED</b>`);
            }
        });

        telegramNotifier.onCommand(/(\/leverage$|📐 Плечо)/, () => {
            const levInfo = this.leverageConfig.mode === 'fixed'
                ? `x${this.leverageConfig.fixedValue} (fixed)`
                : `x${this.leverageConfig.minValue}-${this.leverageConfig.maxValue} (dynamic)`;
            const msg = `📐 <b>Leverage Settings</b>\nCurrent: <b>${levInfo}</b>\n\n<i>Commands:</i>\n<code>/leverage fixed 10</code>\n<code>/leverage dynamic 3 15</code>`;
            telegramNotifier.sendTextMessage(msg);
        });

        telegramNotifier.onCommand(/\/leverage fixed (\d+)/, (_msg: any, match: any) => {
            const val = parseInt(match[1]);
            if (val < 1 || val > 50) {
                telegramNotifier.sendTextMessage('❌ Leverage must be between 1 and 50 for HTF');
                return;
            }
            this.leverageConfig = { mode: 'fixed', fixedValue: val, minValue: val, maxValue: val };
            telegramNotifier.sendTextMessage(`📐 Leverage set to <b>fixed x${val}</b>`);
        });

        telegramNotifier.onCommand(/\/leverage dynamic(?:\s+(\d+)\s+(\d+))?/, (_msg: any, match: any) => {
            const min = match[1] ? parseInt(match[1]) : 1;
            const max = match[2] ? parseInt(match[2]) : 20;
            this.leverageConfig = { mode: 'dynamic', fixedValue: max, minValue: min, maxValue: max };
            telegramNotifier.sendTextMessage(`📐 Leverage set to <b>dynamic x${min}-x${max}</b>`);
        });

        telegramNotifier.onCommand(/(?:\/risk|🛡️ Риск)(?:\s+([\d.]+))?/, (_msg: any, match: any) => {
            const riskStr = match[1];
            if (!riskStr || isNaN(parseFloat(riskStr))) {
                const msg = `🛡️ <b>Risk Management</b>\nCurrent Target Risk: <b>${this.targetRiskPercent.toFixed(1)}%</b> per trade\n\n<i>Commands:</i>\n<code>/risk 0.5</code> — low\n<code>/risk 1.0</code> — standard\n<code>/risk 2.0</code> — aggressive`;
                telegramNotifier.sendTextMessage(msg);
                return;
            }
            const val = parseFloat(riskStr);
            if (val < 0.1 || val > 5.0) {
                telegramNotifier.sendTextMessage('❌ Risk must be between 0.1% and 5.0%');
                return;
            }
            this.targetRiskPercent = val;
            telegramNotifier.sendTextMessage(`🛡️ Target risk set to <b>${val.toFixed(1)}%</b> per trade`);
        });

        telegramNotifier.onCommand(/(\/coins|🚫 Монеты)/, () => {
            const disabled = universeLoader.getDisabledSymbols();
            const list = disabled.length > 0
                ? disabled.map(s => `🔴 ${s}`).join('\n')
                : '<i>Нет заблокированных монет</i>';
            const msg = `🚫 <b>Blocked Coins</b>\n\n${list}\n\n<code>/coin block BTCUSDT</code>\n<code>/coin unblock BTCUSDT</code>`;
            telegramNotifier.sendTextMessage(msg);
        });

        telegramNotifier.onCommand(/\/coin block (\w+)/, (_msg: any, match: any) => {
            const sym = match[1].toUpperCase();
            universeLoader.disableSymbol(sym);
            telegramNotifier.sendTextMessage(`🔴 <b>${sym}</b> заблокирована`);
        });

        telegramNotifier.onCommand(/\/coin unblock (\w+)/, (_msg: any, match: any) => {
            const sym = match[1].toUpperCase();
            universeLoader.enableSymbol(sym);
            telegramNotifier.sendTextMessage(`🟢 <b>${sym}</b> разблокирована`);
        });

        telegramNotifier.onCommand(/(\/mode|🔄 Режим)(?:\s+(live|paper))?/, (_msg: any, match: any) => {
            const requestedMode = match[2];
            if (!requestedMode) {
                const current = this.isLive ? '🚀 LIVE' : '📝 PAPER';
                telegramNotifier.sendTextMessage(`Current Mode: <b>${current}</b>\n\n<code>/mode live</code> or <code>/mode paper</code>`);
                return;
            }
            if (requestedMode === 'live') {
                if (!config.binance.apiKey || !config.binance.apiSecret) {
                    telegramNotifier.sendTextMessage('❌ Cannot switch to LIVE: API keys missing');
                    return;
                }
                this.isLive = true;
                this.init(this.registeredStrategies);
                telegramNotifier.sendTextMessage('⚠️ <b>MODE CHANGED TO LIVE</b>');
            } else {
                this.isLive = false;
                telegramNotifier.sendTextMessage('📝 <b>MODE CHANGED TO PAPER</b>');
            }
        });

        telegramNotifier.onCommand(/(\/panic|🚨 ПАНИКА)/, async () => {
            telegramNotifier.sendTextMessage('🚨 <b>PANIC INITIATED</b>: Closing all positions...');
            await this.panicCloseAll();
        });
    }

    isStrategyDisabled(strategyName: string): boolean {
        if (this.disabledStrategies.has(strategyName)) return true;
        return statsService.isPaused(strategyName);
    }

    isOnSlCooldown(symbol: string, strategyName: string): boolean {
        const key = `${symbol}:${strategyName}`;
        const lastSl = this.slCooldown.get(key);
        if (!lastSl) return false;
        return Date.now() - lastSl < SL_COOLDOWN_MS;
    }

    calculateLeverage(slDistancePercent: number): number {
        if (this.leverageConfig.mode === 'fixed') {
            return this.leverageConfig.fixedValue;
        }
        const targetLeverage = (this.targetRiskPercent / (slDistancePercent + 0.0001)); 
        return Math.max(this.leverageConfig.minValue, Math.min(this.leverageConfig.maxValue, Math.round(targetLeverage)));
    }

    async updatePaperTrades(ctx: StrategyContext) {
        if (this.isLive) return;

        const lastCandle = ctx.candles[ctx.candles.length - 1];

        this.activeTrades = this.activeTrades.filter(trade => {
            if (trade.symbol !== ctx.symbol) return true;

            const isLong = trade.direction === SignalDirection.LONG;

            if (trade.status === 'PENDING') {
                const triggered = isLong ? lastCandle.low <= trade.entryPrice : lastCandle.high >= trade.entryPrice;
                if (triggered) {
                    trade.status = 'ACTIVE';
                    trade.activatedAt = Date.now();
                    trade.history.push(`${getTimestamp()} Limit Filled at ${trade.entryPrice.toFixed(4)}`);
                    logger.info(`[LIMIT FILLED] ${trade.symbol} ${trade.direction} at ${trade.entryPrice.toFixed(4)}`);
                } else if (Date.now() > trade.expireAt) {
                    logger.info(`[LIMIT EXPIRED] ${trade.symbol} ${trade.direction} at ${trade.entryPrice.toFixed(4)}`);
                    return false;
                } else {
                    return true;
                }
            }

            // Track MFE/MAE in R multiples for time-stop logic
            const riskPerUnit = Math.abs(trade.entryPrice - trade.initialSl);
            if (riskPerUnit > 0) {
                const maxMove = isLong ? (lastCandle.high - trade.entryPrice) : (trade.entryPrice - lastCandle.low);
                const minMove = isLong ? (lastCandle.low - trade.entryPrice) : (trade.entryPrice - lastCandle.high);
                trade.mfe = Math.max(trade.mfe, maxMove / riskPerUnit);
                trade.mae = Math.min(trade.mae, minMove / riskPerUnit);
            }

            // Same-candle SL check: when entry was MARKET and candle is still the entry candle,
            // only count SL hit if close moved adversely past SL (wick-only doesn't count).
            const isEntryCandle = trade.timestamp === lastCandle.timestamp;

            const slHit = isEntryCandle
                ? (isLong ? lastCandle.close <= trade.sl : lastCandle.close >= trade.sl)
                : (isLong ? lastCandle.low <= trade.sl : lastCandle.high >= trade.sl);

            if (slHit) {
                const slPnlRaw = isLong
                    ? (trade.sl - trade.entryPrice) / trade.entryPrice
                    : (trade.entryPrice - trade.sl) / trade.entryPrice;
                const slPnl = slPnlRaw * trade.remainingPortion * trade.leverage * 100;
                const totalPnl = trade.accumulatedPnl + slPnl;
                this.todaysPnlPercent += slPnl;

                this.recordStrategyResult(trade.strategyName, totalPnl);

                trade.history.push(`${getTimestamp()} SL hit (${slPnl.toFixed(2)}%)`);

                const cooldownKey = `${trade.symbol}:${trade.strategyName}`;
                this.slCooldown.set(cooldownKey, Date.now());
                logger.info(`[SL COOLDOWN] ${cooldownKey} blocked for 4 hours`);
                logger.info(`[PAPER CLOSED by SL] ${trade.symbol} ${trade.direction} | Total: ${totalPnl.toFixed(2)}%`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, totalPnl, this.todaysPnlPercent, trade.history);
                return false;
            }

            while (trade.tpHit < 4) {
                const nextTp = trade.tp[trade.tpHit];
                const tpReached = isEntryCandle
                    ? (isLong ? lastCandle.close >= nextTp : lastCandle.close <= nextTp)
                    : (isLong ? lastCandle.high >= nextTp : lastCandle.low <= nextTp);

                if (!tpReached) break;

                const portion = trade.tpHit < 2 ? 0.35 : 0.15;
                const tpPnlRaw = isLong
                    ? (nextTp - trade.entryPrice) / trade.entryPrice
                    : (trade.entryPrice - nextTp) / trade.entryPrice;
                const tpPnl = tpPnlRaw * portion * trade.leverage * 100;

                trade.accumulatedPnl += tpPnl;
                trade.remainingPortion -= portion;
                trade.tpHit++;
                this.todaysPnlPercent += tpPnl;
                
                trade.history.push(`${getTimestamp()} TP${trade.tpHit} hit (+${tpPnl.toFixed(2)}%)`);

                if (trade.tpHit === 1) {
                    trade.sl = trade.entryPrice;
                    trade.history.push(`${getTimestamp()} SL moved to BE (${trade.sl.toFixed(4)})`);
                } else if (trade.tpHit === 2) {
                    trade.sl = trade.tp[0];
                    trade.history.push(`${getTimestamp()} SL moved to TP1 (${trade.sl.toFixed(4)})`);
                } else if (trade.tpHit === 3) {
                    trade.sl = trade.tp[1];
                    trade.history.push(`${getTimestamp()} SL moved to TP2 (${trade.sl.toFixed(4)})`);
                }

                logger.info(`[TP${trade.tpHit} HIT] ${trade.symbol} ${trade.direction} | +${tpPnl.toFixed(2)}%`);
            }

            if (trade.tpHit >= 4) {
                const totalPnl = trade.accumulatedPnl;
                this.recordStrategyResult(trade.strategyName, totalPnl);
                logger.info(`[PAPER CLOSED FULL TP] ${trade.symbol} | Total: ${totalPnl.toFixed(2)}%`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, totalPnl, this.todaysPnlPercent, trade.history);
                return false;
            }

            // Time stop: after 6h of no meaningful progress, close at BE.
            // Rule: 6h elapsed, TP1 not yet hit, MFE < 1R (no meaningful pop).
            if (
                trade.tpHit === 0 &&
                trade.activatedAt > 0 &&
                Date.now() - trade.activatedAt > TIME_STOP_MS &&
                trade.mfe < 1.0
            ) {
                const currentPrice = lastCandle.close;
                const pnlRaw = isLong
                    ? (currentPrice - trade.entryPrice) / trade.entryPrice
                    : (trade.entryPrice - currentPrice) / trade.entryPrice;
                const pnl = pnlRaw * trade.remainingPortion * trade.leverage * 100;
                this.todaysPnlPercent += pnl;
                this.recordStrategyResult(trade.strategyName, pnl);
                trade.history.push(`${getTimestamp()} Time-stop closed (${pnl.toFixed(2)}%, MFE ${trade.mfe.toFixed(2)}R)`);
                logger.info(`[TIME STOP] ${trade.symbol} ${trade.direction} | ${pnl.toFixed(2)}%`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, pnl, this.todaysPnlPercent, trade.history);
                return false;
            }

            return true;
        });
    }

    private recordStrategyResult(strategyName: string, totalPnl: number) {
        if (!this.strategyStats[strategyName]) {
            this.strategyStats[strategyName] = { win: 0, loss: 0, pnl: 0 };
        }
        const stats = this.strategyStats[strategyName];
        if (totalPnl > 0) stats.win++;
        else stats.loss++;
        stats.pnl += totalPnl;

        statsService.recordTrade(strategyName, totalPnl);
    }

    getActiveTrade(symbol: string): PaperTrade | undefined {
        return this.activeTrades.find(t => t.symbol === symbol);
    }

    /**
     * Get number of currently active positions or pending limit orders
     */
    getActiveAndPendingCount(): number {
        return this.activeTrades.length;
    }

    /**
     * Get number of active/pending trades in a specific direction
     */
    getActiveCountByDirection(direction: SignalDirection): number {
        return this.activeTrades.filter(t => t.direction === direction).length;
    }

    /**
     * Check correlation cluster exposure. Returns true if adding this symbol
     * would push its correlation group above MAX_PER_GROUP active trades.
     */
    exceedsCorrelationCap(symbol: string): boolean {
        const group = resolveGroup(symbol);
        if (!group) return false;
        const count = this.activeTrades.filter(t => resolveGroup(t.symbol) === group).length;
        return count >= MAX_PER_GROUP;
    }

    getCorrelationGroup(symbol: string): string | null {
        return resolveGroup(symbol);
    }

    /**
     * Record an issued signal direction for the rolling 24h directional cap.
     */
    recordSignalDirection(direction: SignalDirection) {
        const now = Date.now();
        this.recentSignalDirections.push({ direction, timestamp: now });
        const cutoff = now - DIRECTIONAL_CAP_WINDOW_MS;
        this.recentSignalDirections = this.recentSignalDirections.filter(s => s.timestamp >= cutoff);
    }

    /**
     * Returns true if adding a new signal in `direction` would push the 24h
     * directional share above the cap. No-op until MIN_SIGNALS accumulated.
     */
    exceedsDirectionalDailyCap(direction: SignalDirection): boolean {
        const cutoff = Date.now() - DIRECTIONAL_CAP_WINDOW_MS;
        const recent = this.recentSignalDirections.filter(s => s.timestamp >= cutoff);
        if (recent.length < DIRECTIONAL_CAP_MIN_SIGNALS) return false;

        const sameDir = recent.filter(s => s.direction === direction).length + 1; // include the candidate
        const total = recent.length + 1;
        return (sameDir / total) > DIRECTIONAL_CAP_PCT;
    }

    async processSignal(signal: FinalSignal, _currentPrice?: number) {
        if (this.isStrategyDisabled(signal.strategyName)) return;
        if (this.isOnSlCooldown(signal.symbol, signal.strategyName)) return;

        if (this.isLive) {
            await this.executeLiveTrade(signal);
            return;
        }

        const existingTrade = this.getActiveTrade(signal.symbol);

        // Pending LIMIT can be replaced by a strong MARKET signal; never average into losers.
        if (existingTrade) {
            if (existingTrade.status === 'PENDING' && signal.orderType === 'MARKET') {
                logger.info(`[HTF OVERRIDE] Replacing PENDING limit on ${signal.symbol} with MARKET ${signal.direction} via ${signal.strategyName}`);
                this.activeTrades = this.activeTrades.filter(t => t.id !== existingTrade.id);
            } else {
                // Active trade exists — do not DCA, do not stack. Just ignore.
                return;
            }
        }

        const status = signal.orderType === 'LIMIT' ? 'PENDING' : 'ACTIVE';
        const logEntryMsg = status === 'PENDING'
            ? `${getTimestamp()} Limit set at ${signal.levels.entry.toFixed(4)}`
            : `${getTimestamp()} Market entry at ${signal.levels.entry.toFixed(4)}`;

        logger.info(`[HTF PAPER] Opening ${signal.direction} on ${signal.symbol} at ${signal.levels.entry.toFixed(4)} | Leverage: x${signal.leverageSuggestion}`);

        this.activeTrades.push({
            id: `${signal.symbol}-${signal.timestamp}`,
            symbol: signal.symbol,
            direction: signal.direction,
            entryPrice: signal.levels.entry,
            initialSl: signal.levels.sl,
            sl: signal.levels.sl,
            tp: signal.levels.tp,
            tpHit: 0,
            remainingPortion: 1.0,
            leverage: signal.leverageSuggestion,
            accumulatedPnl: 0,
            timestamp: signal.timestamp,
            strategyName: signal.strategyName,
            history: [logEntryMsg],
            status: status,
            expireAt: signal.timestamp + (signal.expireMinutes * 60 * 1000),
            orderType: signal.orderType || 'MARKET',
            activatedAt: status === 'ACTIVE' ? Date.now() : 0,
            mfe: 0,
            mae: 0
        });
    }

    private async executeLiveTrade(signal: FinalSignal) {
        if (!this.exchange) return;
        
        const symbol = signal.symbol;
        const direction = signal.direction === SignalDirection.LONG ? 'buy' : 'sell';
        const side = signal.direction === SignalDirection.LONG ? 'LONG' : 'SHORT';
        
        try {
            try { await this.exchange.setMarginMode('CROSSED', symbol); } catch (_e) {}
            await this.exchange.setLeverage(signal.leverageSuggestion, symbol);

            const quantity = await this.calculateLivePositionSize(signal);
            if (quantity <= 0) return;

            const orderType = signal.orderType === 'LIMIT' ? 'limit' : 'market';
            const entryOrder = await this.exchange.createOrder(symbol, orderType, direction, quantity, signal.levels.entry);
            logger.info(`[LIVE] Entry: ${entryOrder.id}`);

            const tps = signal.levels.tp;
            const tpPortions = [0.35, 0.35, 0.15, 0.15];
            const closeDirection = direction === 'buy' ? 'sell' : 'buy';

            for (let i = 0; i < tps.length; i++) {
                const tpQty = quantity * tpPortions[i];
                if (tpQty > 0) {
                    await this.exchange.createOrder(symbol, 'limit', closeDirection, tpQty, tps[i], { reduceOnly: true });
                }
            }

            await this.exchange.createOrder(symbol, 'STOP_MARKET', closeDirection, quantity, undefined, {
                stopPrice: signal.levels.sl,
                reduceOnly: true
            });

            telegramNotifier.sendTextMessage(`🚀 <b>LIVE TRADE OPENED</b>\n\n<b>${symbol}</b> ${side} x${signal.leverageSuggestion}\nQty: <code>${quantity.toFixed(4)}</code>`);
        } catch (err: any) {
            logger.error(`[LIVE] Failed: ${symbol}`, { error: err.message });
            telegramNotifier.sendTextMessage(`❌ <b>LIVE FAILED</b>\n${symbol}: ${err.message}`);
        }
    }

    private async calculateLivePositionSize(signal: FinalSignal): Promise<number> {
        if (!this.exchange) return 0;
        try {
            const balance: any = await this.exchange.fetchBalance();
            const usdt = balance.free['USDT'] || 0;
            if (usdt < 10) return 0;

            const riskAmountUsdt = usdt * (this.targetRiskPercent / 100);
            const slDist = Math.abs(signal.levels.entry - signal.levels.sl) / signal.levels.entry;
            const positionSizeUsdt = riskAmountUsdt / (slDist + 0.00001);
            let quantity = positionSizeUsdt / signal.levels.entry;

            const maxAllowedQty = (usdt * signal.leverageSuggestion * 0.95) / signal.levels.entry;
            return Math.min(quantity, maxAllowedQty);
        } catch (err: any) {
            logger.error('Failed to calculate position size', { error: err.message });
            return 0;
        }
    }

    async panicCloseAll() {
        if (!this.isLive || !this.exchange) {
            this.activeTrades = [];
            telegramNotifier.sendTextMessage('🧹 Paper trades cleared.');
            return;
        }
        try {
            const positions = await this.exchange.fetchPositions();
            for (const pos of positions) {
                const size = Number(pos.contracts || 0);
                if (size !== 0 && pos.symbol) {
                    const side: 'buy' | 'sell' = size > 0 ? 'sell' : 'buy';
                    await this.exchange.createOrder(pos.symbol, 'market', side, Math.abs(size), undefined, { reduceOnly: true });
                }
            }
            await this.exchange.cancelAllOrders();
            telegramNotifier.sendTextMessage('🚨 <b>PANIC CLOSED</b>: All positions closed!');
        } catch (err: any) {
            logger.error('Panic close failed', { error: err.message });
        }
    }
}

export const tradeExecutor = new TradeExecutor();
