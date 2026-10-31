/**
 * Helpers shared by the membership Worker's routes: CORS, JSON responses,
 * rate limits, Turnstile and the Stripe API.
 */

export const STRIPE_API_VERSION = "2026-09-30.endive"; // matches Stripe.js "endive" on the site
const ALLOWED_ORIGINS = new Set(["https://corkvegans.ie"]);
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** CORS for the site's own pages (and localhost while testing). */
export function cors(request) {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin);
    return { allowed, headers: allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" } };
}

export function preflight({ allowed, headers }) {
    return new Response(null, {
        status: allowed ? 204 : 403,
        headers: allowed
            ? { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" }
            : headers,
    });
}

export function json(data, status, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** The request's JSON body, or null if it isn't small, well-formed JSON. */
export async function readJson(request, maxLength) {
    if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) return null;
    const text = await request.text();
    if (text.length > maxLength) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export async function passesTurnstile(secret, token, ip) {
    if (!token) return false;
    try {
        const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        });
        const data = await res.json();
        return data.success === true;
    } catch {
        return false;
    }
}

/**
 * A per-IP limit. Uses the Cloudflare rate limit binding `binding` when the
 * Worker has one (see wrangler.toml), otherwise a per-instance in-memory count.
 */
export function rateLimit(binding, limit, windowMs = 60_000) {
    const recent = new Map();
    return async (env, ip) => {
        if (env[binding]) {
            const { success } = await env[binding].limit({ key: ip });
            return success;
        }
        const now = Date.now();
        const hits = (recent.get(ip) ?? []).filter((t) => now - t < windowMs);
        if (hits.length >= limit) return false;
        hits.push(now);
        recent.set(ip, hits);
        if (recent.size > 10_000) recent.clear();
        return true;
    };
}

export class StripeError extends Error {}

/**
 * Calls the Stripe API with the restricted key. Errors carry only the status,
 * error code and parameter name: never the key or Stripe's full message.
 * @param {"GET" | "POST" | "DELETE"} method
 * @param {Record<string, string>} [params] query string for GET, form body otherwise
 */
export async function stripe(env, method, path, params = {}, { idempotencyKey } = {}) {
    if (!env.STRIPE_SECRET_KEY) throw new StripeError("STRIPE_SECRET_KEY is not set");
    const query = new URLSearchParams(params);
    const url = `https://api.stripe.com${path}${method === "GET" && query.size ? `?${query}` : ""}`;
    const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_API_VERSION };
    if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await fetch(url, { method, headers, body: method === "GET" ? undefined : query });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = data?.error ?? {};
        throw new StripeError(`Stripe ${method} ${path.replace(/\/(cs|sub|cus|in|price|prod)_[A-Za-z0-9_]+/g, "/$1_…")} responded ${res.status}${e.code ? ` ${e.code}` : ""}${e.param ? ` (${e.param})` : ""}`);
    }
    return data;
}

/** An error message that's safe to log: no keys, emails or member codes. */
export function safeMessage(err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return message
        .replace(/\b(sk|rk|whsec|re)_[A-Za-z0-9_]+/g, "[secret]")
        .replace(/[^\s@]+@[^\s@]+/g, "[email]")
        .replace(/\bCV-[A-Z0-9]{6}\b/g, "[code]");
}
