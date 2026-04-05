import { FinalSignal, StrategyContext } from '../../core/types/bot-types.js';
export declare class TelegramNotifier {
    private bot;
    private isPolling;
    constructor();
    stop(): Promise<void>;
    sendSignal(signal: FinalSignal, ctx: StrategyContext): Promise<void>;
    sendTradeResult(symbol: string, direction: string, pnlPercent: number, totalPnlToday: number, history?: string[]): Promise<void>;
    sendTextMessage(message: string): Promise<void>;
    onCommand(command: RegExp, handler: (msg: any, match?: RegExpExecArray | null) => void): void;
    private formatSignal;
}
export declare const telegramNotifier: TelegramNotifier;
