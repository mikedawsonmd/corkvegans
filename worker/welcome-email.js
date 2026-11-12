/**
 * The welcome email with the member's code, sent through Brevo when someone
 * joins and again from "Lost your code?".
 *
 * Variables: BREVO_API_KEY (secret), EMAIL_FROM (e.g.
 * "Cork Vegans <members@corkvegans.ie>", on a domain verified in Brevo),
 * EMAIL_REPLY_TO (default crkvgns@gmail.com), STRIPE_PORTAL_URL (the
 * customer portal login link), MEMBER_DISCOUNT_EUR (default 5).
 * The look comes from email-layout.js.
 */

import { cardLink as cardLinkFor, walletLink as walletLinkFor } from "./card.js";
import { BRAND, FONT, button, emailPage, escape, h2, link, p } from "./email-layout.js";
import { CONTACT_EMAIL, EVENTBRITE_URL, SITE_URL } from "./site.js";

export { CONTACT_EMAIL, EVENTBRITE_URL, SITE_URL, escape };

export const PER = { month: "a month", year: "a year" };

/** What the member pays, from their subscription's current price (it changes if they switch tier). */
export function membershipPrice(subscription) {
    const price = subscription.items?.data?.[0]?.price ?? {};
    const interval = price.recurring?.interval;
    if (!Number.isInteger(price.unit_amount) || !PER[interval]) return null;
    return { amount: price.unit_amount / 100, interval, custom: !price.lookup_key };
}

/**
 * @param {{ firstName?: string, code: string, price: ReturnType<typeof membershipPrice>, discountEur: number, portalUrl?: string, cardToken?: string, googleWallet?: boolean }} details
 * @returns {{ subject: string, text: string, html: string }}
 */
