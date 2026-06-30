const { z } = require('./validate');
 
// ── POST /api/fifo/save-cache ──────────────────────────────────────
// The existing handler already guards `typeof cache !== 'object'`. This
// schema replaces that single weak check with: cache must be a non-empty
// object keyed by client name, where each entry is itself an object (the
// nested lots/realized/_rawTxns shapes are left as freeform — they're
// computed client-side and deeply nested; constraining them further risks
// rejecting legitimate payloads without a corresponding business-logic
// change, which is explicitly out of scope for this rollout).
const fifoSaveCacheSchema = z.object({
  cache: z.record(z.string().min(1), z.record(z.string(), z.any()))
    .refine(obj => Object.keys(obj).length > 0, { message: 'cache must contain at least one client entry' })
    .refine(obj => Object.keys(obj).length <= 1000, { message: 'cache exceeds maximum allowed client entries (1000)' }),
  status: z.any().optional(),
});
 
// ── POST /api/settings/:key ────────────────────────────────────────
// `value` is intentionally a generic JSON-serializable blob (the route
// stores arbitrary settings data) and existing business logic must keep
// accepting any JSON-serializable shape. What was never enforced: a
// reasonable key format, and a size ceiling to prevent a single settings
// write from becoming an unbounded payload.
const settingsKeyParamSchema = z.object({
  key: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_\-]+$/, 'key may only contain letters, numbers, underscores, and hyphens'),
});
const settingsValueBodySchema = z.object({
  value: z.any()
    .refine(v => v !== undefined, { message: 'value is required' })
    .refine(v => v === undefined || JSON.stringify(v).length <= 2_000_000, { message: 'value exceeds maximum allowed size (2MB)' }),
});
 
// ── POST /api/admin/users ──────────────────────────────────────────
const adminCreateUserSchema = z.object({
  email: z.string().email('a valid email address is required'),
  name: z.string().min(1).max(200),
  role: z.enum(['admin', 'manager', 'viewer'], { errorMap: () => ({ message: 'role must be admin, manager, or viewer' }) }),
  password: z.string().min(8, 'password must be at least 8 characters').max(128),
});
 
// ── PATCH /api/admin/users/:id ─────────────────────────────────────
const adminUserIdParamSchema = z.object({ id: z.string().uuid('id must be a valid user id') });
const adminUpdateUserSchema = z.object({
  role: z.enum(['admin', 'manager', 'viewer']).optional(),
  active: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
}).refine(o => o.role !== undefined || o.active !== undefined || o.name !== undefined,
  { message: 'at least one of role, active, or name must be provided' });
 
// ── POST /api/clients/net-cash ─────────────────────────────────────
// Existing business logic deliberately tolerates per-entry bad data (it
// skips invalid entries with `continue` rather than rejecting the whole
// batch — see clients.js). That per-entry leniency is preserved exactly;
// this schema only gates the top-level shape, which previously had no
// check beyond `typeof netCashMap === 'object'`.
const netCashSchema = z.object({
  netCashMap: z.record(z.string().min(1), z.any())
    .refine(obj => Object.keys(obj).length > 0, { message: 'netCashMap must contain at least one client entry' })
    .refine(obj => Object.keys(obj).length <= 1000, { message: 'netCashMap exceeds maximum allowed client entries (1000)' }),
});
 
// ── POST /api/push/queue ───────────────────────────────────────────
// The handler already truncates title/body via .slice() after this point —
// that existing truncation behavior is left untouched. This schema adds
// the upfront rejection (with a clear message) that was missing entirely.
const pushQueueSchema = z.object({
  cat: z.string().max(50).optional(),
  title: z.string().min(1, 'title is required').max(200),
  body: z.string().max(1000).optional(),
  url: z.string().url('url must be a valid URL').optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});
 
// ── POST /api/memory ───────────────────────────────────────────────
// Previously the only check was `memories?.length` — an individual entry's
// `memory` field could be undefined and would be inserted as a null/blank
// row with no error. This requires the actual memory text to be present.
const memoryCreateSchema = z.object({
  memories: z.array(z.object({
    category: z.string().max(50).optional(),
    memory: z.string().min(1, 'memory text is required').max(5000),
    source: z.string().max(50).optional(),
    importance: z.number().min(1).max(10).optional(),
  })).min(1, 'memories array must contain at least one entry').max(50, 'memories array exceeds maximum allowed entries (50)'),
});
 
// ── DELETE /api/memory/:id, PATCH /api/memory/:id ──────────────────
// The actual primary-key type for saarthi_memory isn't defined in
// schema.sql, so this deliberately does not assume a UUID format (unlike
// adminUserIdParamSchema, where the id is known to come from Supabase Auth
// and is guaranteed to be a UUID). This only guards against an empty or
// implausibly long id reaching the database, preserving compatibility with
// whatever the actual key format is.
const memoryIdParamSchema = z.object({ id: z.string().min(1).max(100) });
 
const memoryUpdateSchema = z.object({
  importance: z.number().min(1).max(10).optional(),
  memory: z.string().min(1).max(5000).optional(),
  active: z.boolean().optional(),
}).refine(o => o.importance !== undefined || o.memory !== undefined || o.active !== undefined,
  { message: 'at least one of importance, memory, or active must be provided' });
 
