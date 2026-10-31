/**
 * The welcome email with the member's code, sent through Brevo when someone
 * joins and again from "Lost your code?".
 *
 * Variables: BREVO_API_KEY (secret), EMAIL_FROM (e.g.
 * "Cork Vegans <members@corkvegans.ie>", on a domain verified in Brevo),
 * EMAIL_REPLY_TO (default crkvgns@gmail.com), STRIPE_PORTAL_URL (the
 * customer portal login link), MEMBER_DISCOUNT_EUR (default 5).
 */

export const SITE_URL = "https://corkvegans.ie";
export const EVENTBRITE_URL = "https://www.eventbrite.ie/o/cork-vegans-91797524863";
export const CONTACT_EMAIL = "crkvgns@gmail.com";

const PER = { month: "a month", year: "a year" };

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** What the member pays, from their subscription's current price (it changes if they switch tier). */
export function membershipPrice(subscription) {
    const price = subscription.items?.data?.[0]?.price ?? {};
    const interval = price.recurring?.interval;
    if (!Number.isInteger(price.unit_amount) || !PER[interval]) return null;
    return { amount: price.unit_amount / 100, interval, custom: !price.lookup_key };
}

/**
 * @param {{ firstName?: string, code: string, price: ReturnType<typeof membershipPrice>, discountEur: number, portalUrl?: string, cardToken?: string }} details
 * @returns {{ subject: string, text: string, html: string }}
 */
export function welcomeEmail({ firstName, code, price, discountEur, portalUrl, cardToken }) {
    const hello = firstName ? `Hi ${firstName},` : "Hi there,";
    // In the #fragment, so the token never reaches a server log.
    const cardLink = cardToken ? `${SITE_URL}/membership/card/#${cardToken}` : "";
    const cardText = "Your membership card: open it on your phone to show you're a member, for example at our partner businesses.";
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
        ...(cardLink ? [`${cardText} ${cardLink}`, ""] : []),
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

    const p = (html) => `<p style="margin:0 0 16px">${html}</p>`;
    const link = (href, label) => `<a href="${escape(href)}" style="color:#275d49;font-weight:bold">${escape(label)}</a>`;
    const html = `<!doctype html>
<html lang="en-IE">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Welcome to Cork Vegans</title></head>
<body style="margin:0;padding:0;background:#fff8f3">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1d1b1c">
${p(escape(hello))}
${p("Welcome to Cork Vegans, and thank you for joining!")}
<div style="margin:0 0 24px;padding:16px;border-radius:12px;background:#d6f0e1;text-align:center">
<p style="margin:0 0 4px;font-size:14px">Your member code</p>
<p style="margin:0;font-size:32px;font-weight:bold;letter-spacing:4px;font-family:'Courier New',monospace">${escape(code)}</p>
</div>
<h2 style="margin:0 0 8px;font-size:18px">How to use your code</h2>
<ul style="margin:0 0 16px;padding-left:20px">${uses.map((u) => `<li style="margin:0 0 8px">${escape(u)}</li>`).join("")}</ul>
${p(`${link(eventsLink, "Book with your member discount")}: your code is added for you on our events page.`)}
${p(`All our events are also on ${link(EVENTBRITE_URL, "Eventbrite")}.`)}
${cardLink ? `<h2 style="margin:0 0 8px;font-size:18px">Your membership card</h2>
${p("Open it on your phone to show you're a member, for example at our partner businesses. It shows this month and a QR code they can scan to check it. Tip: add it to your home screen.")}
${p(link(cardLink, "Open your membership card"))}` : ""}
<h2 style="margin:0 0 8px;font-size:18px">Your membership</h2>
${paying ? p(escape(paying)) : ""}
${portalUrl ? p(`${link(portalUrl, "Manage or cancel your membership")}. ${escape(changing)}`) : ""}
${p(link(termsLink, "Membership terms"))}
${p("Any questions? Just reply to this email.")}
${p("See you soon,<br>Cork Vegans")}
</div>
</body>
</html>`;

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
