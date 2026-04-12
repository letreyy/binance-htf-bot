import fs from 'fs';
import path from 'path';
import { logger } from '../core/utils/logger.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';

interface TradeRecord {
    timestamp: number;
    strategyName: string;
    pnl: number;
    isWin: boolean;
}

interface StrategyPause {
    type: 'SOFT' | 'HARD';
    until: number;
    reason: string;
}

interface Thresholds {
    minN24: number;
    softPnl: number;
    softWR: number;
    softHours: number;
    hardPF: number;
    hardLS: number;
    unlockN: number;
    unlockWR: number;
    unlockPF?: number;
}

// HTF: fewer trades per day, so thresholds are lower
const DEFAULT_THRESHOLDS: Record<string, Thresholds> = {
    'HTF Order Block':       { minN24: 6, softPnl: -12, softWR: 42, softHours: 12, hardPF: 0.80, hardLS: 4, unlockN: 5, unlockWR: 50 },
    'HTF Fair Value Gap':    { minN24: 6, softPnl: -12, softWR: 42, softHours: 12, hardPF: 0.80, hardLS: 4, unlockN: 5, unlockWR: 50 },
    'HTF Liquidity Sweep':   { minN24: 6, softPnl: -10, softWR: 40, softHours: 12, hardPF: 0.80, hardLS: 4, unlockN: 5, unlockWR: 50 },
    'HTF EMA Pullback':      { minN24: 6, softPnl: -12, softWR: 42, softHours: 12, hardPF: 0.82, hardLS: 4, unlockN: 5, unlockWR: 52 },
    'HTF EMA Cross':         { minN24: 5, softPnl: -10, softWR: 42, softHours: 12, hardPF: 0.82, hardLS: 3, unlockN: 4, unlockWR: 50 },
    'HTF VWAP Reversion':    { minN24: 5, softPnl: -10, softWR: 40, softHours: 12, hardPF: 0.80, hardLS: 3, unlockN: 4, unlockWR: 50 },
    'HTF BB Reversal':       { minN24: 5, softPnl: -10, softWR: 40, softHours: 12, hardPF: 0.80, hardLS: 3, unlockN: 4, unlockWR: 50 },
    'HTF Delta Divergence':  { minN24: 5, softPnl: -10, softWR: 40, softHours: 12, hardPF: 0.80, hardLS: 3, unlockN: 4, unlockWR: 50 },
    'HTF Breakout Failure':  { minN24: 5, softPnl: -10, softWR: 42, softHours: 12, hardPF: 0.80, hardLS: 3, unlockN: 4, unlockWR: 50 },
    'HTF RSI Divergence':    { minN24: 5, softPnl: -10, softWR: 40, softHours: 12, hardPF: 0.80, hardLS: 3, unlockN: 4, unlockWR: 50 },
    'HTF Volume Climax':     { minN24: 4, softPnl: -8,  softWR: 40, softHours: 6,  hardPF: 0.80, hardLS: 3, unlockN: 4, unlockWR: 50 },
    // Combos
    'HTF Liquidity Trap':       { minN24: 3, softPnl: -6, softWR: 45, softHours: 6, hardPF: 0.9, hardLS: 3, unlockN: 3, unlockWR: 55 },
    'HTF Trend Continuation':   { minN24: 3, softPnl: -6, softWR: 45, softHours: 6, hardPF: 0.9, hardLS: 3, unlockN: 3, unlockWR: 55 },
    'HTF Mean Reversion Pro':   { minN24: 3, softPnl: -6, softWR: 45, softHours: 6, hardPF: 0.9, hardLS: 3, unlockN: 3, unlockWR: 55 },
    'HTF Exhaustion Reversal':  { minN24: 3, softPnl: -6, softWR: 45, softHours: 6, hardPF: 0.9, hardLS: 3, unlockN: 3, unlockWR: 55 },
};

const STATS_FILE = path.join(process.cwd(), 'state', 'strategy_stats.json');

export class StatsService {
    private trades: TradeRecord[] = [];
    private activePauses: Map<string, StrategyPause> = new Map();

    constructor() {
        this.load();
    }

    private load() {
        if (fs.existsSync(STATS_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
                this.trades = data.trades || [];
            } catch (_err) {}
        }
    }

    private save() {
        const dir = path.dirname(STATS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATS_FILE, JSON.stringify({ trades: this.trades.slice(-2000) }, null, 2));
    }

    recordTrade(strategyName: string, pnl: number) {
        const record: TradeRecord = {
            timestamp: Date.now(),
            strategyName,
            pnl,
            isWin: pnl > 0
        };
        this.trades.push(record);
        this.save();
        this.evaluatePauses(strategyName);
    }

