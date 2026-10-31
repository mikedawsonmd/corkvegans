/**
 * A member's code through their membership: made when they join, extended
 * on each renewal, removed when the membership ends. Every step can run more
 * than once (Stripe retries webhooks) and does the work only once: the code
 * and its Eventbrite discount ID are saved on the Stripe subscription, and
 * the code itself is worked out from the subscription ID, so even a retry
 * after a crash makes the same code.
 *
 * Variables: MEMBER_CODE_SECRET (secret, any long random string),
 * MEMBER_DISCOUNT_EUR (default 5), MEMBER_CODE_GRACE_DAYS (default 3).
 */

import { createMemberDiscount, removeMemberDiscount, setMemberDiscountEnd } from "./eventbrite.js";
import { stripe } from "./http.js";
import { membershipPrice, sendEmail, welcomeEmail } from "./welcome-email.js";

export const SOURCE = "corkvegans.ie";
/** No 0/O, 1/I/L or other look-alikes. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_PATTERN = /^CV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const LIVE = new Set(["active", "trialing", "past_due"]);
/** "Lost your code?" won't re-send to the same membership more often than this. */
export const RESEND_INTERVAL_MS = 10 * 60_000;

const discountEur = (env) => Number(env.MEMBER_DISCOUNT_EUR ?? 5);
const graceDays = (env) => Number(env.MEMBER_CODE_GRACE_DAYS ?? 3);

/** CV- and six characters, from an HMAC of the subscription ID. */
export async function memberCodeFor(subscriptionId, secret) {
    if (!secret) throw new Error("MEMBER_CODE_SECRET is not set");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(subscriptionId)));
    return `CV-${[...bytes.slice(0, 6)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
}

/** The end of the paid period: on the subscription item since Stripe's 2025 API versions. */
export function periodEnd(subscription) {
    const seconds = subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
    if (!Number.isInteger(seconds)) throw new Error("subscription has no current period end");
    return seconds;
}

export const codeEndDate = (subscription, env) => new Date((periodEnd(subscription) + graceDays(env) * 86_400) * 1000);

const getSubscription = (env, id) => stripe(env, "GET", `/v1/subscriptions/${id}`);
const saveOnSubscription = (env, id, metadata) =>
    stripe(env, "POST", `/v1/subscriptions/${id}`, Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v])));

async function sendWelcome(env, subscription, to) {
    const content = welcomeEmail({
        firstName: subscription.metadata?.first_name,
        code: subscription.metadata.member_code,
        price: membershipPrice(subscription),
        discountEur: discountEur(env),
        portalUrl: env.STRIPE_PORTAL_URL,
    });
    await sendEmail(env, to, content);
}

/** checkout.session.completed: member details, then the code, then the welcome email. */
export async function memberJoined(env, session, now = new Date()) {
    if (session.mode !== "subscription" || typeof session.subscription !== "string") return "ignored";
    let subscription = await getSubscription(env, session.subscription);
    const meta = subscription.metadata ?? {};
    if (meta.source !== SOURCE) return "ignored";

    const customer = await stripe(env, "POST", `/v1/customers/${subscription.customer}`, {
        name: `${meta.first_name ?? ""} ${meta.last_name ?? ""}`.trim(),
        "metadata[first_name]": meta.first_name ?? "",
        "metadata[last_name]": meta.last_name ?? "",
        "metadata[email_updates]": meta.email_updates ?? "no",
        "metadata[heard_about]": meta.heard_about ?? "",
    });

    if (!meta.member_code || !meta.eventbrite_discount_id) {
        const code = meta.member_code || (await memberCodeFor(subscription.id, env.MEMBER_CODE_SECRET));
        const discountId = await createMemberDiscount(env, { code, amountOff: discountEur(env), endDate: codeEndDate(subscription, env) });
        subscription = await saveOnSubscription(env, subscription.id, { member_code: code, eventbrite_discount_id: discountId });
    }

    if (!subscription.metadata.welcome_email_sent_at) {
        const to = session.customer_details?.email || customer.email;
        if (!to) throw new Error("no email address for the welcome email");
        await sendWelcome(env, subscription, to);
        await saveOnSubscription(env, subscription.id, { welcome_email_sent_at: now.toISOString() });
    }
    return "joined";
}

/** invoice.paid: a renewal (or tier change) moves the code's end date to the new period end. */
export async function membershipRenewed(env, invoice) {
    // The first invoice is handled by memberJoined, which makes the code.
    if (invoice.billing_reason === "subscription_create") return "ignored";
    const id = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
    if (typeof id !== "string") return "ignored";
    const subscription = await getSubscription(env, id);
    if (subscription.metadata?.source !== SOURCE || !LIVE.has(subscription.status)) return "ignored";
    // No code yet: memberJoined (or its retry) makes it with the current period end.
    if (!subscription.metadata.eventbrite_discount_id) return "no code yet";
    await setMemberDiscountEnd(env, subscription.metadata.eventbrite_discount_id, codeEndDate(subscription, env));
    return "extended";
}

/** customer.subscription.deleted: the membership has ended, so the code goes. */
export async function membershipEnded(env, subscription, now = new Date()) {
    if (subscription.metadata?.source !== SOURCE || !subscription.metadata.eventbrite_discount_id) return "ignored";
    return removeMemberDiscount(env, subscription.metadata.eventbrite_discount_id, now);
}

/**
 * "Lost your code?": re-sends the welcome email for each live membership
 * under this email address. Says nothing to the caller either way.
 */
export async function resendMemberCodes(env, email, now = new Date()) {
    const customers = (await stripe(env, "GET", "/v1/customers", { email, limit: "10" })).data ?? [];
    let sent = 0;
    for (const customer of customers) {
        const subscriptions = (await stripe(env, "GET", "/v1/subscriptions", { customer: customer.id, status: "all", limit: "10" })).data ?? [];
        for (const subscription of subscriptions) {
            const meta = subscription.metadata ?? {};
            if (meta.source !== SOURCE || !LIVE.has(subscription.status) || !meta.member_code) continue;
            if (now.getTime() - Date.parse(meta.welcome_email_sent_at ?? "") < RESEND_INTERVAL_MS) continue;
            await sendWelcome(env, subscription, customer.email || email);
            await saveOnSubscription(env, subscription.id, { welcome_email_sent_at: now.toISOString() });
            sent++;
        }
    }
    return sent;
}
