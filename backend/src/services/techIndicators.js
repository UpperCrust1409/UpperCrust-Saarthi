// ═══════════════════════════════════════════════════════════════
// Technical Indicators Engine
// Computes RSI, EMA, MACD, Bollinger Bands from candle arrays
// candle format: [timestamp, open, high, low, close, volume]
// ═══════════════════════════════════════════════════════════════

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

function computeEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(2));
}

function computeSMA(closes, period) {
  if (closes.length < period) return null;
  return parseFloat((closes.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(2));
}

function computeMACD(closes) {
  if (closes.length < 26) return null;
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;
  // Signal: 9-period EMA of MACD (approximate)
  return { macd: parseFloat(macdLine.toFixed(4)), bullish: macdLine > 0 };
}

function computeBollinger(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period);
  const last = closes[closes.length - 1];
  const upper = sma + 2 * std, lower = sma - 2 * std;
  const pct = std > 0 ? (last - lower) / (upper - lower) * 100 : 50;
  return { pct: parseFloat(pct.toFixed(1)), upper, lower, sma };
}

function computeAll(candles) {
  if (!candles || candles.length < 20) return null;
  const closes = candles.map(c => c[4]);
  const rsi = computeRSI(closes, 14);
  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);
  const ema200 = computeEMA(closes, 200);
  const sma200 = computeSMA(closes, 200);
  const macd = computeMACD(closes);
  const bb = computeBollinger(closes, 20);
  const last = closes[closes.length - 1];
  return {
    rsi, ema20, ema50, ema200, sma200, macd, bb, last,
    aboveEma20: ema20 ? last > ema20 : null,
    aboveEma50: ema50 ? last > ema50 : null,
    aboveEma200: ema200 ? last > ema200 : null,
  };
}

module.exports = { computeRSI, computeEMA, computeSMA, computeMACD, computeBollinger, computeAll };