export function welcomeEmail({ firstName, code, price, discountEur, portalUrl, cardToken, googleWallet = false }) {
    const hello = firstName ? `Hi ${firstName},` : "Hi there,";
    // In the #fragment, so the token never reaches a server log.
    const cardLink = cardToken ? cardLinkFor(SITE_URL, cardToken, code) : "";
    const cardText = "Your membership card: open it on your phone to show you're a member, for example at our partner businesses.";
    const walletText = cardToken && googleWallet ? `Add it to Google Wallet (Android phones): ${walletLinkFor(SITE_URL, cardToken, code)}` : "";
    const eventsLink = `${SITE_URL}/events/?member=${encodeURIComponent(code)}`;
    const termsLink = `${SITE_URL}/membership-terms/`;
    const paying = price ? `You're paying €${Number.isInteger(price.amount) ? price.amount : price.amount.toFixed(2)} ${PER[price.interval]}. Every member gets the same benefits, whatever they pay.` : "";
    // The portal only offers the monthly set amounts: switching from yearly to
    // monthly there would charge at once and drop the rest of the paid year.
    const changing =
        price && !price.custom && price.interval === "month"
            ? "You can switch between €5, €10 and €15 a month in the portal any time; the new amount starts from your next payment."
            : "To change your amount, cancel in the portal and join again at the new amount when your current membership ends, or reply to this email and we'll help.";
    const uses = [
        `€${discountEur} off one ticket for each paid Cork Vegans event (subject to availability). Enter your code at checkout on Eventbrite.`,
        "Early booking: your code unlocks member tickets before general release.",
        "Member events: book them on Eventbrite with the same code.",
    ];

    const text = [
        hello,
        "",
        "Welcome to Cork Vegans, and thank you for joining!",
        "",
        `Your member code: ${code}`,
        "",
        "How to use your code",
        ...uses.map((u) => `- ${u}`),
        "",
        `Book from our events page and your code is added for you: ${eventsLink}`,
        `All our events on Eventbrite: ${EVENTBRITE_URL}`,
        "",
        ...(cardLink ? [`${cardText} ${cardLink}`, ...(walletText ? [walletText] : []), ""] : []),
        "Your membership",
        ...(paying ? [paying] : []),
        ...(portalUrl ? [`Manage or cancel your membership: ${portalUrl}`, changing] : []),
        `Membership terms: ${termsLink}`,
        "",
        "Any questions? Just reply to this email.",
        "",
        "See you soon,",
        "Cork Vegans",
    ].join("\n");

    // The pig and chicken stand on the top edge of the code box, like the animals on the site.
    const codeBox = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">
<tr><td align="right" style="padding:0 24px;line-height:0;font-size:0"><img src="${SITE_URL}/images/email/animals-pig-chicken.png" width="135" height="64" alt="" style="display:inline-block;width:135px;height:64px;border:0"></td></tr>
<tr><td align="center" style="background:${BRAND.primaryFixed};border-radius:24px;padding:20px 16px;color:${BRAND.onPrimaryFixed}">
<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Your member code</p>
<p style="margin:0;font-family:${FONT};font-size:36px;line-height:44px;font-weight:700;letter-spacing:4px">${escape(code)}</p>
</td></tr>
</table>`;
    const walletLink = cardToken && googleWallet ? walletLinkFor(SITE_URL, cardToken, code) : "";
    const walletBadge = walletLink
        ? `<a href="${escape(walletLink)}" style="display:inline-block;margin:4px 0 8px"><img src="${SITE_URL}/images/email/add-to-google-wallet.png" width="226" height="40" alt="Add to Google Wallet" style="display:block;width:226px;height:40px;border:0"></a>
${p("On an Android phone. On an iPhone, open your card and add it to your home screen instead.", `font-size:14px;line-height:20px;color:${BRAND.muted}`)}`
        : "";
    const body = `${p(`<span style="font-size:24px;line-height:32px;font-weight:700">${escape(hello)}</span>`)}
${p("Welcome to Cork Vegans, and thank you for joining!")}
${codeBox}
${h2("How to use your code")}
<ul style="margin:0 0 16px;padding-left:20px">${uses.map((u) => `<li style="margin:0 0 8px">${escape(u)}</li>`).join("")}</ul>
${button(eventsLink, "Book with your member discount")}
${p(`Your code is added for you on our events page. All our events are also on ${link(EVENTBRITE_URL, "Eventbrite")}.`)}
${
    cardLink
        ? `${h2("Your membership card")}
${p(`Open it on your phone to show you're a member, for example at our partner businesses. It shows this month and a QR code they can scan to check it.${googleWallet ? "" : " Tip: add it to your home screen."}`)}
${button(cardLink, "Open your membership card", { outlined: true })}
${walletBadge}`
        : ""
}
${h2("Your membership")}
${paying ? p(escape(paying)) : ""}
${portalUrl ? p(`${link(portalUrl, "Manage or cancel your membership")}. ${escape(changing)}`) : ""}
${p(link(termsLink, "Membership terms"))}
${p("Any questions? Just reply to this email.")}
${p("See you soon,<br>Cork Vegans", "margin:0")}`;
    const html = emailPage({ title: "Welcome to Cork Vegans", preheader: `Your member code is ${code}. Here's how to use it.`, body, footer: "You're getting this because you joined Cork Vegans." });

    return { subject: "Welcome to Cork Vegans! Here's your member code", text, html };
}

/** "Cork Vegans <members@corkvegans.ie>" or a bare address, as Brevo's { name, email }. */
export function parseSender(from) {
    const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
    return match ? { ...(match[1] ? { name: match[1] } : {}), email: match[2].trim() } : { email: from.trim() };
}

/**
 * Sends through Brevo. Brevo has no idempotency keys, so a webhook retried
 * after a send but before welcome_email_sent_at was saved (members.js) could
 * send a second copy; that's rare and harmless.
 */
export async function sendEmail(env, to, { subject, text, html }) {
    if (!env.BREVO_API_KEY || !env.EMAIL_FROM) throw new Error("BREVO_API_KEY or EMAIL_FROM is not set");
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            sender: parseSender(env.EMAIL_FROM),
            to: [{ email: to }],
            replyTo: { email: env.EMAIL_REPLY_TO || CONTACT_EMAIL },
            subject,
            textContent: text,
            htmlContent: html,
            tags: ["membership"],
        }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(`Brevo responded ${res.status}${typeof data?.code === "string" ? ` ${data.code}` : ""}`);
    }
}

/**
 * Brevo deletes an API key after 90 days without use, which would quietly
 * stop welcome emails after a spell with no new members. The weekly cron in
 * wrangler.toml makes this one read-only call so the key is never idle. A
 * failure shows as a failed cron run in the Worker's logs.
 */
export async function keepBrevoKeyAlive(env) {
    if (!env.BREVO_API_KEY) return "skipped";
    const res = await fetch("https://api.brevo.com/v3/smtp/statistics/aggregatedReport", {
        headers: { "api-key": env.BREVO_API_KEY, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Brevo key check responded ${res.status}`);
    return "ok";
}
