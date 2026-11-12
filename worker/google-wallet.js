/**
 * The membership card in Google Wallet. Each membership gets one Generic pass
 * object (id "<issuer>.<subscription ID>") showing the first name, the month
 * and year, and the same QR code as the web card, which opens the check page.
 *
 * - "Add to Google Wallet" on the card page: POST /membership/wallet/google
 *   { token } creates or refreshes the object and answers with the save link.
 *   The link's JWT names the object only by ID, so it stays well under
 *   Google's 1,800-character limit.
 * - Renewals, cancelling and the end of a membership update the pass from the
 *   Stripe webhook (members.js), and the pass also expires on its own a few
 *   days after the paid period ends, in case an update is missed.
 * - On the 1st to the 3rd of each month an hourly cron moves every pass on to
 *   the new month, a batch at a time: Stripe search finds the live
 *   memberships whose pass isn't updated for this month yet (metadata
 *   wallet_month), so a batch that fails is simply picked up by the next run.
 *
 * Variables: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_KEY (secret: the service
 * account's JSON key file, whole). Without them the route answers 404 and
 * nothing else happens. Setup: docs/ADMIN-GUIDE.md, "Membership".
 */

import { cardLink, cardTokenFor } from "./card.js";
import { StripeError, stripe } from "./http.js";
import { CODE_PATTERN, LIVE, codeEndDate } from "./members.js";
import { SITE_URL } from "./site.js";

const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const ZONE = "Europe/Dublin";
/** Passes moved on to the new month per cron run: 2 requests each, under the Workers free plan's 50 per run. */
export const REFRESH_BATCH = 20;
export const MONTHLY_CRON = "20 * 1-3 * *";

export class GoogleWalletError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

export const googleWalletEnabled = (env) => Boolean(env.GOOGLE_WALLET_ISSUER_ID && env.GOOGLE_WALLET_KEY);
/**
 * Whether emails offer "Add to Google Wallet". Until Google grants publishing
 * access only test accounts can save a pass, so this waits for
 * GOOGLE_WALLET_PUBLISHED = "true" (wrangler.toml), switched on together with
 * membership.googleWallet in src/config/site.ts.
 */
export const googleWalletInEmails = (env) => googleWalletEnabled(env) && env.GOOGLE_WALLET_PUBLISHED === "true";
export const passClassId = (env) => `${env.GOOGLE_WALLET_ISSUER_ID}.cork_vegans_membership`;
export const passObjectId = (env, subscriptionId) => `${env.GOOGLE_WALLET_ISSUER_ID}.${subscriptionId}`;

/** "2026-11" in Irish time. */
export const irishMonth = (date) => date.toLocaleDateString("en-CA", { timeZone: ZONE }).slice(0, 7);
const monthAndYear = (date) => date.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: ZONE });
const longDate = (seconds) => new Date(seconds * 1000).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: ZONE });
const text = (value) => ({ defaultValue: { language: "en", value } });

// ── Signing and access tokens ─────────────────────────────────────────────

const base64url = (input) => {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function serviceAccount(env) {
    let key;
    try {
        key = JSON.parse(env.GOOGLE_WALLET_KEY);
    } catch {
        throw new GoogleWalletError("GOOGLE_WALLET_KEY isn't a JSON key file");
    }
    if (typeof key?.client_email !== "string" || typeof key?.private_key !== "string") throw new GoogleWalletError("GOOGLE_WALLET_KEY has no client_email or private_key");
    return { email: key.client_email, privateKey: key.private_key };
}

const signingKeys = new Map();
async function signingKey(pem) {
    if (!signingKeys.has(pem)) {
        const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
        signingKeys.set(pem, await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]));
    }
    return signingKeys.get(pem);
}

/** An RS256 JWT signed with the service account's key. */
export async function signJwt(claims, privateKey) {
    const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(privateKey), new TextEncoder().encode(unsigned));
    return `${unsigned}.${base64url(signature)}`;
}

let cachedToken = null;
async function accessToken(env) {
    if (cachedToken && cachedToken.email === serviceAccount(env).email && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
    const { email, privateKey } = serviceAccount(env);
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signJwt({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }, privateKey);
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.access_token !== "string") throw new GoogleWalletError(`Google sign-in responded ${res.status}`, res.status);
    cachedToken = { email, value: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    return cachedToken.value;
}

/** The Wallet API. Errors carry only the status: never the key or the member's details. */
async function wallet(env, method, path, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await accessToken(env)}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new GoogleWalletError(`Google Wallet ${method} ${path.split("/")[1]} responded ${res.status}`, res.status);
    return data;
}

// ── The pass ──────────────────────────────────────────────────────────────

let classReady = false;
async function ensureClass(env) {
    if (classReady) return;
    try {
        await wallet(env, "GET", `/genericClass/${passClassId(env)}`);
    } catch (err) {
        if (!(err instanceof GoogleWalletError && err.status === 404)) throw err;
        await wallet(env, "POST", "/genericClass", { id: passClassId(env) });
    }
    classReady = true;
}

