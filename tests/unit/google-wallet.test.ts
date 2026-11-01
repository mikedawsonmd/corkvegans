import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cardTokenFor } from "../../worker/card.js";
import { MONTHLY_CRON, REFRESH_BATCH, passObject, refreshWalletPasses, signJwt } from "../../worker/google-wallet.js";
import { handleMembership } from "../../worker/membership.js";
import { handleStripeEvent } from "../../worker/stripe-webhook.js";
import { fakeServices, subscription, workerEnv } from "./fake-membership-services.ts";

let publicKey: CryptoKey;
let env: Record<string, string>;

beforeAll(async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    publicKey = pair.publicKey;
    const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
    env = { ...workerEnv, GOOGLE_WALLET_ISSUER_ID: "3388000000001", GOOGLE_WALLET_KEY: JSON.stringify({ type: "service_account", client_email: "wallet@cork-vegans.iam.gserviceaccount.com", private_key: pem }) };
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());
async function verifies(jwt: string) {
    const [h, p, sig] = jwt.split(".");
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, Buffer.from(sig, "base64url"), new TextEncoder().encode(`${h}.${p}`));
}

function useServices(subs = [subscription({ id: "sub_1abcdefgh" })]) {
    const services = fakeServices({ subscriptions: subs });
    vi.stubGlobal("fetch", services.fetchImpl);
    return services;
}

