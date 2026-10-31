/**
 * Cork Vegans membership Worker. Routes:
 *   POST /membership/session  creates a Stripe Embedded Checkout session for
 *                             the join form on corkvegans.ie/support/
 *   POST /membership/code     the new member's code, for the thank-you screen
 *   POST /membership/resend   "Lost your code?": re-sends the welcome email
 *   POST /stripe/webhook      Stripe events (stripe-webhook.js)
 *   /donate/session           retired: 410 Gone
 *
 * Works as its own Worker (index.js is the entry point; deploy this folder
 * with `npx wrangler deploy`) or inside another one: import
 * { handleMembership } and call it first in that Worker's fetch handler. It
 * returns null for any other path. Setup: docs/ADMIN-GUIDE.md, "Membership".
 *
 * Secrets, variables and bindings:
 *   PAYMENTS_ENABLED       (variable) must be "true", otherwise the
 *                          /membership/ routes answer 404
 *   STRIPE_SECRET_KEY      (secret) restricted key rk_…
 *   STRIPE_WEBHOOK_SECRET  (secret) whsec_…; without it /stripe/webhook is 404
 *   TURNSTILE_SECRET_KEY   (secret, optional) turns on the Turnstile check
 *   MEMBER_CODE_SECRET, MEMBER_DISCOUNT_EUR, MEMBER_CODE_GRACE_DAYS: members.js
 *   EVENTBRITE_*: eventbrite.js. BREVO_API_KEY, EMAIL_*, STRIPE_PORTAL_URL: welcome-email.js
 *   MEMBERSHIP_RATE_LIMITER, CODE_RATE_LIMITER, LOOKUP_RATE_LIMITER
 *                          (rate limit bindings, optional) see wrangler.toml
 */

import { cors, json, passesTurnstile, preflight, rateLimit, readJson, safeMessage, stripe } from "./http.js";
import { CODE_PATTERN, SOURCE, resendMemberCodes } from "./members.js";
import { handleStripeWebhook } from "./stripe-webhook.js";

// Whole euros. Keep in step with src/lib/membership.ts (a unit test checks).
export const PRESETS = { monthly: [5, 10, 15], yearly: [50, 100] };
export const LIMITS = { monthly: { min: 2, max: 500 }, yearly: { min: 50, max: 500 } };
const INTERVAL = { monthly: "month", yearly: "year" };
export const lookupKey = (frequency, amount) => `membership_${frequency}_${amount}`;
/** Amounts members choose themselves. Keep in step with scripts/stripe-membership-catalogue.ts (a unit test checks). */
export const CUSTOM_PRODUCT_ID = "cv_membership_custom";

// Card-testing and abuse protection, per IP per minute.
export const RATE_LIMIT = 5;
const joinLimit = rateLimit("MEMBERSHIP_RATE_LIMITER", RATE_LIMIT);
const codeLimit = rateLimit("CODE_RATE_LIMITER", 30); // the thank-you screen checks every few seconds
const lookupLimit = rateLimit("LOOKUP_RATE_LIMITER", 3);

/** The thank-you screen may fetch the code for this long after checkout opened. */
const CODE_WINDOW_SECONDS = 24 * 3600;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Real ones are a few hundred characters and include %-encoded characters.
const CLIENT_SECRET = /^(cs_(?:test|live)_[A-Za-z0-9]+)_secret_[A-Za-z0-9%_-]+$/;

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {{ waitUntil(promise: Promise<unknown>): void }} [ctx]
 * @returns {Promise<Response | null>} null when the request isn't for this Worker
 */
export async function handleMembership(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === "/donate/session") return json({ error: "gone" }, 410);
    if (path === "/stripe/webhook") return env.STRIPE_WEBHOOK_SECRET ? handleStripeWebhook(request, env) : new Response("Not found", { status: 404 });

    const route = { "/membership/session": join, "/membership/code": code, "/membership/resend": resend }[path];
    if (!route) return null;
    // Switched off unless explicitly enabled (as on the site).
    if (env.PAYMENTS_ENABLED !== "true") return new Response("Not found", { status: 404 });

    const c = cors(request);
    if (request.method === "OPTIONS") return preflight(c);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { ...c.headers, Allow: "POST, OPTIONS" });
    if (!c.allowed) return json({ error: "forbidden" }, 403, c.headers);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    return route(request, env, { ip, headers: c.headers, ctx });
}