/** The pass for this membership as it should look now. */
export async function passObject(env, subscription, now = new Date()) {
    const token = await cardTokenFor(subscription.id, env.MEMBER_CODE_SECRET);
    const live = LIVE.has(subscription.status);
    const firstName = subscription.metadata?.first_name;
    const endsAt = subscription.cancel_at ?? (subscription.cancel_at_period_end ? subscription.items?.data?.[0]?.current_period_end : null);
    // In the pass's details (shown when the member taps it), not on the front a business sees.
    const code = live && CODE_PATTERN.test(subscription.metadata?.member_code ?? "") ? subscription.metadata.member_code : null;
    return {
        id: passObjectId(env, subscription.id),
        classId: passClassId(env),
        state: live ? "ACTIVE" : "EXPIRED",
        cardTitle: text("Cork Vegans"),
        subheader: text(firstName ? `${firstName} · Member` : "Member"),
        header: text(live ? monthAndYear(now) : "Membership ended"),
        hexBackgroundColor: "#275d49",
        logo: { sourceUri: { uri: `${SITE_URL}/images/wallet-logo.png` }, contentDescription: text("Cork Vegans logo") },
        barcode: { type: "QR_CODE", value: `${SITE_URL}/membership/check/#${token}`, alternateText: "Businesses: scan to check" },
        textModulesData: [
            { id: "status", header: "Membership", body: !live ? "Ended" : Number.isInteger(endsAt) ? `Ends ${longDate(endsAt)}` : "Active" },
            ...(code ? [{ id: "code", header: "Your member code (for Eventbrite)", body: code }] : []),
        ],
        linksModuleData: {
            uris: [
                ...(code ? [{ id: "book", uri: `${SITE_URL}/events/?member=${code}`, description: "Book events with your member discount" }] : []),
                { id: "card", uri: cardLink(SITE_URL, token, code), description: "Your card online" },
                { id: "partners", uri: `${SITE_URL}/membership/#partners`, description: "Member discounts" },
            ],
        },
        // Expires on its own soon after the paid period, should an update be missed.
        ...(live ? { validTimeInterval: { end: { date: codeEndDate(subscription, env).toISOString() } } } : {}),
    };
}

/** Creates the pass, or brings an existing one up to date. */
export async function savePass(env, subscription, now = new Date()) {
    const object = await passObject(env, subscription, now);
    try {
        await wallet(env, "PUT", `/genericObject/${object.id}`, object);
    } catch (err) {
        if (!(err instanceof GoogleWalletError && err.status === 404)) throw err;
        await ensureClass(env);
        await wallet(env, "POST", "/genericObject", object);
    }
    return object;
}

/** The "Add to Google Wallet" link for a saved pass. */
export async function saveLink(env, subscriptionId, origins) {
    const { email, privateKey } = serviceAccount(env);
    const jwt = await signJwt(
        { iss: email, aud: "google", typ: "savetowallet", iat: Math.floor(Date.now() / 1000), origins, payload: { genericObjects: [{ id: passObjectId(env, subscriptionId), classId: passClassId(env) }] } },
        privateKey,
    );
    return `https://pay.google.com/gp/v/save/${jwt}`;
}

const markSaved = (env, id, now) => stripe(env, "POST", `/v1/subscriptions/${id}`, { "metadata[google_wallet]": "yes", "metadata[wallet_month]": irishMonth(now) });

/** For "Add to Google Wallet": the pass made and the save link, for a live membership. */
export async function addToGoogleWallet(env, subscription, origin, now = new Date()) {
    await savePass(env, subscription, now);
    if (subscription.metadata?.google_wallet !== "yes" || subscription.metadata?.wallet_month !== irishMonth(now)) await markSaved(env, subscription.id, now);
    return saveLink(env, subscription.id, [...new Set([SITE_URL, origin].filter(Boolean))]);
}

/**
 * From the Stripe webhook: brings this member's pass up to date, if they
 * have one. Never fails the webhook: the monthly run and the pass's own
 * expiry date cover a missed update.
 */
export async function updateWalletPass(env, subscription, now = new Date()) {
    if (!googleWalletEnabled(env) || subscription.metadata?.google_wallet !== "yes") return "no pass";
    try {
        await savePass(env, subscription, now);
        return "updated";
    } catch (err) {
        console.error(`google wallet: could not update a pass (${err instanceof Error ? err.message : "unknown error"})`);
        return "failed";
    }
}

/** The monthly cron: moves up to REFRESH_BATCH passes on to this month. */
export async function refreshWalletPasses(env, now = new Date()) {
    if (!googleWalletEnabled(env)) return 0;
    const month = irishMonth(now);
    const found = await stripe(env, "GET", "/v1/subscriptions/search", {
        // Ended memberships were expired by the webhook (and expire on their own anyway).
        query: `metadata['google_wallet']:'yes' AND -metadata['wallet_month']:'${month}' AND -status:'canceled'`,
        limit: String(REFRESH_BATCH),
    });
    let done = 0;
    for (const subscription of found.data ?? []) {
        try {
            await savePass(env, subscription, now);
            await stripe(env, "POST", `/v1/subscriptions/${subscription.id}`, { "metadata[wallet_month]": month });
            done++;
        } catch (err) {
            const reason = err instanceof GoogleWalletError || err instanceof StripeError ? err.message : "unknown error";
            console.error(`google wallet: monthly update failed for a pass (${reason})`);
        }
    }
    return done;
}
