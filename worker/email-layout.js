/**
 * The Cork Vegans look for emails: logo, Karla, the site's colours
 * (tailwind.config.mjs), rounded cards and pill buttons.
 *
 * Built with tables and inline styles, which is what Gmail, Outlook and Apple
 * Mail all lay out the same way. Karla loads where the mail app allows web
 * fonts (Apple Mail, iOS); elsewhere a similar system font is used. Images
 * are PNGs on corkvegans.ie (scripts/build-email-images.ts), because Gmail
 * doesn't show SVG.
 */

import { SITE_URL } from "./site.js";

export const BRAND = {
    primary: "#275d49",
    onPrimary: "#ffffff",
    primaryFixed: "#b6efd4",
    onPrimaryFixed: "#002115",
    background: "#f9f9f9",
    card: "#ffffff",
    text: "#1c1c1c",
    muted: "#404944",
    outline: "#c0c9c2",
};
export const FONT = "Karla, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** A paragraph of already-escaped HTML. */
export const p = (html, style = "") => `<p style="margin:0 0 16px;${style}">${html}</p>`;

export const h2 = (text) => `<h2 style="margin:24px 0 8px;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${BRAND.text}">${escape(text)}</h2>`;

export const link = (href, label) => `<a href="${escape(href)}" style="color:${BRAND.primary};font-weight:700;text-decoration:underline">${escape(label)}</a>`;

/** A pill button, like the site's: filled green, or outlined for a second choice. */
export function button(href, label, { outlined = false } = {}) {
    const colours = outlined ? `background:${BRAND.card};color:${BRAND.primary};border:2px solid ${BRAND.primary}` : `background:${BRAND.primary};color:${BRAND.onPrimary};border:2px solid ${BRAND.primary}`;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px"><tr><td style="border-radius:9999px;${colours.split(";")[0]}">
<a href="${escape(href)}" style="display:inline-block;padding:12px 24px;border-radius:9999px;${colours};font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;text-decoration:none">${escape(label)}</a>
</td></tr></table>`;
}

/**
 * The whole email: logo on the page colour, the content in a white card,
 * then a short footer. `body` is already-escaped HTML; `preheader` is the
 * preview line mail apps show next to the subject.
 */
export function emailPage({ title, preheader, body, footer }) {
    return `<!doctype html>
<html lang="en-IE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Karla:wght@400;700&display=swap" rel="stylesheet">
<style>
body, table, td, p, a, li, h1, h2 { font-family: ${FONT}; }
@media (max-width: 600px) { .cv-card { padding: 24px 20px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.background};color:${BRAND.text}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.background}">
<tr><td align="center" style="padding:24px 12px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td align="center" style="padding:0 0 20px">
<a href="${SITE_URL}/"><img src="${SITE_URL}/images/logo.png" width="112" height="80" alt="Cork Vegans" style="display:block;width:112px;height:auto;border:0"></a>
</td></tr>
<tr><td class="cv-card" style="background:${BRAND.card};border-radius:24px;padding:32px;font-family:${FONT};font-size:16px;line-height:24px;color:${BRAND.text}">
${body}
</td></tr>
<tr><td align="center" style="padding:24px 16px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.muted}">
${footer ?? ""}${footer ? "<br>" : ""}<a href="${SITE_URL}/" style="color:${BRAND.muted};text-decoration:underline">corkvegans.ie</a> · Cork Vegans, a community group in Cork, Ireland
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
