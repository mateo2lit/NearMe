import { _resetCacheForTests, fetchClaudeRanking } from "../claudeRank";

describe("fetchClaudeRanking", () => {
  beforeEach(() => {
    _resetCacheForTests();
    (global as any).fetch = jest.fn();
  });

  it("calls the rank endpoint with user_id + event_ids", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ event_id: "e1", rank_score: 90, blurb: "live music match" }],
    });
    const result = await fetchClaudeRanking({
      userId: "u1", eventIds: ["e1"], supabaseUrl: "https://x.supabase.co", anonKey: "anon",
    });
    expect(result).toEqual([{ event_id: "e1", rank_score: 90, blurb: "live music match" }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("caches by (sorted) event_ids hash within 5 minutes", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ event_id: "a", rank_score: 1, blurb: "" }],
    });
    await fetchClaudeRanking({ userId: "u1", eventIds: ["a","b"], supabaseUrl: "x", anonKey: "y" });
    await fetchClaudeRanking({ userId: "u1", eventIds: ["b","a"], supabaseUrl: "x", anonKey: "y" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns empty array on 503 (circuit open)", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false, status: 503, json: async () => ({ error: "circuit_open" }),
    });
    const result = await fetchClaudeRanking({ userId: "u1", eventIds: ["e1"], supabaseUrl: "x", anonKey: "y" });
    expect(result).toEqual([]);
  });
});
