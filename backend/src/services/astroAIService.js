// ─────────────────────────────────────────────────────────────────
// astroAIService.js
// DB-grounded AI analyst — Claude API, no hallucinations
// ─────────────────────────────────────────────────────────────────
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../db/supabase');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are AstroQuant Analyst, a quantitative research assistant for a PMS wealth management platform.

You analyze the relationship between planetary cycles and Indian market data (NSE/BSE).

ABSOLUTE RULES:
1. Answer ONLY from the data provided in <data> tags below. Never use external knowledge.
2. If data is insufficient, say exactly: "Insufficient historical data for this query."
3. Never recommend buy or sell. Never predict price targets.
4. Always cite number of observations for any statistical claim.
5. Express confidence in terms of sample size and historical evidence only.
6. Use INR context for Indian markets.

RESPONSE FORMAT:
- Lead with the direct answer.
- Follow with supporting evidence from data.
- End with: "Based on [N] observations from [date range]."
- Keep responses under 300 words.`;

/**
 * Fetch contextual DB data based on intent detection.
 */
async function gatherContext(question) {
  const q = question.toLowerCase();
  const context = {};

  // Current sector scores
  if (q.includes('sector') || q.includes('strongest') || q.includes('weakest')) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('astro_sector_scores')
      .select('sector, astro_score, primary_planet, retrograde_active, confidence, factors')
      .eq('date', today)
      .order('astro_score', { ascending: false });
    if (data) context.todaySectorScores = data;
  }

  // Current planet positions
  if (q.includes('planet') || q.includes('retrograde') || q.includes('jupiter') ||
      q.includes('saturn') || q.includes('mars') || q.includes('mercury')) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('astro_planet_positions')
      .select('planet, sign, retrograde, strength, nakshatra')
      .eq('date', today);
    if (data) context.todayPlanets = data;
  }

  // Backtest history
  if (q.includes('historical') || q.includes('backtest') || q.includes('performance') ||
      q.includes('outperform') || q.includes('return')) {
    const { data } = await supabase
      .from('astro_backtests')
      .select('event_type, instrument, n_observations, avg_return_pct, win_rate_pct, sharpe_ratio, date_from, date_to')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) context.backtestHistory = data;
  }

  // Current regime
  if (q.includes('regime') || q.includes('risk') || q.includes('volatility') || q.includes('sentiment')) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('astro_market_regime')
      .select('*')
      .lte('date', today)
      .order('date', { ascending: false })
      .limit(1)
      .single();
    if (data) context.currentRegime = data;
  }

  // Active alerts
  if (q.includes('alert') || q.includes('warning') || q.includes('cycle')) {
    const { data } = await supabase
      .from('astro_alerts')
      .select('title, description, historical_evidence, confidence, planets_involved')
      .eq('is_active', true)
      .order('generated_at', { ascending: false })
      .limit(5);
    if (data) context.activeAlerts = data;
  }

  // Upcoming events
  if (q.includes('upcoming') || q.includes('next') || q.includes('calendar') || q.includes('eclipse')) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('astro_planetary_events')
      .select('event_date, event_type, planet, planet2, description')
      .gte('event_date', today)
      .order('event_date', { ascending: true })
      .limit(10);
    if (data) context.upcomingEvents = data;
  }

  return context;
}

/**
 * Answer a natural-language question using DB data only.
 */
async function answerQuery(question) {
  const context = await gatherContext(question);

  if (Object.keys(context).length === 0) {
    return {
      answer: 'Insufficient historical data for this query. Try asking about current sector scores, planet positions, backtest results, or upcoming events.',
      context_used: []
    };
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `<data>\n${JSON.stringify(context, null, 2)}\n</data>\n\nQuestion: ${question}`
    }]
  });

  const answer = message.content.map(b => b.type === 'text' ? b.text : '').join('').trim();
  const tokens = message.usage?.input_tokens + message.usage?.output_tokens || 0;

  // Log query
  await supabase.from('astro_ai_queries').insert([{
    question,
    sql_context: JSON.stringify(Object.keys(context)),
    answer,
    tokens_used: tokens
  }]);

  return { answer, context_used: Object.keys(context) };
}

const SUGGESTED_QUESTIONS = [
  'Which sectors have the strongest astro scores today?',
  'What has historically happened to Nifty 50 during Mercury retrograde?',
  'Are any planets retrograde currently and which sectors are affected?',
  'Show me the backtest for Jupiter sign changes on Nifty Bank.',
  'What is the current market regime and what does it mean?',
  'Which upcoming planetary events should I watch closely?',
];

module.exports = { answerQuery, SUGGESTED_QUESTIONS };
