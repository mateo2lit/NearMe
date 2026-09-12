/**
 * Pack-the-feed widening, with honest distance labelling.
 *
 * 1.1.0 removed widening entirely ("radius is a promise"). That left real
 * events 12-40mi away unreachable and the feed empty. Widening comes back for
 * DEFAULT-radius, unfiltered searches only — and anything it reaches past the
 * user's radius is tagged so the card can say so out loud.
 */
import { DEFAULT_RADIUS_MILES } from "../../constants/theme";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: any[]) => mockRpc(...args) },
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
}));
jest.mock("../eventCache", () => ({
  getCachedEvents: jest.fn(async () => []),
  setCachedEvents: jest.fn(async () => {}),
}));
jest.mock("../../hooks/useSyncStatus", () => ({
  markSyncStart: jest.fn(), markSyncDone: jest.fn(), setSyncContext: jest.fn(),
}));

const { fetchNearbyEvents, getLastFetchError, triggerLocationSync } = require("../events");
const { getCachedEvents, setCachedEvents } = require("../eventCache");

// Far-future so filterPastEvents never drops them.
const future = new Date(Date.now() + 5 * 86400_000).toISOString();

function rows(n: number, prefix: string, distance = 1, is_recurring = false) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    title: `${prefix} ${i}`,
    category: "music",
    is_recurring,
    start_time: future,
    end_time: null,
    tags: [],
    distance,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockReset();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as any;
});

test("default radius + sparse results widens and tags what lies outside the radius", async () => {
  mockRpc.mockImplementation(async (_fn: string, params: any) =>
    params.radius_miles <= DEFAULT_RADIUS_MILES
      ? { data: rows(3, "near"), error: null }
      : { data: [...rows(3, "near"), ...rows(25, "far", 22)], error: null },
  );

  const events = await fetchNearbyEvents(26.3683, -80.0831, DEFAULT_RADIUS_MILES);

  expect(events.length).toBeGreaterThanOrEqual(20);
  const near = events.filter((e: any) => e.id.startsWith("near-"));
  const far = events.filter((e: any) => e.id.startsWith("far-"));
  // Events inside the user's radius are never mislabelled.
  expect(near.every((e: any) => e.outsideRadiusMiles == null)).toBe(true);
  // Everything the widening reached is labelled with the radius they asked for.
  expect(far.length).toBeGreaterThan(0);
  expect(far.every((e: any) => e.outsideRadiusMiles === DEFAULT_RADIUS_MILES)).toBe(true);
});

test("a packed feed at the exact radius never widens", async () => {
  mockRpc.mockResolvedValue({ data: rows(25, "near"), error: null });

  const events = await fetchNearbyEvents(26.3683, -80.0831, DEFAULT_RADIUS_MILES);

  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(events.every((e: any) => e.outsideRadiusMiles == null)).toBe(true);
});

test("an explicit user filter is a hard constraint — no widening even when sparse", async () => {
  mockRpc.mockResolvedValue({ data: rows(2, "near"), error: null });

  const withTags = await fetchNearbyEvents(26.3683, -80.0831, DEFAULT_RADIUS_MILES, undefined, ["singles"]);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(withTags).toHaveLength(2);

  mockRpc.mockClear();
  const tightRadius = await fetchNearbyEvents(26.3683, -80.0831, 2);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(tightRadius).toHaveLength(2);
});

test("a starved area asks the backend for a full AI-backed sync", async () => {
  mockRpc.mockResolvedValue({ data: rows(1, "near"), error: null });

  await fetchNearbyEvents(26.3683, -80.0831, DEFAULT_RADIUS_MILES);

  const bodies = (global.fetch as jest.Mock).mock.calls.map((c) => JSON.parse(c[1].body));
  expect(bodies.some((b) => b.allow_ai === true)).toBe(true);
});

test("a healthy area does not ask for AI spend", async () => {
  mockRpc.mockResolvedValue({ data: rows(25, "near"), error: null });

  await fetchNearbyEvents(26.3683, -80.0831, DEFAULT_RADIUS_MILES);

  const bodies = (global.fetch as jest.Mock).mock.calls.map((c) => JSON.parse(c[1].body));
  expect(bodies.every((b) => b.allow_ai === false)).toBe(true);
});

/**
 * The failure that emptied the Boca feed: 348 recurring venue specials, last
 * verified four months earlier, cleared the >=20 floor. Widening never ran, so
 * the real dated concerts 12-40mi away stayed invisible and the app looked
 * like it had "no events". A wall of recurring filler is not a full feed.
 */
test("a feed of nothing but recurring filler still widens to find dated plans", async () => {
  mockRpc.mockImplementation(async (_fn: string, params: any) =>
    params.radius_miles <= DEFAULT_RADIUS_MILES
      ? { data: rows(348, "filler", 4, true), error: null }
      : { data: [...rows(348, "filler", 4, true), ...rows(9, "concert", 24)], error: null },
  );

  const events = await fetchNearbyEvents(26.3683, -80.0831, DEFAULT_RADIUS_MILES);

  const dated = events.filter((e: any) => !e.is_recurring);
  expect(dated.length).toBeGreaterThanOrEqual(8);
  expect(dated.every((e: any) => e.outsideRadiusMiles === DEFAULT_RADIUS_MILES)).toBe(true);
});

test("a feed already holding real dated plans is left alone", async () => {
  mockRpc.mockResolvedValue({
    data: [...rows(20, "filler", 4, true), ...rows(10, "concert", 4)],
    error: null,
  });

  await fetchNearbyEvents(26.3683, -80.0831, DEFAULT_RADIUS_MILES);

  expect(mockRpc).toHaveBeenCalledTimes(1);
});

test("filtered sparse searches do not request AI based on their filtered count", async () => {
  mockRpc.mockResolvedValue({ data: rows(1, "music"), error: null });
  await fetchNearbyEvents(26.4, -80.1, DEFAULT_RADIUS_MILES, ["music"]);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).allow_ai).toBe(false);
});

test("an initial RPC failure surfaces as an error without widening or starting paid recovery", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    mockRpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(fetchNearbyEvents(26.4, -80.1, DEFAULT_RADIUS_MILES)).rejects.toThrow("database unavailable");
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(setCachedEvents).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test("a failed wider query keeps valid local results and stops further expansion", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    mockRpc.mockResolvedValueOnce({ data: rows(3, "local"), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    const events = await fetchNearbyEvents(26.4, -80.1, DEFAULT_RADIUS_MILES);
    expect(events).toHaveLength(3);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(getLastFetchError()).toBe("timeout");
  } finally { log.mockRestore(); }
});

test("cached requests carry the same radius and filters as fresh requests", async () => {
  await fetchNearbyEvents(26.4, -80.1, 2, ["music"], ["free"], { cachedOnly: true });
  expect(getCachedEvents).toHaveBeenCalledWith(26.4, -80.1, {
    radiusMiles: 2, categories: ["music"], tags: ["free"],
  });
  expect(mockRpc).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("a successfully empty search replaces old cached events", async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await fetchNearbyEvents(26.4, -80.1, 2);
  expect(setCachedEvents).toHaveBeenCalledWith(26.4, -80.1, [], {
    radiusMiles: 2, categories: undefined, tags: undefined,
  });
});

test("HTTP errors cannot report a successful sync", async () => {
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ synced: true, upserted: 90 }) })) as any;
  expect(await triggerLocationSync(26.4, -80.1, 10, true)).toEqual({ synced: false });
});