// ── POST /api/push/subscribe ────────────────────────────────────────
const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url('subscription.endpoint must be a valid URL'),
    keys: z.object({
      auth: z.string().min(1).optional(),
      p256dh: z.string().min(1).optional(),
    }).optional(),
  }),
  device: z.string().max(200).optional(),
});
 
// ── POST /api/push/unsubscribe ──────────────────────────────────────
const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url('endpoint must be a valid URL'),
});
 
// ── Tags: POST /api/tags, POST /api/tags/bulk, DELETE /api/tags/:symbol ──
// mcap and max_alloc types confirmed against actual frontend payload shape
// (mcap is a category label like "Large Cap", sent as a string; max_alloc
// is a percentage limit, sent as a number or null) — this schema matches
// what the application actually sends rather than guessing a stricter
// shape that could reject legitimate existing payloads.
const tagSchema = z.object({
  symbol: z.string().min(1, 'symbol is required').max(100),
  sector: z.string().max(100).nullable().optional(),
  mcap: z.string().max(50).nullable().optional(),
  asset_type: z.string().max(50).nullable().optional(),
  max_alloc: z.number().nullable().optional(),
  hidden: z.boolean().optional(),
});
 
const tagBulkSchema = z.object({
  tags: z.array(tagSchema).min(1, 'tags array must contain at least one entry').max(2000, 'tags array exceeds maximum allowed entries (2000)'),
});
 
const tagSymbolParamSchema = z.object({ symbol: z.string().min(1).max(100) });
 
// ── POST /api/claude ────────────────────────────────────────────────
// Confirmed against actual frontend usage (two call sites, index.html
// lines ~2804 and ~6247): neither ever sends `model` or `max_tokens` —
// both rely entirely on the server-side defaults already in the handler.
// `messages` content is always a plain string in every call site found
// (order-parsing sends one message, the AI advisor sends up to the last
// 8 history entries) — never an array of content blocks, so this is
// validated as a string, matching real usage rather than a guessed
// broader shape. Bounds below are deliberately generous (the system
// prompt in this app runs to several thousand characters) so nothing
// currently working is rejected; they exist purely to bound cost/abuse,
// not to constrain legitimate use.
const ALLOWED_CLAUDE_MODELS = ['claude-haiku-4-5']; // only model confirmed used by Saarthi today — intentionally not widened with speculative/unconfirmed model identifiers; add a model here only once it's actually adopted
 
const claudeMessageSchema = z.object({
  role: z.enum(['user', 'assistant'], { errorMap: () => ({ message: 'role must be user or assistant' }) }),
  content: z.string().min(1, 'message content cannot be empty').max(50_000, 'message content exceeds maximum allowed length'),
});
 
const claudeChatSchema = z.object({
  system: z.string().max(50_000, 'system prompt exceeds maximum allowed length').optional(),
  messages: z.array(claudeMessageSchema)
    .min(1, 'messages required')
    .max(50, 'too many messages — conversation history exceeds allowed limit'),
  model: z.enum(ALLOWED_CLAUDE_MODELS, { errorMap: () => ({ message: `model must be one of: ${ALLOWED_CLAUDE_MODELS.join(', ')}` }) }).optional(),
  // claude-haiku-4-5's real output ceiling is 64,000 tokens; 16,000 is a deliberate
  // business decision to bound per-call cost well below that technical maximum
  // (not an accidental default) while still leaving generous headroom above the
  // existing 4096-token default and any realistic response length this app needs.
  max_tokens: z.number().int('max_tokens must be a whole number').positive().max(16000, 'max_tokens exceeds maximum allowed value').optional(),
});
 
// ── POST /api/claude/extract-memory ─────────────────────────────────
// existing_memories is built client-side from at most 150 memory entries
// (the frontend itself caps memory count before calling this endpoint —
// see _asMemories.length>150 guard), so a 50,000-character ceiling here
// is comfortably above anything that guard would ever produce.
const claudeExtractMemorySchema = z.object({
  conversation: z.string().min(1, 'conversation is required').max(50_000, 'conversation exceeds maximum allowed length'),
  existing_memories: z.string().max(50_000, 'existing_memories exceeds maximum allowed length').optional(),
});
 
// ── POST /api/compute/xirr ──────────────────────────────────────────
// Confirmed against frontend usage (index.html ~6302): cashflows are sent
// as { date: ISOString, amount: number }. _xirr() reads cf.date and
// cf.amount directly — both required per-entry. The existing top-level
// length check (cashflows.length < 2) is preserved as-is; this schema
// enforces the same minimum at the array level plus real per-item shape.
const xirrSchema = z.object({
  cashflows: z.array(z.object({
    date: z.string().min(1, 'date is required'),
    amount: z.number({ invalid_type_error: 'amount must be a number' }),
  })).min(2, 'cashflows array must contain at least 2 entries'),
});
 
