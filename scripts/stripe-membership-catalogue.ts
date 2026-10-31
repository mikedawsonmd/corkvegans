/**
 * One-off: creates the membership products and prices in Stripe. Run it once
 * in test mode and once in live mode. It's safe to run again: anything that
 * already exists is left alone.
 *
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-membership-catalogue.ts
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-membership-catalogue.ts
 *
 * Each preset amount gets its own product with one price, because Stripe's
 * customer portal only lets members switch between products that have one
 * price per billing period. Amounts members choose themselves go on a
 * separate product (the Worker creates those prices at checkout).
 *
 * An older catalogue had all five prices on one product. Running this moves
 * each lookup key to the new price and archives the old one; subscriptions
 * on old prices carry on as they are.
 *
 * The key needs Products: Write and Prices: Write. Type it in the terminal
 * only; it isn't saved anywhere. See docs/ADMIN-GUIDE.md, "Membership".
 */

import { fileURLToPath } from "node:url";
import { PRESETS, type Frequency } from "../src/lib/membership.ts";

const STRIPE_API_VERSION = "2026-09-30.endive"; // as in worker/http.js
export const PRODUCT_NAME = "Cork Vegans membership";
/** Keep in step with CUSTOM_PRODUCT_ID in worker/membership.js (a unit test checks). */
export const CUSTOM_PRODUCT_ID = "cv_membership_custom";
const INTERVAL: Record<Frequency, "month" | "year"> = { monthly: "month", yearly: "year" };
const PER: Record<Frequency, string> = { monthly: "a month", yearly: "a year" };

export const presetPrices = () =>
    (Object.keys(PRESETS) as Frequency[]).flatMap((frequency) =>
        PRESETS[frequency].map((amount) => ({
            lookupKey: `membership_${frequency}_${amount}`,
            productId: `cv_membership_${frequency}_${amount}`,
            productName: `${PRODUCT_NAME}: €${amount} ${PER[frequency]}`,
            amount,
            interval: INTERVAL[frequency],
            nickname: `€${amount} ${PER[frequency]}`,
        })),
    );

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function setUpCatalogue(key: string, fetchImpl: FetchLike = fetch, print: (line: string) => void = console.log) {
    async function call(method: "GET" | "POST", path: string, params: Record<string, string> = {}, { missingOk = false } = {}) {
        const query = new URLSearchParams(params);
        const res = await fetchImpl(`https://api.stripe.com${path}${method === "GET" ? `?${query}` : ""}`, {
            method,
            headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
            body: method === "POST" ? query : undefined,
        });
        const data = await res.json();
        if (missingOk && res.status === 404) return null;
        if (!res.ok) throw new Error(`Stripe ${method} ${path} responded ${res.status}: ${data?.error?.message ?? "unknown error"}`);
        return data;
    }

    async function ensureProduct(id: string, name: string) {
        const found = await call("GET", `/v1/products/${id}`, {}, { missingOk: true });
        if (!found) {
            await call("POST", "/v1/products", { id, name, "metadata[corkvegans]": "membership" });
            print(`Product "${name}" (${id}): created`);
        } else if (!found.active) {
            await call("POST", `/v1/products/${id}`, { active: "true" });
            print(`Product "${name}" (${id}): reactivated`);
        } else {
            print(`Product "${name}" (${id}): already exists`);
        }
    }

    const wanted = presetPrices();
    const existing = new Map<string, { id: string; product: string }>();
    const query: Record<string, string> = { active: "true", limit: "10" };
    wanted.forEach((p, i) => (query[`lookup_keys[${i}]`] = p.lookupKey));
    for (const price of (await call("GET", "/v1/prices", query)).data) existing.set(price.lookup_key, price);

    await ensureProduct(CUSTOM_PRODUCT_ID, PRODUCT_NAME);
    for (const p of wanted) {
        await ensureProduct(p.productId, p.productName);
        const found = existing.get(p.lookupKey);
        if (found?.product === p.productId) {
            print(`  ${p.lookupKey}: already exists (${found.id})`);
            continue;
        }
        const price = await call("POST", "/v1/prices", {
            product: p.productId,
            currency: "eur",
            unit_amount: String(p.amount * 100),
            "recurring[interval]": p.interval,
            lookup_key: p.lookupKey,
            nickname: p.nickname,
            ...(found ? { transfer_lookup_key: "true" } : {}),
        });
        if (found) {
            await call("POST", `/v1/prices/${found.id}`, { active: "false" });
            print(`  ${p.lookupKey}: created (${price.id}), replacing ${found.id} on ${found.product}, now archived`);
        } else {
            print(`  ${p.lookupKey}: created (${price.id})`);
        }
    }
    const replaced = [...new Set([...existing.values()].map((price) => price.product))].filter((id) => !wanted.some((p) => p.productId === id));
    for (const id of replaced) print(`\nThe old product ${id} is no longer used: archive it in the Dashboard once no subscriptions use its prices.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
    const mode = /^(sk|rk)_live_/.test(key) ? "LIVE" : /^(sk|rk)_test_/.test(key) ? "test" : "";
    if (!mode) {
        console.error("Set STRIPE_SECRET_KEY to a Stripe secret key (sk_test_… or sk_live_…) for this one command.");
        process.exitCode = 1;
    } else {
        console.log(`Stripe ${mode} mode\n`);
        setUpCatalogue(key).then(
            () => console.log("\nDone. Next: add the five preset products to the customer portal (docs/ADMIN-GUIDE.md, \"Membership\")."),
            (err) => {
                console.error(err instanceof Error ? err.message : String(err));
                process.exitCode = 1;
            },
        );
    }
}