    isPaused(strategyName: string): boolean {
        const pause = this.activePauses.get(strategyName);
        if (!pause) return false;
        if (Date.now() > pause.until) {
            if (this.checkUnlock(strategyName)) {
                this.activePauses.delete(strategyName);
                telegramNotifier.sendTextMessage(`🔹 <b>Auto-Unlock</b>: Strategy <b>${strategyName}</b> is now back in active rotation.`);
                return false;
            } else {
                pause.until = Date.now() + 6 * 60 * 60 * 1000;
                telegramNotifier.sendTextMessage(`⏳ <b>Pause Prolonged</b>: <b>${strategyName}</b> failed to recover. Extending for 6h.`);
                return true;
            }
        }
        return true;
    }

    private checkUnlock(strategyName: string): boolean {
        const thresh = DEFAULT_THRESHOLDS[strategyName];
        if (!thresh) return true;

        const recent = this.trades.filter(t => t.strategyName === strategyName).slice(-thresh.unlockN);
        if (recent.length < thresh.unlockN) return false;

        const wins = recent.filter(t => t.isWin).length;
        const wr = (wins / recent.length) * 100;
        
        if (wr < thresh.unlockWR) return false;
        
        if (thresh.unlockPF) {
            const profit = recent.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
            const loss = Math.abs(recent.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
            const pf = loss === 0 ? 99 : profit / loss;
            if (pf < thresh.unlockPF) return false;
        }

        return true;
    }

    private evaluatePauses(strategyName: string) {
        const thresh = DEFAULT_THRESHOLDS[strategyName];
        if (!thresh) return;

        const now = Date.now();
        const win24h = now - 24 * 60 * 60 * 1000;
        const recent24h = this.trades.filter(t => t.strategyName === strategyName && t.timestamp > win24h);
        
        if (recent24h.length < thresh.minN24) return;

        const pnl = recent24h.reduce((s, t) => s + t.pnl, 0);
        const wins = recent24h.filter(t => t.isWin).length;
        const wr = (wins / recent24h.length) * 100;
        
        const grossProfit = recent24h.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(recent24h.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
        const pf = grossLoss === 0 ? 99 : grossProfit / grossLoss;

        let currentStreak = 0;
        let maxLosingStreak = 0;
        for (const t of recent24h) {
            if (!t.isWin) {
                currentStreak++;
                maxLosingStreak = Math.max(maxLosingStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        }

        if (pf < thresh.hardPF || maxLosingStreak >= thresh.hardLS) {
            this.applyPause(strategyName, 'HARD', `PF ${pf.toFixed(2)} / LS ${maxLosingStreak}`);
            return;
        }

        if (wr < thresh.softWR && pnl <= thresh.softPnl) {
            this.applyPause(strategyName, 'SOFT', `WR ${wr.toFixed(0)}% / PnL ${pnl.toFixed(1)}%`);
        }
    }

    private applyPause(strategyName: string, type: 'SOFT' | 'HARD', reason: string) {
        if (this.activePauses.has(strategyName)) return;

        const thresh = DEFAULT_THRESHOLDS[strategyName];
        const hours = type === 'SOFT'
            ? (thresh?.softHours ?? 12)
            : 24;
        const until = Date.now() + hours * 60 * 60 * 1000;
        this.activePauses.set(strategyName, { type, until, reason });

        const icon = type === 'SOFT' ? '🟡' : '🔴';
        telegramNotifier.sendTextMessage(`${icon} <b>AUTO-PAUSE [${type}]</b>: Strategy <b>${strategyName}</b> disabled for ${hours}h.\nReason: ${reason}`);
        logger.warn(`Auto-pause [${type}] applied to ${strategyName}: ${reason}`);
    }

    // Global protection
    checkGlobalKillSwitch(): boolean {
        // [TESTING] Disabled by user request to allow further testing despite 24h losses
        return false;

        /*
        const now = Date.now();
        const win24h = now - 24 * 60 * 60 * 1000;
        const recent24h = this.trades.filter(t => t.timestamp > win24h);
        const totalPnL = recent24h.reduce((s, t) => s + t.pnl, 0);

        if (totalPnL <= -10) {
            telegramNotifier.sendTextMessage(`🚨 <b>GLOBAL CIRCUIT BREAKER</b>: Total 24h PnL is ${totalPnL.toFixed(2)}%! Halting all new trades for 12 hours.`);
            return true;
        }
        return false;
        */
    }
}

export const statsService = new StatsService();
