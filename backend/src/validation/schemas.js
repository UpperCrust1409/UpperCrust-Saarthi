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
};