// ── Validation ────────────────────────────────────────────────────────────

/** Trimmed text of at most `max` characters with no control characters, or null. */
function text(value, max, { optional = false } = {}) {
    if (value === undefined && optional) return "";
    if (typeof value !== "string") return null;
    const clean = value.trim().replace(/\s+/g, " ");
    if (/[\u0000-\u001f\u007f]/.test(clean) || clean.length > max || (!optional && !clean)) return null;
    return clean;
}

export function parseEmail(value) {
    const email = text(value, 254);
    return email && EMAIL.test(email) ? email.toLowerCase() : null;
}

const JOIN_KEYS = new Set(["frequency", "amount", "firstName", "lastName", "email", "heardAbout", "updates", "terms", "turnstileToken"]);

/**
 * Strict: exactly the join form's fields. The amount is a whole number of
 * euros within that frequency's limits; presets use their catalogue price.
 */
export function parseJoin(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    if (Object.keys(body).some((k) => !JOIN_KEYS.has(k))) return null;
    const { frequency, amount, updates, terms, turnstileToken } = body;
    const limits = LIMITS[frequency];
    if (!limits || !Object.hasOwn(LIMITS, frequency)) return null;
    if (!Number.isInteger(amount) || amount < limits.min || amount > limits.max) return null;
    const firstName = text(body.firstName, 60);
    const lastName = text(body.lastName, 60);
    const email = parseEmail(body.email);
    const heardAbout = text(body.heardAbout, 200, { optional: true });
    if (firstName === null || lastName === null || email === null || heardAbout === null) return null;
    if (typeof updates !== "boolean" || terms !== true) return null;
    if (turnstileToken !== undefined && (typeof turnstileToken !== "string" || turnstileToken.length > 2048)) return null;
    return { frequency, amount, preset: PRESETS[frequency].includes(amount), firstName, lastName, email, heardAbout, updates, turnstileToken };
}

// ── POST /membership/session ──────────────────────────────────────────────

/** Preset prices by lookup key, cached for a few minutes per Worker instance. */
const prices = new Map();
async function presetPrice(env, key) {
    const hit = prices.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.price;
    const price = (await stripe(env, "GET", "/v1/prices", { "lookup_keys[]": key, active: "true", limit: "1" })).data?.[0];
    if (!price?.id) throw new Error(`no active price with lookup key ${key}`);
    prices.set(key, { price, at: Date.now() });
    return price;
}

export function checkoutSessionParams(join, { priceId, now = new Date() }) {
    const details = {
        source: SOURCE,
        frequency: join.frequency,
        amount_eur: String(join.amount),
        plan: join.preset ? "preset" : "custom",
        first_name: join.firstName,
        last_name: join.lastName,
        heard_about: join.heardAbout,
        email_updates: join.updates ? "yes" : "no",
        terms_accepted_at: now.toISOString(),
    };
    const params = new URLSearchParams({
        ui_mode: "embedded_page",
        redirect_on_completion: "never",
        mode: "subscription",
        customer_email: join.email,
        "line_items[0][quantity]": "1",
    });
    if (join.preset) {
        params.set("line_items[0][price]", priceId);
    } else {
        params.set("line_items[0][price_data][currency]", "eur");
        params.set("line_items[0][price_data][product]", CUSTOM_PRODUCT_ID);
        params.set("line_items[0][price_data][unit_amount]", String(join.amount * 100));
        params.set("line_items[0][price_data][recurring][interval]", INTERVAL[join.frequency]);
    }
    for (const [key, value] of Object.entries(details)) {
        params.set(`metadata[${key}]`, value);
        params.set(`subscription_data[metadata][${key}]`, value);
    }
    return params;
}

