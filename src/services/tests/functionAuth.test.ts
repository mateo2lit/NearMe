jest.mock("../supabase", () => ({
  supabase: { auth: { getSession: jest.fn() } },
  SUPABASE_ANON_KEY: "anon",
}));
import { supabase } from "../supabase";
import { functionBearer } from "../functionAuth";

const getSession = (supabase as any).auth.getSession as jest.Mock;

test("sends the signed-in user's token", async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
  await expect(functionBearer()).resolves.toBe("jwt");
});

test("falls back to the anon key without a session", async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  await expect(functionBearer()).resolves.toBe("anon");
});

test("falls back to the anon key if the session read throws", async () => {
  getSession.mockRejectedValue(new Error("storage"));
  await expect(functionBearer()).resolves.toBe("anon");
});
