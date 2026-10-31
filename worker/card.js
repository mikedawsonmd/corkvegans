/**
 * The digital membership card. Each membership has one card token,
 * "<subscription ID>.<signature>", signed with MEMBER_CODE_SECRET, so it
 * can't be guessed or made up and needs nothing stored. It's in the card
 * link in the welcome email and in the card's QR code. It isn't the member
 * code: a business scanning the card never sees the Eventbrite discount.
 *
 * POST /membership/card { token } answers whether the membership is live,
 * for the card page (to show this month) and the check page a business
 * opens from the QR code. It gives the first name only.
 */

import { LIVE, SOURCE } from "./members.js";
import { StripeError, stripe } from "./http.js";

export const CARD_TOKEN_PATTERN = /^(sub_[A-Za-z0-9]{8,64})\.([A-Za-z0-9_-]{22})$/;

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function signature(subscriptionId, secret) {
    if (!secret) throw new Error("MEMBER_CODE_SECRET is not set");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    // "card:" keeps these apart from member codes, which sign the bare ID.
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`card:${subscriptionId}`)));
    return base64url(bytes.slice(0, 16));
}

export async function cardTokenFor(subscriptionId, secret) {
    return `${subscriptionId}.${await signature(subscriptionId, secret)}`;
}

/** The subscription ID in a genuine token, or null. */
export async function subscriptionForCard(token, secret) {
    const match = typeof token === "string" ? CARD_TOKEN_PATTERN.exec(token) : null;
    if (!match) return null;
    const expected = await signature(match[1], secret);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ match[2].charCodeAt(i);
    return diff === 0 ? match[1] : null;
}

/** YYYY-MM-DD in Irish time. */
const irishDate = (seconds) => new Date(seconds * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });

/**
 * { status: "valid", firstName, endsOn? } while the membership is live (endsOn
 * only once it's been cancelled and is running to the end of its period),
 * { status: "ended" } after it ends, null for a token that isn't ours.
 */
export async function cardStatus(env, token) {
    const id = await subscriptionForCard(token, env.MEMBER_CODE_SECRET);
    if (!id) return null;
    let subscription;
    try {
        subscription = await stripe(env, "GET", `/v1/subscriptions/${id}`);
    } catch (err) {
        if (err instanceof StripeError && err.status === 404) return null;
        throw err;
    }
    if (subscription.metadata?.source !== SOURCE) return null;
    if (!LIVE.has(subscription.status)) return { status: "ended" };
    const firstName = subscription.metadata.first_name || undefined;
    const endsAt = subscription.cancel_at ?? (subscription.cancel_at_period_end ? subscription.items?.data?.[0]?.current_period_end : null);
    return { status: "valid", ...(firstName ? { firstName } : {}), ...(Number.isInteger(endsAt) ? { endsOn: irishDate(endsAt) } : {}) };
}
