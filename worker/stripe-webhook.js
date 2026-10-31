/**
 * POST /stripe/webhook: Stripe's events about memberships. The signature is
 * checked with the endpoint's signing secret (STRIPE_WEBHOOK_SECRET, whsec_…)
 * using Web Crypto, the same check Stripe's SDK does in constructEventAsync.
 *
 * Any failure answers 500, so Stripe retries the event later. Every handler
 * is safe to run again (see members.js). Logs name the event, never the
 * member's details or any secret.
 */

import { json, safeMessage } from "./http.js";
import { memberJoined, membershipEnded, membershipRenewed } from "./members.js";

/** How old a signed event may be, as in Stripe's SDKs. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
const MAX_PAYLOAD = 512 * 1024;

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

function equalInConstantTime(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** Checks a Stripe-Signature header ("t=…,v1=…") against the raw payload. */
export async function verifyStripeSignature(payload, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!header || !secret) return false;
    const parts = header.split(",").map((p) => p.split("="));
    const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
    const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!Number.isInteger(timestamp) || signatures.length === 0) return false;
    if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
    return signatures.some((s) => equalInConstantTime(s, expected));
}

/** Runs the right handler for an event; other event types are acknowledged and ignored. */
export async function handleStripeEvent(env, event, now = new Date()) {
    const object = event.data?.object ?? {};
    switch (event.type) {
        case "checkout.session.completed":
            return memberJoined(env, object, now);
        case "invoice.paid":
            return membershipRenewed(env, object);
        case "customer.subscription.updated":
            // Cancelling keeps the code until the paid period ends (it then
            // expires, or is removed on .deleted); tier changes don't touch it.
            return "unchanged";
        case "customer.subscription.deleted":
            return membershipEnded(env, object, now);
        default:
            return "ignored";
    }
}

export async function handleStripeWebhook(request, env) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
    const payload = await request.text();
    if (payload.length > MAX_PAYLOAD || !(await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) {
        return json({ error: "invalid_signature" }, 400);
    }
    let event;
    try {
        event = JSON.parse(payload);
    } catch {
        return json({ error: "invalid_payload" }, 400);
    }
    try {
        const result = await handleStripeEvent(env, event);
        return json({ received: true, result }, 200);
    } catch (err) {
        console.error(`webhook: ${event.type} ${event.id} failed (${safeMessage(err)})`);
        return json({ error: "failed" }, 500);
    }
}
