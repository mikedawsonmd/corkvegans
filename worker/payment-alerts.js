/**
 * Weekly failed-payment alert, run by the Monday cron (wrangler.toml).
 *
 * Emails the organisers (EMAIL_REPLY_TO, default crkvgns@gmail.com) a list of
 * memberships whose renewal payment is failing (Stripe is still retrying, so
 * the subscription is past due) and those Stripe cancelled in the last week
 * because every retry failed. Nothing is sent when there are none.
 *
 * Members are already emailed by Stripe about a failed card, so this is only
 * for the organisers to follow up personally if they want to. The email holds
 * each member's name, amount and a Stripe link, not their email address.
 */

import { stripe } from "./http.js";
import { SOURCE } from "./members.js";
import { CONTACT_EMAIL, PER, escape, membershipPrice, sendEmail } from "./welcome-email.js";

const WEEK_MS = 7 * 86_400_000;
const LIMIT = 100;

async function search(env, query) {
    const found = await stripe(env, "GET", "/v1/subscriptions/search", { query: `${query} AND metadata['source']:'${SOURCE}'`, limit: String(LIMIT) });
    return found.data ?? [];
}

const dublinDate = (seconds) =>
    new Date(seconds * 1000).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });

function describe(subscription) {
    const meta = subscription.metadata ?? {};
    const name = [meta.first_name, meta.last_name].filter(Boolean).join(" ") || "(no name)";
    const price = membershipPrice(subscription);
    const amount = price ? `€${price.amount} ${PER[price.interval]}` : "unknown amount";
    const link = `https://dashboard.stripe.com/${subscription.livemode === false ? "test/" : ""}subscriptions/${subscription.id}`;
    return { name, amount, link };
}

/** The alert email; exported for the tests. */
export function paymentAlertEmail(failing, ended) {
    const rows = (list, note) =>
        list.map((s) => {
            const { name, amount, link } = describe(s);
            return { text: `- ${name}, ${amount} (${note(s)}): ${link}`, html: `<li>${escape(name)}, ${escape(amount)} (${escape(note(s))}): <a href="${link}">open in Stripe</a></li>` };
        });
    const failingRows = rows(failing, () => "Stripe is retrying the payment");
    const endedRows = rows(ended, (s) => `ended ${dublinDate(s.ended_at)}`);
    const total = failing.length + ended.length;
    const subject = `Cork Vegans: ${total} membership payment${total === 1 ? "" : "s"} failed`;
    const sections = [
        failing.length && { title: "Payment failing, membership still active while Stripe retries:", rows: failingRows },
        ended.length && { title: "Membership ended this week because every payment retry failed:", rows: endedRows },
    ].filter(Boolean);
    const footer = "Stripe has emailed each member about their card. Their code stays valid while Stripe retries, and is removed when the membership ends.";
    return {
        subject,
        text: [...sections.flatMap((s) => [s.title, ...s.rows.map((r) => r.text), ""]), footer].join("\n"),
        html: [...sections.map((s) => `<p>${escape(s.title)}</p><ul>${s.rows.map((r) => r.html).join("")}</ul>`), `<p>${escape(footer)}</p>`].join(""),
    };
}

/** Sends the weekly alert if any payments are failing or failed. Returns how many memberships it listed ("skipped" while payments are off). */
export async function sendPaymentAlert(env, now = new Date()) {
    if (env.PAYMENTS_ENABLED !== "true" || !env.STRIPE_SECRET_KEY) return "skipped";
    const failing = await search(env, "status:'past_due'");
    const since = (now.getTime() - WEEK_MS) / 1000;
    const ended = (await search(env, "status:'canceled'")).filter(
        (s) => s.cancellation_details?.reason === "payment_failed" && Number(s.ended_at) >= since,
    );
    if (!failing.length && !ended.length) return 0;
    await sendEmail(env, env.EMAIL_REPLY_TO || CONTACT_EMAIL, paymentAlertEmail(failing, ended));
    return failing.length + ended.length;
}
