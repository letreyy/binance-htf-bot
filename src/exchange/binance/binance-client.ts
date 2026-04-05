import axios, { AxiosInstance } from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../core/utils/logger.js';
import { Candle } from '../../core/types/bot-types.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class BinanceClient {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.binance.baseUrl,
      headers: {
        'X-MBX-APIKEY': config.binance.apiKey
      },
      timeout: 30000
    });
  }

  private async requestWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const status = err.response?.status;
        const msg = err.response?.data?.msg || err.message;

        const isDeadSymbol = status === 400 && msg?.toLowerCase().includes('delivering');
        
        if (!isDeadSymbol) {
            logger.warn(`[${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${msg} (status: ${status || 'N/A'})`);
        }

        if (status === 400 || status === 404 || isDeadSymbol) {
            throw err;
        }

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * attempt;
          if (!isDeadSymbol) logger.info(`[${label}] retrying in ${delay}ms...`);
          await sleep(delay);
        } else {
          throw err;
        }
      }
    }
    throw new Error('Unreachable');
  }

  async getExchangeInfo(): Promise<any> {
    return this.requestWithRetry(async () => {
      const resp = await this.axiosInstance.get('/fapi/v1/exchangeInfo');
      return resp.data;
    }, 'getExchangeInfo');
  }

  async get24hTicker(): Promise<any[]> {
    return this.requestWithRetry(async () => {
      const resp = await this.axiosInstance.get('/fapi/v1/ticker/24hr');
      return resp.data;
    }, 'get24hTicker');
  }

  async getKlines(symbol: string, interval: string, limit: number = 500): Promise<Candle[]> {
    try {
      return await this.requestWithRetry(async () => {
        const resp = await this.axiosInstance.get('/fapi/v1/klines', {
          params: { symbol, interval, limit }
        });

        return resp.data.map((k: any) => ({
          timestamp: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          quoteVolume: parseFloat(k[7])
        }));
      }, `getKlines(${symbol}/${interval})`);
    } catch (err: any) {
      if (err.response?.status !== 400) {
        logger.error(`Failed to get klines for ${symbol} on ${interval} after ${MAX_RETRIES} retries`, { error: err.message });
      }
      return [];
    }
  }

  async getFundingRate(symbol: string): Promise<{ rate: number, nextFundingTime: number } | null> {
    try {
      return await this.requestWithRetry(async () => {
        const resp = await this.axiosInstance.get('/fapi/v1/premiumIndex', {
          params: { symbol }
        });
        return {
          rate: parseFloat(resp.data.lastFundingRate),
          nextFundingTime: resp.data.nextFundingTime
        };
      }, `getFundingRate(${symbol})`);
    } catch (err: any) {
      if (err.response?.status !== 400) logger.error(`Failed to get funding rate for ${symbol}`, { error: err.message });
      return null;
    }
  }

  async getOpenInterest(symbol: string): Promise<number | null> {
    try {
      return await this.requestWithRetry(async () => {
        const resp = await this.axiosInstance.get('/fapi/v1/openInterest', {
          params: { symbol }
        });
        return parseFloat(resp.data.openInterest);
      }, `getOpenInterest(${symbol})`);
    } catch (err: any) {
      if (err.response?.status !== 400) logger.error(`Failed to get open interest for ${symbol}`, { error: err.message });
      return null;
    }
  }

  async getOpenInterestHist(symbol: string, period: string, limit: number = 30): Promise<number[]> {
    try {
      return await this.requestWithRetry(async () => {
        const resp = await this.axiosInstance.get('/futures/data/openInterestHist', {
          params: { symbol, period, limit }
        });
        return resp.data.map((d: any) => parseFloat(d.sumOpenInterestValue));
      }, `getOpenInterestHist(${symbol}/${period})`);
    } catch (err: any) {
      if (err.response?.status !== 400) logger.error(`Failed to get open interest hist for ${symbol}`, { error: err.message });
      return [];
    }
  }
}

export const binanceClient = new BinanceClient();
