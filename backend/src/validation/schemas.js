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
  cache: z.record(z.string().min(1), z.record(z.string(), z.any())).refine(
    obj => Object.keys(obj).length > 0,
    { message: 'cache must contain at least one client entry' }
  ),
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
  netCashMap: z.record(z.string().min(1), z.any()).refine(
    obj => Object.keys(obj).length > 0,
    { message: 'netCashMap must contain at least one client entry' }
  ),
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
  })).min(1, 'memories array must contain at least one entry'),
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
  tags: z.array(tagSchema).min(1, 'tags array must contain at least one entry'),
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
};
