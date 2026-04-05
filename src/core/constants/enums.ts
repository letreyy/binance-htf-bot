export enum MarketRegimeType {
  TREND = 'TREND',
  RANGE = 'RANGE',
  VOLATILITY_EXPANSION = 'VOLATILITY_EXPANSION',
  PANIC = 'PANIC',
  REVERSAL_STOP_HUNT = 'REVERSAL_STOP_HUNT',
  UNKNOWN = 'UNKNOWN'
}

export enum SignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
  NEUTRAL = 'NEUTRAL'
}

export enum Timeframe {
  TF_15M = '15m',
  TF_1H = '1h',
  TF_4H = '4h'
}

export enum ConfidenceLabel {
  A_PLUS = 'A+',
  A = 'A',
  B = 'B',
  C = 'C',
  IGNORE = 'IGNORE'
}
