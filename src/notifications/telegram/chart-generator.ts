import sharp from 'sharp';
import { StrategyContext, FinalSignal } from '../../core/types/bot-types.js';

export class ChartGenerator {
    static async generateChart(ctx: StrategyContext, signal: FinalSignal): Promise<Buffer> {
        const width = 800;
        const height = 400;
        const margin = { top: 30, right: 60, bottom: 30, left: 10 };
        
        const titleTimeframe = signal.timeframe;
        const chartCandles = ctx.candles;

        const candles = chartCandles.slice(-60);
        if (candles.length === 0) {
            return Buffer.from('');
        }

        const minPrice = Math.min(...candles.map(c => c.low)) * 0.999;
        const maxPrice = Math.max(...candles.map(c => c.high)) * 1.001;
        const priceRange = maxPrice - minPrice;

        const maxVol = Math.max(...candles.map(c => c.volume));

        const drawWidth = width - margin.left - margin.right;
        const drawHeight = height - margin.top - margin.bottom;
        const candleWidth = Math.max(1, (drawWidth / candles.length) * 0.7);
        const spacing = drawWidth / candles.length;

        const scaleY = (price: number) => {
            return margin.top + drawHeight - ((price - minPrice) / priceRange) * drawHeight;
        };

        const scaleVol = (vol: number) => {
            const volHeight = drawHeight * 0.2;
            return (vol / maxVol) * volHeight;
        };

        let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
        
        svg += `<rect width="100%" height="100%" fill="#1a1c24" />`;
        
        for (let i = 0; i <= 5; i++) {
            const y = margin.top + (drawHeight * i) / 5;
            const price = maxPrice - (priceRange * i) / 5;
            svg += `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#2f3241" stroke-width="1" />`;
            svg += `<text x="${width - margin.right + 5}" y="${y + 4}" fill="#8b90a0" font-family="Arial" font-size="12">${price.toFixed(4)}</text>`;
        }

        candles.forEach((c, i) => {
            const x = margin.left + i * spacing + spacing / 2;
            const isUp = c.close >= c.open;
            const color = isUp ? '#00e676' : '#ff3d00';

            const yHigh = scaleY(c.high);
            const yLow = scaleY(c.low);
            svg += `<line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1.5" />`;

            const yOpen = scaleY(c.open);
            const yClose = scaleY(c.close);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyBottom = Math.max(yOpen, yClose);
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);

            svg += `<rect x="${x - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" fill="${color}" />`;

            const volH = scaleVol(c.volume);
            const volY = height - margin.bottom - volH;
            const volColor = isUp ? 'rgba(0, 230, 118, 0.3)' : 'rgba(255, 61, 0, 0.3)';
            svg += `<rect x="${x - candleWidth / 2}" y="${volY}" width="${candleWidth}" height="${volH}" fill="${volColor}" />`;
        });

        const currentPrice = candles[candles.length - 1].close;
        const currentY = scaleY(currentPrice);
        svg += `<line x1="${margin.left}" y1="${currentY}" x2="${width - margin.right}" y2="${currentY}" stroke="#e0e0e0" stroke-width="1" stroke-dasharray="4" />`;

        const sEntryY = scaleY(signal.levels.entry);
        svg += `<line x1="${margin.left}" y1="${sEntryY}" x2="${width - margin.right}" y2="${sEntryY}" stroke="#2962ff" stroke-width="2" stroke-dasharray="6" />`;
        svg += `<text x="${margin.left + 5}" y="${sEntryY - 5}" fill="#2962ff" font-family="Arial" font-size="14" font-weight="bold">ENTRY</text>`;

        const sSlY = scaleY(signal.levels.sl);
        svg += `<line x1="${margin.left}" y1="${sSlY}" x2="${width - margin.right}" y2="${sSlY}" stroke="#ff3d00" stroke-width="2" stroke-dasharray="6" />`;
        svg += `<text x="${margin.left + 5}" y="${sSlY - 5}" fill="#ff3d00" font-family="Arial" font-size="14" font-weight="bold">SL</text>`;

        const sTp1Y = scaleY(signal.levels.tp[0]);
        svg += `<line x1="${margin.left}" y1="${sTp1Y}" x2="${width - margin.right}" y2="${sTp1Y}" stroke="#00e676" stroke-width="2" stroke-dasharray="6" />`;
        svg += `<text x="${margin.left + 5}" y="${sTp1Y - 5}" fill="#00e676" font-family="Arial" font-size="14" font-weight="bold">TP1</text>`;

        svg += `<text x="${margin.left + 10}" y="${margin.top + 20}" fill="#ffffff" font-family="Arial" font-size="20" font-weight="bold" opacity="0.8">${signal.symbol} - ${titleTimeframe}</text>`;

        svg += `</svg>`;

        return sharp(Buffer.from(svg)).png().toBuffer();
    }
}
