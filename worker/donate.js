/**
 * Cork Vegans donations: POST /donate/session creates a Stripe Checkout
 * Session for the embedded donation form on corkvegans.ie/support/ and
 * returns only its client secret.
 *
 * Works two ways (see docs/ADMIN-GUIDE.md, "Donations"):
 *   - as its own Worker: deploy this folder with `npx wrangler deploy`
 *     (index.js is the entry point);
 *   - inside another Worker: copy this file next to it, import
 *     { handleDonate } and call it first in that Worker's fetch handler. It
 *     returns null for any other path, so the existing routes carry on
 *     exactly as before. Don't make this file the Worker's main module: the
 *     runtime rejects its non-handler exports.
 *
 * Secrets, variables and bindings:
 *   PAYMENTS_ENABLED      (variable, required) must be "true", otherwise
 *                         /donate/session answers 404 like any unknown path
 *   STRIPE_SECRET_KEY     (secret, required) restricted key rk_… or sk_…
 *   TURNSTILE_SECRET_KEY  (secret, optional) turns on the Turnstile check
 *   DONATE_RATE_LIMITER   (rate limit binding, optional) see wrangler.toml;
 *                         without it a per-instance in-memory limit is used
 */

const PATH = "/donate/session";
const STRIPE_API_VERSION = "2026-09-30.endive"; // matches Stripe.js "endive" on the site
const ALLOWED_ORIGINS = new Set(["https://corkvegans.ie"]);
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

// Whole euros. Keep in step with src/lib/donations.ts (a unit test checks).
export const DONATION_MIN = 2;
export const DONATION_MAX = 500;

// Card-testing protection: session creations per IP per minute.
export const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

/** @typedef {{ frequency: "monthly" | "once", amount: number, turnstileToken?: string }} Donation */

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @returns {Promise<Response | null>} null when the request isn't for this endpoint
 */
export async function handleDonate(request, env) {
    if (new URL(request.url).pathname !== PATH) return null;
    // Switched off unless explicitly enabled (payments are off on the site too).
    if (env.PAYMENTS_ENABLED !== "true") return new Response("Not found", { status: 404 });

    const origin = request.headers.get("Origin") ?? "";
    const allowed = ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin);
    const cors = allowed
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : { Vary: "Origin" };

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: allowed ? 204 : 403,
            headers: allowed
                ? { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" }
                : cors,
        });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { ...cors, Allow: "POST, OPTIONS" });
    if (!allowed) return json({ error: "forbidden" }, 403, cors);

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await withinRateLimit(env, ip))) return json({ error: "rate_limited" }, 429, { ...cors, "Retry-After": "60" });

    if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) return json({ error: "invalid_request" }, 400, cors);
    const text = await request.text();
    if (text.length > 2048) return json({ error: "invalid_request" }, 400, cors);
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        return json({ error: "invalid_request" }, 400, cors);
    }
    const donation = parseDonation(body);
    if (!donation) return json({ error: "invalid_request" }, 400, cors);

    if (env.TURNSTILE_SECRET_KEY && !(await passesTurnstile(env.TURNSTILE_SECRET_KEY, donation.turnstileToken, ip))) {
        return json({ error: "verification_failed" }, 403, cors);
    }

    if (!env.STRIPE_SECRET_KEY) {
        console.error("donate: STRIPE_SECRET_KEY is not set");
        return json({ error: "checkout_unavailable" }, 500, cors);
    }

    try {
        const clientSecret = await createCheckoutSession(env.STRIPE_SECRET_KEY, donation);
        return json({ clientSecret }, 200, { ...cors, "Cache-Control": "no-store" });
    } catch (err) {
        // Log only what helps debugging; never the key or the full Stripe response.
        console.error(`donate: could not create Checkout Session (${err instanceof Error ? err.message : "unknown error"})`);
        return json({ error: "checkout_unavailable" }, 502, cors);
    }
}

/**
 * Strict: exactly { frequency, amount } plus an optional Turnstile token.
 * @returns {Donation | null}
 */
export function parseDonation(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const keys = Object.keys(body);
    if (keys.some((k) => !["frequency", "amount", "turnstileToken"].includes(k))) return null;
    const { frequency, amount, turnstileToken } = body;
    if (frequency !== "monthly" && frequency !== "once") return null;
    if (!Number.isInteger(amount) || amount < DONATION_MIN || amount > DONATION_MAX) return null;
    if (turnstileToken !== undefined && (typeof turnstileToken !== "string" || turnstileToken.length > 2048)) return null;
    return { frequency, amount, turnstileToken };
}

/** @param {Donation} donation */
export function checkoutSessionParams({ frequency, amount }) {
    const params = new URLSearchParams({
        ui_mode: "embedded_page",
        redirect_on_completion: "never",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(amount * 100),
        "name_collection[individual][enabled]": "true",
        "metadata[source]": "corkvegans.ie",
        "metadata[frequency]": frequency,
    });
    if (frequency === "monthly") {
        params.set("mode", "subscription");
        params.set("line_items[0][price_data][product_data][name]", "Monthly donation to Cork Vegans");
        params.set("line_items[0][price_data][recurring][interval]", "month");
    } else {
        params.set("mode", "payment");
        params.set("line_items[0][price_data][product_data][name]", "Donation to Cork Vegans");
        params.set("submit_type", "donate");
        params.set("customer_creation", "always");
    }
    return params;
}

/** @param {string} secretKey @param {Donation} donation */
async function createCheckoutSession(secretKey, donation) {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Stripe-Version": STRIPE_API_VERSION,
        },
        body: checkoutSessionParams(donation),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.client_secret !== "string") {
        throw new Error(`Stripe responded ${res.status}${data?.error?.code ? ` ${data.error.code}` : ""}${data?.error?.param ? ` (${data.error.param})` : ""}`);
    }
    return data.client_secret;
}

async function passesTurnstile(secret, token, ip) {
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

/** @type {Map<string, number[]>} Fallback when no rate limit binding is configured. */
const recent = new Map();

async function withinRateLimit(env, ip) {
    if (env.DONATE_RATE_LIMITER) {
        const { success } = await env.DONATE_RATE_LIMITER.limit({ key: ip });
        return success;
    }
    const now = Date.now();
    const hits = (recent.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= RATE_LIMIT) return false;
    hits.push(now);
    recent.set(ip, hits);
    if (recent.size > 10_000) recent.clear();
    return true;
}

function json(data, status, headers) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}
