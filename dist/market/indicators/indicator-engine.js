import { config } from '../../config/index.js';
export class TechnicalIndicators {
    static ema(data, period) {
        if (data.length < period)
            return 0;
        const k = 2 / (period + 1);
        let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < data.length; i++) {
            ema = (data[i] - ema) * k + ema;
        }
        return ema;
    }
    static rsi(data, period) {
        if (data.length <= period)
            return 50;
        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = data[i] - data[i - 1];
            if (diff >= 0)
                gains += diff;
            else
                losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        for (let i = period + 1; i < data.length; i++) {
            const diff = data[i] - data[i - 1];
            avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
            avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
        }
        if (avgLoss === 0)
            return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
    static atr(candles, period) {
        if (candles.length < period + 1)
            return 0;
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;
            trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        return this.ema(trs, period);
    }
    static adx(candles, period) {
        if (candles.length < period * 2)
            return 0;
        const trs = [];
        const dmPlus = [];
        const dmMinus = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevHigh = candles[i - 1].high;
            const prevLow = candles[i - 1].low;
            const prevClose = candles[i - 1].close;
            trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
            const moveUp = high - prevHigh;
            const moveDown = prevLow - low;
            if (moveUp > moveDown && moveUp > 0)
                dmPlus.push(moveUp);
            else
                dmPlus.push(0);
            if (moveDown > moveUp && moveDown > 0)
                dmMinus.push(moveDown);
            else
                dmMinus.push(0);
        }
        const smoothedTR = this.ema(trs, period);
        const smoothedDMPlus = this.ema(dmPlus, period);
        const smoothedDMMinus = this.ema(dmMinus, period);
        const diPlus = 100 * (smoothedDMPlus / smoothedTR);
        const diMinus = 100 * (smoothedDMMinus / smoothedTR);
        const dx = 100 * Math.abs(diPlus - diMinus) / (diPlus + diMinus);
        return dx;
    }
    static bollingerBands(data, period, stdDev) {
        if (data.length < period)
            return { upper: 0, mid: 0, lower: 0 };
        const slice = data.slice(-period);
        const mid = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
        const sd = Math.sqrt(variance);
        return {
            mid,
            upper: mid + (stdDev * sd),
            lower: mid - (stdDev * sd)
        };
    }
    static vwap(candles) {
        let totalVolume = 0;
        let totalVP = 0;
        const todayStr = new Date().toISOString().split('T')[0];
        for (let i = candles.length - 1; i >= 0; i--) {
            const c = candles[i];
            const dateStr = new Date(c.timestamp).toISOString().split('T')[0];
            if (dateStr !== todayStr)
                break;
            const price = (c.high + c.low + c.close) / 3;
            totalVP += price * c.volume;
            totalVolume += c.volume;
        }
        return totalVolume === 0 ? candles[candles.length - 1].close : totalVP / totalVolume;
    }
    static calculateSnapshot(candles) {
        const closes = candles.map(c => c.close);
        const c = config.indicators;
        const bb = this.bollingerBands(closes, c.bbLength, c.bbMult);
        return {
            ema20: this.ema(closes, c.emaFast),
            ema50: this.ema(closes, c.emaMid),
            ema200: this.ema(closes, c.emaSlow),
            emaRibbon: [8, 13, 21, 34, 55].map(p => this.ema(closes, p)),
            rsi: this.rsi(closes, c.rsi),
            atr: this.atr(candles, c.atr),
            adx: this.adx(candles, c.adx),
            bbUpper: bb.upper,
            bbMid: bb.mid,
            bbLower: bb.lower,
            vwap: this.vwap(candles),
            volumeSma: this.ema(candles.map(c => c.volume), c.volSma)
        };
    }
}
//# sourceMappingURL=indicator-engine.js.map