const post = (path: string, body: unknown, ip = `198.51.100.${Math.floor(Math.random() * 200)}`) =>
    new Request(`https://membership.example.workers.dev${path}`, { method: "POST", headers: { Origin: "https://corkvegans.ie", "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });

// 15 November 2026, midday in Cork.
const NOV = new Date("2026-11-15T12:00:00Z");

describe("Google Wallet: the pass", () => {
    it("signs RS256 JWTs Google can check with the service account's public key", async () => {
        const jwt = await signJwt({ hello: "world" }, JSON.parse(env.GOOGLE_WALLET_KEY).private_key);
        expect(decode(jwt.split(".")[0])).toEqual({ alg: "RS256", typ: "JWT" });
        expect(await verifies(jwt)).toBe(true);
        expect(await verifies(jwt.slice(0, -2) + "xx")).toBe(false);
    });

    it("shows the first name, this month in large type and the same QR code as the web card", async () => {
        const pass = await passObject(env, subscription({ id: "sub_1abcdefgh" }), NOV);
        const token = await cardTokenFor("sub_1abcdefgh", workerEnv.MEMBER_CODE_SECRET);
        expect(pass).toMatchObject({
            id: "3388000000001.sub_1abcdefgh",
            classId: "3388000000001.cork_vegans_membership",
            state: "ACTIVE",
            cardTitle: { defaultValue: { value: "Cork Vegans" } },
            subheader: { defaultValue: { value: "Aoife · Member" } },
            header: { defaultValue: { value: "November 2026" } },
            barcode: { type: "QR_CODE", value: `https://corkvegans.ie/membership/check/#${token}` },
            textModulesData: [{ header: "Membership", body: "Active" }],
        });
        // Expires on its own 3 days after the paid period (1_800_000_000 is 15 January 2027).
        expect(pass.validTimeInterval).toEqual({ end: { date: "2027-01-18T08:00:00.000Z" } });
        expect(JSON.stringify(pass)).not.toMatch(/Murphy|CV-|example\.ie/);
    });

    it("keeps the member code and a booking link in the details, not on the front or in the QR code", async () => {
        const member = subscription({ id: "sub_1abcdefgh", metadata: { ...subscription().metadata, member_code: "CV-7K3P9Q" } });
        const pass = await passObject(env, member, NOV);
        const token = await cardTokenFor("sub_1abcdefgh", workerEnv.MEMBER_CODE_SECRET);
        expect(pass.textModulesData).toContainEqual({ id: "code", header: "Your member code (for Eventbrite)", body: "CV-7K3P9Q" });
        expect(pass.linksModuleData.uris).toEqual([
            { id: "book", uri: "https://corkvegans.ie/events/?member=CV-7K3P9Q", description: "Book events with your member discount" },
            { id: "card", uri: `https://corkvegans.ie/membership/card/#${token}/CV-7K3P9Q`, description: "Your card online" },
            { id: "partners", uri: "https://corkvegans.ie/membership/#partners", description: "Member discounts" },
        ]);
        expect(JSON.stringify([pass.header, pass.subheader, pass.cardTitle, pass.barcode])).not.toContain("CV-7K3P9Q");
        const ended = await passObject(env, { ...member, status: "canceled" }, NOV);
        expect(JSON.stringify(ended)).not.toContain("CV-7K3P9Q");
    });

    it("shows the end date once cancelled, and expires when the membership ends", async () => {
        const cancelled = { ...subscription({ id: "sub_1abcdefgh" }), cancel_at_period_end: true };
        expect((await passObject(env, cancelled as ReturnType<typeof subscription>, NOV)).textModulesData).toEqual([{ id: "status", header: "Membership", body: "Ends 15 January 2027" }]);
        const ended = await passObject(env, subscription({ id: "sub_1abcdefgh", status: "canceled" }), NOV);
        expect(ended).toMatchObject({ state: "EXPIRED", header: { defaultValue: { value: "Membership ended" } } });
        expect(ended.validTimeInterval).toBeUndefined();
    });
});

describe("Google Wallet: Add to Google Wallet", () => {
    it("answers 404 until the Worker has the Google Wallet settings", async () => {
        useServices();
        const token = await cardTokenFor("sub_1abcdefgh", workerEnv.MEMBER_CODE_SECRET);
        expect((await handleMembership(post("/membership/wallet/google", { token }), workerEnv))!.status).toBe(404);
    });

    it("creates the class and pass, remembers it on the subscription and returns a short save link", async () => {
        const services = useServices();
        const token = await cardTokenFor("sub_1abcdefgh", workerEnv.MEMBER_CODE_SECRET);
        const res = (await handleMembership(post("/membership/wallet/google", { token }), env))!;
        expect(res.status).toBe(200);
        const { saveUrl } = (await res.json()) as { saveUrl: string };
        expect(saveUrl).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\/[\w-]+\.[\w-]+\.[\w-]+$/);
        expect(saveUrl.length).toBeLessThan(1800);
        const jwt = saveUrl.split("/").pop()!;
        expect(await verifies(jwt)).toBe(true);
        expect(decode(jwt.split(".")[1])).toMatchObject({
            iss: "wallet@cork-vegans.iam.gserviceaccount.com",
            aud: "google",
            typ: "savetowallet",
            origins: ["https://corkvegans.ie"],
            payload: { genericObjects: [{ id: "3388000000001.sub_1abcdefgh", classId: "3388000000001.cork_vegans_membership" }] },
        });
        expect([...services.passClasses]).toEqual(["3388000000001.cork_vegans_membership"]);
        expect(services.passes.get("3388000000001.sub_1abcdefgh")).toMatchObject({ state: "ACTIVE" });
        expect(services.subscriptions.get("sub_1abcdefgh")!.metadata).toMatchObject({ google_wallet: "yes", wallet_month: expect.stringMatching(/^\d{4}-\d{2}$/) });

        // Adding again just refreshes the same pass.
        await handleMembership(post("/membership/wallet/google", { token }), env);
        expect(services.passes.size).toBe(1);
    });

    it("refuses ended memberships, fake tokens and bad requests, and hides Google's errors", async () => {
        useServices([subscription({ id: "sub_1abcdefgh", status: "canceled" })]);
        const token = await cardTokenFor("sub_1abcdefgh", workerEnv.MEMBER_CODE_SECRET);
        expect((await handleMembership(post("/membership/wallet/google", { token }), env))!.status).toBe(409);
        expect((await handleMembership(post("/membership/wallet/google", { token: token.slice(0, -1) + "A" }), env))!.status).toBe(404);
        expect((await handleMembership(post("/membership/wallet/google", { token, more: 1 }), env))!.status).toBe(400);

        useServices([subscription({ id: "sub_1abcdefgh" })]);
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = (await handleMembership(post("/membership/wallet/google", { token }), { ...env, GOOGLE_WALLET_KEY: "{not json" }))!;
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: "unavailable" });
        expect(String(errors.mock.calls)).not.toMatch(/PRIVATE KEY|sub_1abcdefgh/);
    });
});

