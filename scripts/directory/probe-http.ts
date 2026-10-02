import robotsParserModule from "npm:robots-parser@3.0.1";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { normalizeUrl, publicAddress } from "./probe-targets.ts";
import { USER_AGENT } from "./probe-types.ts";

export interface WireResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  url?: string;
}
export interface Budget {
  requests: number;
  origins: Set<string>;
}
const MAX_BODY = 2 * 1024 * 1024;
// robots-parser is CommonJS; its bundled declaration uses an ESM default.
const robotsParser = robotsParserModule as unknown as (
  url: string,
  text: string,
) => {
  isAllowed(url: string, agent: string): boolean | undefined;
  getCrawlDelay(agent: string): number | undefined;
};
// Node's request lookup callback pins the checked address while retaining the
// original hostname for Host/SNI/certificate verification. No second DNS lookup.
export async function pinnedRequest(
  url: string,
  headers: Record<string, string>,
): Promise<WireResponse> {
  const u = new URL(normalizeUrl(url));
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const addresses = await Promise.race([
      lookup(u.hostname, { all: true, family: 4 }),
      new Promise<never>((_, reject) =>
        abort.signal.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          { once: true },
        )
      ),
    ]);
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) {
      throw new Error("unsafe_address");
    }
    abort.signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, {
        method: "GET",
        agent: false,
        signal: abort.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/json,text/calendar;q=0.9,*/*;q=0.5",
          "Accept-Encoding": "identity",
          ...headers,
        },
        // Deno supports the Node lookup signature, including callers requesting all addresses.
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all) {
            callback(null, [addresses[0]]);
          } else callback(null, addresses[0].address, 4);
        },
      }, (res) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (Number(res.headers["content-length"] ?? 0) > MAX_BODY) {
          req.destroy(new Error("body_limit"));
          return;
        }
        res.on("data", (chunk: Uint8Array) => {
          size += chunk.byteLength;
          if (size > MAX_BODY) req.destroy(new Error("body_limit"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const joined = new Uint8Array(size);
          let offset = 0;
          for (const c of chunks) {
            joined.set(c, offset);
            offset += c.length;
          }
          const h: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined) {
              h[key] = Array.isArray(value) ? value.join(", ") : value;
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: h,
            body: new TextDecoder().decode(joined),
            url,
          });
        });
      });
      req.on(
        "error",
        (e) =>
          reject(
            new Error(
              abort.signal.aborted
                ? "timeout"
                : e.message === "body_limit"
                ? "body_limit"
                : "http_error",
            ),
          ),
      );
      req.end();
    });
  } finally {
    clearTimeout(timer);
  }
}
export function createProbeHttp(
  options: {
    wire?: typeof pinnedRequest;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const wire = options.wire ?? pinnedRequest, now = options.now ?? Date.now;
  const sleep = options.sleep ??
    ((ms) => new Promise((r) => setTimeout(r, ms)));
  const hosts = new Map<
    string,
    { tail: Promise<unknown>; next: number; delay: number }
  >();
  const robots = new Map<string, Promise<ReturnType<typeof robotsParser>>>();
  const stats = { content_requests: 0, robots_requests: 0, bytes: 0 };
  async function send(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<WireResponse> {
    const host = new URL(url).hostname;
    const state = hosts.get(host) ??
      { tail: Promise.resolve(), next: 0, delay: 1000 };
    hosts.set(host, state);
    const run = state.tail.catch(() => {}).then(async () => {
      const wait = state.next - now();
      // A long Retry-After is persisted as retryable failure, never held for hours.
      if (wait > 60_000) throw new Error("http_error");
      if (wait > 0) await sleep(wait);
      state.next = now() + state.delay;
      const r = await wire(url, headers);
      const bytes = new TextEncoder().encode(r.body).length;
      if (bytes > MAX_BODY) throw new Error("body_limit");
      stats.bytes += bytes;
      if (r.status === 429 || r.status === 503) {
        const retry = r.headers["retry-after"];
        const delay = retry && /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : retry
          ? Date.parse(retry) - now()
          : 60_000;
        state.next = Math.max(
          state.next,
          now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 60_000),
        );
      }
      return r;
    });
    state.tail = run;
    return await run;
  }
  async function rules(url: URL) {
    let pending = robots.get(url.origin);
    if (!pending) {
      pending = (async () => {
        stats.robots_requests++;
        const r = await send(`${url.origin}/robots.txt`);
        // Robots redirects conservatively defer: never follow a new host unchecked.
        if (![200, 404, 410].includes(r.status)) {
          throw new Error(
            r.status === 401 || r.status === 403
              ? "robots_disallowed"
              : "robots_unavailable",
          );
        }
        if (r.status === 200 && /<(?:html|!doctype)/i.test(r.body)) {
          throw new Error("robots_unavailable");
        }
        const parsed = robotsParser(
          `${url.origin}/robots.txt`,
          r.status === 200 ? r.body : "",
        );
        const delay = parsed.getCrawlDelay(USER_AGENT);
        if (delay && Number.isFinite(delay)) {
          const state = hosts.get(url.hostname)!;
          state.delay = Math.max(1000, delay * 1000);
          state.next = Math.max(state.next, now() + state.delay);
        }
        return parsed;
      })();
      robots.set(url.origin, pending);
    }
    return await pending;
  }
  async function get(
    value: string,
    budget: Budget,
    headers: Record<string, string> = {},
  ): Promise<WireResponse> {
    let url = normalizeUrl(value);
    const safeHeaders: Record<string, string> = {};
    for (const key of ["If-None-Match", "If-Modified-Since"]) {
      if (headers[key]) safeHeaders[key] = headers[key];
    }
    for (let hop = 0; hop <= 3; hop++) {
      const u = new URL(url);
      if (
        budget.requests >= 9 ||
        (!budget.origins.has(u.origin) && budget.origins.size >= 3)
      ) throw new Error("budget_exhausted");
      budget.origins.add(u.origin);
      if ((await rules(u)).isAllowed(url, USER_AGENT) === false) {
        throw new Error("robots_disallowed");
      }
      budget.requests++;
      stats.content_requests++;
      const r = await send(url, safeHeaders);
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        if (!r.headers.location || hop === 3) throw new Error("http_error");
        url = normalizeUrl(r.headers.location, url);
        // Validators belong to one representation, never forward them to a new host.
        delete safeHeaders["If-None-Match"];
        delete safeHeaders["If-Modified-Since"];
        continue;
      }
      return { ...r, url };
    }
    throw new Error("http_error");
  }
  return {
    get,
    stats,
    budget: (): Budget => ({ requests: 0, origins: new Set() }),
  };
}