// ── POST /api/compute/health ────────────────────────────────────────
// No frontend caller found for this single-client route (only the
// no-body /health/batch variant is used) — validated defensively against
// what computeHealthScore() actually reads, kept loose since the real
// caller (if any) is unverified.
const computeHealthClientSchema = z.object({
  client: z.object({
    holdings: z.array(z.any()).optional(),
    total_invested: z.number().optional(),
    total_current: z.number().optional(),
    total_pnl: z.number().optional(),
    cash: z.number().optional(),
    investment_date: z.string().optional(),
  }).passthrough(), // computeHealthScore tolerates/ignores extra fields already — don't strip them
});
 
// ── POST /api/compute/breaches/batch ────────────────────────────────
// No frontend caller found. Existing check only requires `filters` to be
// an array (empty array is valid today — zero filters simply yields zero
// breaches) — that tolerance is preserved exactly, not tightened to
// require a non-empty array.
const breachFilterSchema = z.object({
  active: z.boolean(),
  type: z.enum(['stock_max', 'sector_max', 'cash_min', 'stock_min', 'sector_min']),
  target: z.string().optional(),
  threshold: z.number(),
  name: z.string().optional(),
});
const breachesBatchSchema = z.object({
  filters: z.array(breachFilterSchema).max(200, 'filters array exceeds maximum allowed entries (200)'),
});
 
// ── POST /api/astro/backtest ────────────────────────────────────────
// Confirmed against frontend usage (index.html ~33455): date_from/date_to
// come from <input> .value, which is '' when empty, not undefined — kept
// as loosely-typed optional strings rather than a strict date format to
// avoid rejecting that legitimate empty-string case.
const astroBacktestSchema = z.object({
  event_type: z.string().min(1, 'event_type and instrument required'),
  instrument: z.string().min(1, 'event_type and instrument required'),
  window_days: z.number().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});
 
// ── POST /api/astro/ai-query ────────────────────────────────────────
// Mirrors the existing handler's exact business rule (question.trim().length < 5)
// rather than a simpler approximation, so behavior is identical. A generous
// upper bound is added — this triggers a downstream AI query, so an
// unbounded question string is a cost/abuse vector the existing code never
// considered.
const astroAIQuerySchema = z.object({
  question: z.string().min(1, 'Question too short')
    .max(2000, 'question exceeds maximum allowed length')
    .refine(q => q.trim().length >= 5, { message: 'Question too short' }),
});
 
// ── POST /api/astro/admin/run-cron ──────────────────────────────────
// No frontend caller found — admin/ops-only. Existing inline check
// (job === 'planets' / 'scores' / else 400) is preserved; this schema
// gives the same rejection earlier with a clearer message.
const astroRunCronSchema = z.object({
  job: z.enum(['planets', 'scores'], { errorMap: () => ({ message: 'Unknown job' }) }),
  date: z.string().optional(),
});
 
// ── POST /api/astro/admin/backfill ──────────────────────────────────
// No frontend caller found — admin/ops-only, one-time historical backfill.
// Kept loose (existing code already falls back to sane defaults via
// `req.body.from || '2005-01-01'`) — not enforcing a strict date format
// since the real caller's exact shape is unverified.
const astroBackfillSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
 
// ── POST /api/pulse/log-pick ────────────────────────────────────────
// Confirmed against frontend usage (index.html ~12750): entryPrice and
// sector are both legitimately sent as null (from `_liveQ?.last_price||
// _liveQ?.close||null` and `gm(pk.sym)?.sector||null`) — both fields are
// explicitly nullable here, not just optional, to match real traffic.
const pulseLogPickSchema = z.object({
  symbol: z.string().min(1, 'symbol required'),
  company: z.string().optional(),
  fund: z.string().optional(),
  signalType: z.string().optional(),
  entryPrice: z.number().nullable().optional(),
  rationale: z.string().optional(),
  factorScores: z.record(z.string(), z.any()).refine(obj => Object.keys(obj).length <= 100, { message: 'factorScores exceeds maximum allowed entries (100)' }).optional(),
  sector: z.string().nullable().optional(),
  date: z.string().optional(),
});
 
// ── POST /api/pulse/resolve-flag ────────────────────────────────────
// No frontend caller found. The existing handler has NO presence check on
// `id` at all today (would silently call .eq('id', undefined) on a
// missing id) — this closes a real, previously-unvalidated gap.
const pulseResolveFlagSchema = z.object({
  id: z.string().min(1, 'id is required'),
});
 
module.exports = {
  fifoSaveCacheSchema,
  settingsKeyParamSchema,
  settingsValueBodySchema,
  adminCreateUserSchema,
  adminUserIdParamSchema,
  adminUpdateUserSchema,
  netCashSchema,
  pushQueueSchema,
  memoryCreateSchema,
  memoryIdParamSchema,
  memoryUpdateSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
  tagSchema,
  tagBulkSchema,
  tagSymbolParamSchema,
  claudeChatSchema,
  claudeExtractMemorySchema,
  xirrSchema,
  computeHealthClientSchema,
  breachesBatchSchema,
  astroBacktestSchema,
  astroAIQuerySchema,
  astroRunCronSchema,
  astroBackfillSchema,
  pulseLogPickSchema,
  pulseResolveFlagSchema,
};
