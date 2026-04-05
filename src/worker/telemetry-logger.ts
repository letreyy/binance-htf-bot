import fs from 'fs';
import path from 'path';
import { StrategySignalCandidate, SignalLevels } from '../core/types/bot-types.js';

const LOG_FILE = path.join(process.cwd(), 'logs', 'signals_telemetry.csv');

export class TelemetryLogger {
    private static initialized = false;

    static log(symbol: string, candidate: StrategySignalCandidate, levels?: SignalLevels, score?: number) {
        if (!this.initialized) {
            this.init();
        }

        const timestamp = new Date().toISOString();
        const row = [
            timestamp,
            symbol,
            candidate.strategyName,
            candidate.direction,
            candidate.confidence,
            score || '',
            levels?.entry.toFixed(5) || '',
            levels?.sl.toFixed(5) || '',
            levels?.riskPercent.toFixed(2) || '',
            levels?.rrRatio.toFixed(2) || '',
            candidate.reasons.join('|').replace(/,/g, ';')
        ].join(',');

        fs.appendFileSync(LOG_FILE, row + '\n');
    }

    private static init() {
        const dir = path.dirname(LOG_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(LOG_FILE)) {
            const header = 'timestamp,symbol,strategy,direction,confidence,score,entry,sl,risk_pct,rr_ratio,reasons\n';
            fs.writeFileSync(LOG_FILE, header);
        }
        this.initialized = true;
    }
}
