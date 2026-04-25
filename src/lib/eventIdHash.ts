export function hashEventIds(ids: readonly string[]): string {
  const sorted = [...ids].sort();
  const joined = sorted.join("|");
  let h = 2166136261 >>> 0; // FNV offset basis
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
