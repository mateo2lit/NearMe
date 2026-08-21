/**
 * Shared test doubles for the edge functions.
 *
 * These used to be hand-rolled inline in each test file, which meant they
 * drifted the moment a function added a `.limit()` or an `.rpc()` to a chain —
 * and because the suites couldn't run under Jest, nothing caught the drift.
 * One builder that supports the whole PostgREST chain keeps them honest.
 */

export interface FakeSupabaseOptions {
  /** Rows returned by `.from(table).select()…` — keyed by table name. */
  tables?: Record<string, unknown[]>;
  /** Row returned by `.single()` — keyed by table name. Falls back to tables[0]. */
  singles?: Record<string, unknown>;
  /** Rows returned by `.rpc(name)` — keyed by function name. */
  rpcs?: Record<string, unknown[]>;
  /** Every write the code under test performed, in order. */
  writes?: { table: string; op: "insert" | "upsert" | "update"; rows: unknown }[];
}

type Result = { data: unknown; error: null };

/**
 * A thenable query builder: every chain method returns itself, `await` on it
 * resolves to `{ data, error }`, and `.single()` resolves to one row.
 */
function makeQuery(rows: unknown[], single: unknown, record?: (op: any) => void) {
  const q: any = {
    select: () => q,
    eq: () => q,
    in: () => q,
    limit: () => q,
    order: () => q,
    gte: () => q,
    lte: () => q,
    not: () => q,
    filter: () => q,
    single: async (): Promise<Result> => ({ data: single ?? rows[0] ?? null, error: null }),
    maybeSingle: async (): Promise<Result> => ({ data: single ?? rows[0] ?? null, error: null }),
    insert: (r: unknown) => { record?.({ op: "insert", rows: r }); return q; },
    upsert: (r: unknown) => { record?.({ op: "upsert", rows: r }); return q; },
    update: (r: unknown) => { record?.({ op: "update", rows: r }); return q; },
    delete: () => q,
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null } as Result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).catch(reject),
  };
  return q;
}

export function makeFakeSupabase(opts: FakeSupabaseOptions = {}) {
  const writes = opts.writes ?? [];
  return {
    writes,
    from(table: string) {
      return makeQuery(
        opts.tables?.[table] ?? [],
        opts.singles?.[table],
        (op) => writes.push({ table, ...op }),
      );
    },
    rpc(name: string, _args?: unknown) {
      return makeQuery(opts.rpcs?.[name] ?? [], undefined);
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  } as any;
}

/** Anthropic double that returns one text block of `text`. */
export function makeFakeAnthropic(text: string, usage?: Record<string, number>) {
  return {
    messages: {
      create: async (_opts: unknown) => ({
        content: [{ type: "text", text }],
        usage: {
          input_tokens: 1000,
          output_tokens: 80,
          cache_read_input_tokens: 0,
          ...usage,
        },
      }),
    },
  } as any;
}
