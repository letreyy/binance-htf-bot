import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config/index.js';
import { logger } from '../../core/utils/logger.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { ChartGenerator } from './chart-generator.js';
process.env.NTBA_FIX_350 = '1';
const MAIN_KEYBOARD = {
    keyboard: [
        [{ text: '📊 Статистика' }, { text: '⚙️ Стратегии' }, { text: '🧩 Комбо' }],
        [{ text: '🛡️ Риск' }, { text: '📐 Плечо' }, { text: '🚫 Монеты' }],
        [{ text: '🔄 Режим' }, { text: '🚨 ПАНИКА' }]
    ],
    resize_keyboard: true,
    is_persistent: true
};
export class TelegramNotifier {
    bot = null;
    isPolling = false;
    constructor() {
        if (config.telegram.token) {
            const options = {
                polling: true,
                baseApiUrl: config.telegram.baseUrl
            };
            if (config.telegram.proxy) {
                options.request = { proxy: config.telegram.proxy };
            }
            this.bot = new TelegramBot(config.telegram.token, options);
            this.isPolling = true;
            this.bot.setMyCommands([]).catch(err => logger.error('Failed to clear Telegram bot commands', { error: err.message }));
        }
    }
    async stop() {
        if (this.bot && this.isPolling) {
            logger.info('Stopping Telegram bot polling...');
            await this.bot.stopPolling();
            this.isPolling = false;
        }
    }
    async sendSignal(signal, ctx) {
        if (!this.bot || !config.telegram.chatId) {
            logger.warn('Telegram token or chat ID not provided.');
            return;
        }
        const message = this.formatSignal(signal, ctx);
        try {
            const chartBuffer = await ChartGenerator.generateChart(ctx, signal);
            await this.bot.sendPhoto(config.telegram.chatId, chartBuffer, {
                caption: message,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD
            }, {
                filename: 'chart.png',
                contentType: 'image/png'
            });
            logger.info(`Signal sent for ${signal.symbol} via ${signal.strategyName}`);
        }
        catch (err) {
            logger.error('Failed to send Telegram message', { error: err.message });
        }
    }
    async sendTradeResult(symbol, direction, pnlPercent, totalPnlToday, history = []) {
        if (!this.bot || !config.telegram.chatId)
            return;
        const emoji = pnlPercent > 0 ? '🏆 WON' : '📉 LOSS';
        const sign = pnlPercent > 0 ? '+' : '';
        const totalSign = totalPnlToday > 0 ? '+' : '';
        let message = `<b>[HTF PAPER] ${emoji}</b> | ${symbol} ${direction}\n\n`;
        if (history.length > 0) {
            message += `📋 <b>Trade Log:</b>\n${history.map((step, idx) => `  ${idx + 1}. ${step}`).join('\n')}\n\n`;
        }
        message += `💰 <b>Result:</b> ${sign}${pnlPercent.toFixed(2)}%
📊 <b>Total Today:</b> ${totalSign}${totalPnlToday.toFixed(2)}%`;
        try {
            await this.bot.sendMessage(config.telegram.chatId, message, { parse_mode: 'HTML', reply_markup: MAIN_KEYBOARD });
        }
        catch (err) {
            logger.error('Failed to send Telegram message (Trade Result)', { error: err.message });
        }
    }
    async sendTextMessage(message) {
        if (!this.bot || !config.telegram.chatId)
            return;
        try {
            await this.bot.sendMessage(config.telegram.chatId, message, {
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD
            });
        }
        catch (err) {
            logger.error('Failed to send Telegram message (Text)', { error: err.message });
        }
    }
    onCommand(command, handler) {
        if (!this.bot)
            return;
        this.bot.onText(command, handler);
        logger.info(`Registered Telegram command for format: ${command.source}`);
    }
    formatSignal(s, ctx) {
        const emoji = s.direction === SignalDirection.LONG ? '🟢 LONG' : '🔴 SHORT';
        const timeframe = s.timeframe;
        let contextStats = '';
        if (ctx) {
            if (ctx.funding) {
                const frColor = ctx.funding.rate > 0 ? '🔴' : '🟢';
                contextStats += `\n⏱ <b>Funding:</b> ${frColor} ${(ctx.funding.rate * 100).toFixed(4)}%`;
            }
            if (ctx.openInterest && ctx.openInterest.oiHistory.length > 0) {
                const oiChange = ((ctx.openInterest.oi - ctx.openInterest.oiHistory[0]) / ctx.openInterest.oiHistory[0]) * 100;
                const oiDir = oiChange > 0 ? '↗️' : '↘️';
                contextStats += `\n🧲 <b>OI Change:</b> ${oiDir} ${oiChange.toFixed(2)}%`;
            }
            if (ctx.btcContext) {
                const btcEmoji = ctx.btcContext.trend === 'BULLISH' ? '🟢' : '🔴';
                contextStats += `\n🌍 <b>BTC 4H Trend:</b> ${btcEmoji} ${ctx.btcContext.trend} (${ctx.btcContext.price.toFixed(0)})`;
            }
        }
        return `${emoji} | <b>${s.symbol}</b> | ${timeframe} ⏰

📊 <b>Strategy:</b> ${s.strategyName}
⭐ <b>Score:</b> ${s.score}/100 (${s.confidenceLabel})
📈 <b>Regime:</b> ${s.regime.type} (${s.regime.description})${contextStats}

📍 <b>${s.orderType || 'MARKET'} Entry:</b> <code>${s.levels.entry.toFixed(4)}</code>
🛑 <b>Stop Loss:</b> <code>${s.levels.sl.toFixed(4)}</code> (-${(s.levels.riskPercent * s.leverageSuggestion).toFixed(1)}%)
✅ <b>TP1:</b> <code>${s.levels.tp[0].toFixed(4)}</code> (Safe) (+${((Math.abs(s.levels.tp[0] - s.levels.entry) / s.levels.entry) * 100 * s.leverageSuggestion).toFixed(1)}%)
✅ <b>TP2:</b> <code>${s.levels.tp[1].toFixed(4)}</code> (Target) (+${((Math.abs(s.levels.tp[1] - s.levels.entry) / s.levels.entry) * 100 * s.leverageSuggestion).toFixed(1)}%)
✅ <b>TP3:</b> <code>${s.levels.tp[2].toFixed(4)}</code> (Ext) (+${((Math.abs(s.levels.tp[2] - s.levels.entry) / s.levels.entry) * 100 * s.leverageSuggestion).toFixed(1)}%)
✅ <b>TP4:</b> <code>${s.levels.tp[3].toFixed(4)}</code> (Ext+) (+${((Math.abs(s.levels.tp[3] - s.levels.entry) / s.levels.entry) * 100 * s.leverageSuggestion).toFixed(1)}%)

📐 <b>Leverage:</b> x${s.leverageSuggestion}
💰 <b>Risk/Reward:</b> 1:${s.levels.rrRatio}

📋 <b>Reasons:</b>
${s.reasons.map(r => `• ${r.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`).join('\n')}

⏰ <i>${new Date(s.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Europe/Moscow' })} | Valid for: ${s.expireMinutes}m</i>`;
    }
}
export const telegramNotifier = new TelegramNotifier();
//# sourceMappingURL=telegram-notifier.js.map