describe("Google Wallet: keeping passes up to date", () => {
    const withPass = (overrides = {}) =>
        subscription({ id: "sub_1abcdefgh", ...overrides, metadata: { ...subscription().metadata, member_code: "CV-7K3P9Q", eventbrite_discount_id: "d1", google_wallet: "yes", wallet_month: "2026-10", ...(overrides as { metadata?: object }).metadata } });

    it("moves passes on to the new month in batches, only those not done yet and not ended", async () => {
        const subs = Array.from({ length: REFRESH_BATCH + 3 }, (_, i) => withPass({ id: `sub_1member${String(i).padStart(4, "0")}` }));
        subs.push(withPass({ id: "sub_1endedmember", status: "canceled" }));
        const services = useServices(subs);
        services.passClasses.add("3388000000001.cork_vegans_membership");

        expect(await refreshWalletPasses(env, NOV)).toBe(REFRESH_BATCH);
        expect(await refreshWalletPasses(env, NOV)).toBe(3);
        expect(await refreshWalletPasses(env, NOV)).toBe(0);
        expect(services.passes.size).toBe(REFRESH_BATCH + 3);
        for (const pass of services.passes.values()) expect(pass).toMatchObject({ header: { defaultValue: { value: "November 2026" } } });
        expect(services.subscriptions.get("sub_1endedmember")!.metadata.wallet_month).toBe("2026-10");
        // Within the free plan's 50 requests per run: one search, one sign-in, two per pass.
        expect(services.calls.length).toBeLessThanOrEqual(3 * (2 + 2 * REFRESH_BATCH));
    });

    it("runs from the Worker's monthly cron, and does nothing without the settings", async () => {
        const services = useServices([withPass()]);
        services.passClasses.add("3388000000001.cork_vegans_membership");
        const entry = (await import("../../worker/index.js")).default;
        const waits: Promise<unknown>[] = [];
        await entry.scheduled({ cron: MONTHLY_CRON }, env, { waitUntil: (p: Promise<unknown>) => waits.push(p) });
        expect(await Promise.all(waits)).toEqual([1]);
        expect(await refreshWalletPasses(workerEnv, NOV)).toBe(0);
    });

    it("updates the pass when a member cancels, renews or their membership ends, without failing the webhook", async () => {
        const services = useServices([withPass({ cancel_at_period_end: true })]);
        services.passClasses.add("3388000000001.cork_vegans_membership");
        services.discounts.set("d1", { id: "d1", code: "CV-7K3P9Q", type: "access", amount_off: "5.00", ticket_group_id: "group-1", end_date: "2027-01-18T08:00:00" });
        const sub = services.subscriptions.get("sub_1abcdefgh")!;

        expect(await handleStripeEvent(env, { type: "customer.subscription.updated", data: { object: sub } }, NOV)).toBe("unchanged");
        expect(services.passes.get("3388000000001.sub_1abcdefgh")).toMatchObject({ textModulesData: [{ body: "Ends 15 January 2027" }, { id: "code", body: "CV-7K3P9Q" }] });

        await handleStripeEvent(env, { type: "invoice.paid", data: { object: { billing_reason: "subscription_cycle", parent: { subscription_details: { subscription: "sub_1abcdefgh" } } } } }, NOV);
        expect(services.passes.get("3388000000001.sub_1abcdefgh")).toMatchObject({ state: "ACTIVE" });

        await handleStripeEvent(env, { type: "customer.subscription.deleted", data: { object: { ...sub, status: "canceled" } } }, NOV);
        expect(services.passes.get("3388000000001.sub_1abcdefgh")).toMatchObject({ state: "EXPIRED" });

        // Google down: the webhook still succeeds; the pass expires on its own.
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await handleStripeEvent({ ...env, GOOGLE_WALLET_KEY: "{bad" }, { type: "customer.subscription.updated", data: { object: sub } }, NOV)).toBe("unchanged");
        expect(errors).toHaveBeenCalled();
    });

    it("leaves members without a pass alone", async () => {
        const services = useServices([subscription({ id: "sub_1abcdefgh" })]);
        await handleStripeEvent(env, { type: "customer.subscription.updated", data: { object: services.subscriptions.get("sub_1abcdefgh") } }, NOV);
        expect(services.calls.some((c) => c.url.includes("googleapis"))).toBe(false);
    });
});