async function join(request, env, { ip, headers }) {
    if (!(await joinLimit(env, ip))) return json({ error: "rate_limited" }, 429, { ...headers, "Retry-After": "60" });
    const membership = parseJoin(await readJson(request, 4096));
    if (!membership) return json({ error: "invalid_request" }, 400, headers);
    if (env.TURNSTILE_SECRET_KEY && !(await passesTurnstile(env.TURNSTILE_SECRET_KEY, membership.turnstileToken, ip))) {
        return json({ error: "verification_failed" }, 403, headers);
    }
    try {
        const priceId = membership.preset ? (await presetPrice(env, lookupKey(membership.frequency, membership.amount))).id : undefined;
        const session = await stripe(env, "POST", "/v1/checkout/sessions", checkoutSessionParams(membership, { priceId }));
        if (typeof session.client_secret !== "string") throw new Error("Stripe didn't return a client secret");
        return json({ clientSecret: session.client_secret }, 200, { ...headers, "Cache-Control": "no-store" });
    } catch (err) {
        console.error(`membership: could not create Checkout Session (${safeMessage(err)})`);
        return json({ error: "checkout_unavailable" }, 502, headers);
    }
}

// ── POST /membership/code ─────────────────────────────────────────────────

/**
 * Only the browser that went through checkout has the session's client
 * secret, so it's the proof of who's asking. Answers { status: "ready", code }
 * once the webhook has made the code, { status: "pending" } until then.
 */
async function code(request, env, { ip, headers }) {
    if (!(await codeLimit(env, ip))) return json({ error: "rate_limited" }, 429, { ...headers, "Retry-After": "60" });
    const body = await readJson(request, 1024);
    const match = typeof body?.clientSecret === "string" && Object.keys(body).length === 1 ? CLIENT_SECRET.exec(body.clientSecret) : null;
    if (!match) return json({ error: "invalid_request" }, 400, headers);
    try {
        const session = await stripe(env, "GET", `/v1/checkout/sessions/${match[1]}`, { "expand[]": "subscription" });
        const fresh = Date.now() / 1000 - session.created < CODE_WINDOW_SECONDS;
        if (session.metadata?.source !== SOURCE || !fresh || (session.client_secret && session.client_secret !== body.clientSecret)) {
            return json({ error: "not_found" }, 404, headers);
        }
        const memberCode = session.status === "complete" ? session.subscription?.metadata?.member_code : undefined;
        const ready = typeof memberCode === "string" && CODE_PATTERN.test(memberCode);
        return json(ready ? { status: "ready", code: memberCode } : { status: "pending" }, 200, { ...headers, "Cache-Control": "no-store" });
    } catch (err) {
        console.error(`membership: could not look up a new member's code (${safeMessage(err)})`);
        return json({ error: "unavailable" }, 502, headers);
    }
}

// ── POST /membership/resend ───────────────────────────────────────────────

/**
 * Always the same answer, straight away, whether or not the email belongs to
 * a member: the lookup and sending happen after the response.
 */
async function resend(request, env, { ip, headers, ctx }) {
    if (!(await lookupLimit(env, ip))) return json({ error: "rate_limited" }, 429, { ...headers, "Retry-After": "60" });
    const body = await readJson(request, 3072);
    const keysOk = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((k) => k === "email" || k === "turnstileToken");
    const email = keysOk ? parseEmail(body.email) : null;
    if (!email || (body.turnstileToken !== undefined && (typeof body.turnstileToken !== "string" || body.turnstileToken.length > 2048))) {
        return json({ error: "invalid_request" }, 400, headers);
    }
    if (env.TURNSTILE_SECRET_KEY && !(await passesTurnstile(env.TURNSTILE_SECRET_KEY, body.turnstileToken, ip))) {
        return json({ error: "verification_failed" }, 403, headers);
    }
    const work = resendMemberCodes(env, email).catch((err) => console.error(`membership: "Lost your code?" failed (${safeMessage(err)})`));
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
    return json({ ok: true }, 200, headers);
}
