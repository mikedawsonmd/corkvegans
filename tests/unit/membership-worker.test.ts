import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_PRODUCT_ID, LIMITS, PRESETS, RATE_LIMIT, checkoutSessionParams, handleMembership, parseJoin } from "../../worker/membership.js";
import { fakeServices, subscription, workerEnv } from "./fake-membership-services.ts";
import { cardTokenFor } from "../../worker/card.js";

const ORIGIN = "https://corkvegans.ie";
let ipCounter = 0;

const details = { firstName: "Aoife", lastName: "Murphy", email: "Aoife@Example.ie", heardAbout: "A friend", updates: false, terms: true };
const join = (overrides: Record<string, unknown> = {}) => ({ frequency: "monthly", amount: 10, ...details, ...overrides });

function post(path: string, body: unknown, { origin = ORIGIN, ip = `203.0.113.${++ipCounter}`, contentType = "application/json" } = {}) {
    return new Request(`https://membership.example.workers.dev${path}`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": contentType, "CF-Connecting-IP": ip },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

const PRICES: Record<string, { id: string; product: string }> = {
    membership_monthly_5: { id: "price_m5", product: "cv_membership_monthly_5" },
    membership_monthly_10: { id: "price_m10", product: "cv_membership_monthly_10" },
    membership_monthly_15: { id: "price_m15", product: "cv_membership_monthly_15" },
    membership_yearly_50: { id: "price_y50", product: "cv_membership_yearly_50" },
    membership_yearly_100: { id: "price_y100", product: "cv_membership_yearly_100" },
};

/** Stripe for the join route: price lookups and session creation. */
function stubStripe(session: { status?: number; body: unknown } = { body: { client_secret: "cs_test_abc_secret_xyz" } }) {
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
        const url = new URL(input);
        if (url.pathname === "/v1/prices") {
            const price = PRICES[url.searchParams.get("lookup_keys[]") ?? ""];
            return new Response(JSON.stringify({ data: price ? [price] : [] }));
        }
        return new Response(JSON.stringify(session.body), { status: session.status ?? 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

const env = { STRIPE_SECRET_KEY: "rk_test_dummy", PAYMENTS_ENABLED: "true" };
const sessionCall = (mock: ReturnType<typeof stubStripe>) => mock.mock.calls.find(([url]) => String(url).endsWith("/v1/checkout/sessions"));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("membership Worker: routing and CORS", () => {
    it("entry point exports only handlers, as the Workers runtime requires", async () => {
        const entry = await import("../../worker/index.js");
        expect(Object.keys(entry)).toEqual(["default"]);
        expect((await entry.default.fetch(new Request("https://x.workers.dev/"), env, { waitUntil() {} })).status).toBe(404);
    });

    it("answers 410 Gone on the old route, whatever the method", async () => {
        for (const method of ["GET", "POST", "OPTIONS"]) {
            expect((await handleMembership(new Request("https://x.workers.dev/donate/session", { method }), env))!.status).toBe(410);
        }
    });

    it('answers 404 on /membership/ routes unless PAYMENTS_ENABLED is "true"', async () => {
        const fetchMock = stubStripe();
        for (const flag of [undefined, "", "false", "1", "TRUE"]) {
            const off = { STRIPE_SECRET_KEY: "rk_test_dummy", ...(flag === undefined ? {} : { PAYMENTS_ENABLED: flag }) };
            for (const path of ["/membership/session", "/membership/code", "/membership/resend"]) {
                expect((await handleMembership(post(path, join()), off))!.status).toBe(404);
            }
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ignores other paths so another Worker can share it", async () => {
        expect(await handleMembership(new Request("https://x.workers.dev/events"), env)).toBeNull();
    });

    it("answers preflight from corkvegans.ie and localhost only", async () => {
        for (const origin of [ORIGIN, "http://localhost:4321", "http://127.0.0.1:8787"]) {
            const res = (await handleMembership(new Request("https://x.workers.dev/membership/session", { method: "OPTIONS", headers: { Origin: origin } }), env))!;
            expect(res.status).toBe(204);
            expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
        }
        for (const origin of ["https://evil.example", "https://corkvegans.ie.evil.example", "http://localhost.evil.example"]) {
            const res = (await handleMembership(new Request("https://x.workers.dev/membership/session", { method: "OPTIONS", headers: { Origin: origin } }), env))!;
            expect(res.status).toBe(403);
            expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
        }
    });

    it("refuses POSTs from other origins and non-POST methods", async () => {
        const fetchMock = stubStripe();
        expect((await handleMembership(post("/membership/session", join(), { origin: "https://evil.example" }), env))!.status).toBe(403);
        expect((await handleMembership(new Request("https://x.workers.dev/membership/session", { headers: { Origin: ORIGIN } }), env))!.status).toBe(405);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("membership Worker: validation", () => {
    it.each([
        join({ amount: 2 }),
        join({ amount: 500 }),
        join({ frequency: "yearly", amount: 50 }),
        join({ frequency: "yearly", amount: 500 }),
        join({ heardAbout: undefined }),
        join({ heardAbout: "" }),
        join({ updates: true, turnstileToken: "token" }),
    ])("accepts %j", (body) => {
        expect(parseJoin(body)).not.toBeNull();
    });

    it("tidies the details: trims names, lower-cases the email and spots presets", () => {
        expect(parseJoin(join({ firstName: "  Aoife ", email: " AOIFE@example.IE " }))).toMatchObject({ firstName: "Aoife", email: "aoife@example.ie", preset: true });
        expect(parseJoin(join({ amount: 12 }))).toMatchObject({ preset: false });
    });

    it.each([
        join({ amount: 1 }),
        join({ amount: 501 }),
        join({ amount: 2.5 }),
        join({ amount: "10" }),
        join({ frequency: "yearly", amount: 49 }),
        join({ frequency: "yearly", amount: 501 }),
        join({ frequency: "once", amount: 10 }),
        join({ frequency: "__proto__" }),
        join({ terms: false }),
        join({ terms: "yes" }),
        join({ updates: "no" }),
        join({ firstName: "" }),
        join({ firstName: "x".repeat(61) }),
        join({ lastName: "Bad\u0000name" }),
        join({ email: "not-an-email" }),
        join({ email: "a@b" }),
        join({ heardAbout: "x".repeat(201) }),
        join({ currency: "usd" }),
        join({ turnstileToken: 5 }),
        { frequency: "monthly", amount: 10 },
        [],
        null,
        "monthly",
    ])("rejects %j with 400", async (body) => {
        const fetchMock = stubStripe();
        const res = (await handleMembership(post("/membership/session", body), env))!;
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid_request" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON, the wrong content type and oversized bodies", async () => {
        stubStripe();
        expect((await handleMembership(post("/membership/session", "{not json"), env))!.status).toBe(400);
        expect((await handleMembership(post("/membership/session", join(), { contentType: "text/plain" }), env))!.status).toBe(400);
        expect((await handleMembership(post("/membership/session", join({ turnstileToken: "x".repeat(5000) })), env))!.status).toBe(400);
    });

    it("keeps presets within the limits", () => {
        for (const frequency of ["monthly", "yearly"] as const) {
            for (const amount of PRESETS[frequency]) {
                expect(amount).toBeGreaterThanOrEqual(LIMITS[frequency].min);
                expect(amount).toBeLessThanOrEqual(LIMITS[frequency].max);
            }
        }
    });
});

describe("membership Worker: Stripe Checkout Session", () => {
    it("uses the preset's catalogue price, prefills the email and stores the details on the subscription", async () => {
        const fetchMock = stubStripe();
        const res = (await handleMembership(post("/membership/session", join({ updates: true })), env))!;
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ clientSecret: "cs_test_abc_secret_xyz" });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

        const lookup = new URL(String(fetchMock.mock.calls[0][0]));
        expect(lookup.searchParams.get("lookup_keys[]")).toBe("membership_monthly_10");
        const [url, init] = sessionCall(fetchMock)!;
        expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer rk_test_dummy", "Stripe-Version": "2026-09-30.endive" });
        const params = Object.fromEntries(init?.body as URLSearchParams);
        expect(params).toMatchObject({
            ui_mode: "embedded_page",
            redirect_on_completion: "never",
            mode: "subscription",
            customer_email: "aoife@example.ie",
            "line_items[0][price]": "price_m10",
            "line_items[0][quantity]": "1",
            "subscription_data[metadata][source]": "corkvegans.ie",
            "subscription_data[metadata][first_name]": "Aoife",
            "subscription_data[metadata][last_name]": "Murphy",
            "subscription_data[metadata][email_updates]": "yes",
            "subscription_data[metadata][heard_about]": "A friend",
            "subscription_data[metadata][plan]": "preset",
            "metadata[source]": "corkvegans.ie",
        });
        expect(params).not.toHaveProperty("line_items[0][price_data][unit_amount]");
        expect(JSON.stringify(params)).not.toMatch(/donat/i);
    });

    it("creates a custom amount under the custom-amount product, monthly or yearly", () => {
        const custom = (frequency: string, amount: number) => Object.fromEntries(checkoutSessionParams(parseJoin(join({ frequency, amount })), { priceId: undefined }));
        expect(custom("monthly", 12)).toMatchObject({
            "line_items[0][price_data][currency]": "eur",
            "line_items[0][price_data][product]": CUSTOM_PRODUCT_ID,
            "line_items[0][price_data][unit_amount]": "1200",
            "line_items[0][price_data][recurring][interval]": "month",
            "subscription_data[metadata][plan]": "custom",
        });
        expect(custom("yearly", 75)).toMatchObject({ "line_items[0][price_data][unit_amount]": "7500", "line_items[0][price_data][recurring][interval]": "year" });
        expect(custom("yearly", 75)).not.toHaveProperty("line_items[0][price_data][product_data][name]");
        expect(custom("yearly", 75)).not.toHaveProperty("line_items[0][price]");
    });

    it("doesn't look up a catalogue price for custom amounts", async () => {
        const fetchMock = stubStripe();
        await handleMembership(post("/membership/session", join({ frequency: "yearly", amount: 75 })), env);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/v1/checkout/sessions"]);
        expect(Object.fromEntries(sessionCall(fetchMock)![1]?.body as URLSearchParams)["line_items[0][price_data][product]"]).toBe("cv_membership_custom");
    });

    it("hides Stripe error details from the browser and never logs the key or the member's details", async () => {
        stubStripe({ status: 400, body: { error: { type: "invalid_request_error", code: "parameter_unknown", param: "customer_email", message: "aoife@example.ie is bad" } } });
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = (await handleMembership(post("/membership/session", join({ amount: 15 })), env))!;
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: "checkout_unavailable" });
        const logged = log.mock.calls.flat().join(" ");
        expect(logged).toContain("parameter_unknown");
        for (const secret of ["rk_test_dummy", "aoife", "Aoife", "Murphy"]) expect(logged).not.toContain(secret);
    });

    it("fails safely when the secret key is missing", async () => {
        const fetchMock = stubStripe();
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await handleMembership(post("/membership/session", join({ amount: 5 })), { PAYMENTS_ENABLED: "true" }))!.status).toBe(502);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("membership Worker: the new member's code", () => {
    const secret = "cs_test_abc_secret_xyz";

    function stubSession(session: Record<string, unknown>) {
        const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ id: "cs_test_abc", client_secret: secret, created: Math.floor(Date.now() / 1000) - 60, metadata: { source: "corkvegans.ie" }, ...session })));
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    const codeEnv = { ...env, MEMBER_CODE_SECRET: "member-code-secret" };

    it("returns the code and card token once the webhook has made the code", async () => {
        const fetchMock = stubSession({ status: "complete", subscription: { id: "sub_1abcdefgh", metadata: { member_code: "CV-7K3P9Q" } } });
        const res = (await handleMembership(post("/membership/code", { clientSecret: secret }), codeEnv))!;
        expect(await res.json()).toEqual({ status: "ready", code: "CV-7K3P9Q", cardToken: await cardTokenFor("sub_1abcdefgh", "member-code-secret") });
        expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_abc?expand%5B%5D=subscription");
    });

    it("accepts the long, %-encoded client secrets Stripe really sends", async () => {
        const real = `cs_test_a1B2c3D4e5_secret_fidnandhYHdWcXxpYCc${"%2FvYWJxbGlj".repeat(30)}`;
        stubSession({ client_secret: real, status: "complete", subscription: { id: "sub_1abcdefgh", metadata: { member_code: "CV-7K3P9Q" } } });
        expect(await (await handleMembership(post("/membership/code", { clientSecret: real }), codeEnv))!.json()).toMatchObject({ status: "ready", code: "CV-7K3P9Q" });
    });

    it("says pending until then", async () => {
        stubSession({ status: "complete", subscription: { metadata: {} } });
        expect(await (await handleMembership(post("/membership/code", { clientSecret: secret }), env))!.json()).toEqual({ status: "pending" });
        stubSession({ status: "open", subscription: null });
        expect(await (await handleMembership(post("/membership/code", { clientSecret: secret }), env))!.json()).toEqual({ status: "pending" });
    });

    it("refuses a wrong secret, an old session or someone else's checkout", async () => {
        stubSession({ status: "complete", client_secret: "cs_test_abc_secret_other", subscription: { metadata: { member_code: "CV-7K3P9Q" } } });
        expect((await handleMembership(post("/membership/code", { clientSecret: secret }), env))!.status).toBe(404);
        stubSession({ status: "complete", created: Math.floor(Date.now() / 1000) - 2 * 86_400, subscription: { metadata: { member_code: "CV-7K3P9Q" } } });
        expect((await handleMembership(post("/membership/code", { clientSecret: secret }), env))!.status).toBe(404);
        stubSession({ status: "complete", metadata: {}, subscription: { metadata: { member_code: "CV-7K3P9Q" } } });
        expect((await handleMembership(post("/membership/code", { clientSecret: secret }), env))!.status).toBe(404);
    });

    it.each([{ clientSecret: "cs_test_abc" }, { clientSecret: "../../v1/customers" }, { clientSecret: secret, extra: 1 }, {}])("rejects %j", async (body) => {
        const fetchMock = stubSession({});
        expect((await handleMembership(post("/membership/code", body), env))!.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("membership Worker: membership cards", () => {
    const secret = workerEnv.MEMBER_CODE_SECRET;
    const services = (subs: ReturnType<typeof subscription>[], fail?: RegExp) => {
        const s = fakeServices({ subscriptions: subs, fail });
        vi.stubGlobal("fetch", s.fetchImpl);
        return s;
    };
    const check = async (token: unknown, e: Record<string, unknown> = workerEnv) => {
        const res = (await handleMembership(post("/membership/card", { token }), e))!;
        return { status: res.status, body: await res.json(), headers: res.headers };
    };

    it("signs a token per membership that can't be altered or made up", async () => {
        const token = await cardTokenFor("sub_1abcdefgh", secret);
        expect(token).toMatch(/^sub_1abcdefgh\.[A-Za-z0-9_-]{22}$/);
        expect(await cardTokenFor("sub_1abcdefgh", secret)).toBe(token);
        expect(await cardTokenFor("sub_2abcdefgh", secret)).not.toBe(token.replace("sub_1", "sub_2"));
        expect(await cardTokenFor("sub_1abcdefgh", "another-secret")).not.toBe(token);
    });

    it("says valid with the first name only while the membership is live", async () => {
        services([subscription({ id: "sub_1abcdefgh" })]);
        const res = await check(await cardTokenFor("sub_1abcdefgh", secret));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: "valid", firstName: "Aoife" });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(JSON.stringify(res.body)).not.toMatch(/Murphy|CV-|example/);
    });

    it("gives the end date once a membership is cancelled, and says ended after", async () => {
        const cancelled = { ...subscription({ id: "sub_1abcdefgh" }), cancel_at_period_end: true };
        services([cancelled as ReturnType<typeof subscription>]);
        const token = await cardTokenFor("sub_1abcdefgh", secret);
        // 1_800_000_000 is 15 January 2027, 08:00 UTC.
        expect((await check(token)).body).toEqual({ status: "valid", firstName: "Aoife", endsOn: "2027-01-15" });
        services([subscription({ id: "sub_1abcdefgh", status: "canceled" })]);
        expect((await check(token)).body).toEqual({ status: "ended" });
    });

    it("answers 404 for altered, made-up or other people's tokens without asking Stripe for fakes", async () => {
        const s = services([subscription({ id: "sub_1abcdefgh", metadata: { source: "elsewhere" } })]);
        const token = await cardTokenFor("sub_1abcdefgh", secret);
        expect((await check(token)).status).toBe(404); // not a corkvegans.ie membership
        const callsBefore = s.calls.length;
        const altered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
        for (const fake of [altered, token.replace("sub_1", "sub_9"), await cardTokenFor("sub_1abcdefgh", "guess"), "sub_1abcdefgh", "CV-7K3P9Q"]) {
            expect((await check(fake)).status).toBe(404);
        }
        expect(s.calls.length).toBe(callsBefore);
        services([]);
        expect((await check(await cardTokenFor("sub_1gone12345", secret))).status).toBe(404);
    });

    it("rejects bad requests, hides Stripe errors and rate limits to 30 a minute per IP", async () => {
        services([subscription({ id: "sub_1abcdefgh" })]);
        expect((await check(42)).status).toBe(400);
        expect((await handleMembership(post("/membership/card", { token: "x", extra: 1 }), workerEnv))!.status).toBe(400);
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        services([subscription({ id: "sub_1abcdefgh" })], /api\.stripe\.com/);
        const failed = await check(await cardTokenFor("sub_1abcdefgh", secret));
        expect(failed).toMatchObject({ status: 502, body: { error: "unavailable" } });
        expect(String(errors.mock.calls)).not.toMatch(/sub_1abcdefgh|aoife/);
        const ip = "198.51.100.77";
        const statuses = [];
        for (let i = 0; i < 31; i++) statuses.push((await handleMembership(post("/membership/card", { token: "x" }, { ip }), workerEnv))!.status);
        expect(statuses.slice(0, 30).every((st) => st === 404)).toBe(true);
        expect(statuses[30]).toBe(429);
    });

    it("puts the card link in the welcome email, with the token after #", async () => {
        const member = subscription({ metadata: { ...subscription().metadata, member_code: "CV-7K3P9Q", eventbrite_discount_id: "d1", welcome_email_sent_at: "2026-01-01T00:00:00Z" } });
        const s = fakeServices({ subscriptions: [member] });
        vi.stubGlobal("fetch", s.fetchImpl);
        await handleMembership(post("/membership/resend", { email: "aoife@example.ie" }), workerEnv);
        const link = `https://corkvegans.ie/membership/card/#${await cardTokenFor("sub_1", secret)}`;
        expect(s.emails[0].text).toContain(link);
        expect(s.emails[0].html).toContain(`href="${link}"`);
    });
});

describe('membership Worker: "Lost your code?"', () => {
    function useServices(...args: Parameters<typeof fakeServices>) {
        const services = fakeServices(...args);
        vi.stubGlobal("fetch", services.fetchImpl);
        return services;
    }

    const member = subscription({ metadata: { ...subscription().metadata, member_code: "CV-7K3P9Q", eventbrite_discount_id: "d1", welcome_email_sent_at: "2026-01-01T00:00:00Z" } });

    it("re-sends the code to an active member, with the same neutral answer as for anyone else", async () => {
        const services = useServices({ subscriptions: [member] });
        const res = (await handleMembership(post("/membership/resend", { email: "AOIFE@example.ie" }), workerEnv))!;
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(services.emails).toHaveLength(1);
        expect(services.emails[0].to).toEqual(["aoife@example.ie"]);
        expect(services.emails[0].text).toContain("CV-7K3P9Q");

        const nobody = (await handleMembership(post("/membership/resend", { email: "someone@example.ie" }), workerEnv))!;
        expect(nobody.status).toBe(200);
        expect(await nobody.json()).toEqual({ ok: true });
        expect(services.emails).toHaveLength(1);
    });

    it("doesn't send for ended memberships, or twice within ten minutes", async () => {
        const services = useServices({ subscriptions: [{ ...member, status: "canceled" }] });
        await handleMembership(post("/membership/resend", { email: "aoife@example.ie" }), workerEnv);
        expect(services.emails).toHaveLength(0);

        const again = useServices({ subscriptions: [member] });
        await handleMembership(post("/membership/resend", { email: "aoife@example.ie" }), workerEnv);
        await handleMembership(post("/membership/resend", { email: "aoife@example.ie" }), workerEnv);
        expect(again.emails).toHaveLength(1);
    });

    it("answers straight away and sends afterwards when the runtime allows", async () => {
        const services = useServices({ subscriptions: [member] });
        const pending: Promise<unknown>[] = [];
        const res = (await handleMembership(post("/membership/resend", { email: "aoife@example.ie" }), workerEnv, { waitUntil: (p: Promise<unknown>) => pending.push(p) }))!;
        expect(res.status).toBe(200);
        expect(pending).toHaveLength(1);
        await Promise.all(pending);
        expect(services.emails).toHaveLength(1);
    });

    it("gives the same answer even if Stripe fails, and logs no email address", async () => {
        useServices({ fail: /api\.stripe\.com/ });
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = (await handleMembership(post("/membership/resend", { email: "aoife@example.ie" }), workerEnv))!;
        expect(await res.json()).toEqual({ ok: true });
        expect(log.mock.calls.flat().join(" ")).not.toContain("aoife");
    });

    it("rejects bad requests and rate limits to 3 a minute per IP", async () => {
        useServices();
        for (const body of [{ email: "nope" }, { email: "a@b.ie", extra: 1 }, {}, []]) {
            expect((await handleMembership(post("/membership/resend", body), workerEnv))!.status).toBe(400);
        }
        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await handleMembership(post("/membership/resend", { email: "a@b.ie" }, { ip: "198.51.100.30" }), workerEnv))!.status);
        expect(statuses).toEqual([200, 200, 200, 429]);
    });
});

describe("membership Worker: abuse protection", () => {
    it(`allows ${RATE_LIMIT} sessions per IP per minute without a rate limit binding`, async () => {
        stubStripe();
        const statuses = [];
        for (let i = 0; i <= RATE_LIMIT; i++) statuses.push((await handleMembership(post("/membership/session", join(), { ip: "198.51.100.7" }), env))!.status);
        expect(statuses.slice(0, RATE_LIMIT).every((s) => s === 200)).toBe(true);
        expect(statuses.at(-1)).toBe(429);
        expect((await handleMembership(post("/membership/session", join(), { ip: "198.51.100.8" }), env))!.status).toBe(200);
    });

    it("uses the Cloudflare rate limit bindings when present", async () => {
        stubStripe();
        const limit = vi.fn(async () => ({ success: false }));
        const res = (await handleMembership(post("/membership/session", join(), { ip: "192.0.2.1" }), { ...env, MEMBERSHIP_RATE_LIMITER: { limit } }))!;
        expect(res.status).toBe(429);
        expect(limit).toHaveBeenCalledWith({ key: "192.0.2.1" });
        const lookup = (await handleMembership(post("/membership/resend", { email: "a@b.ie" }, { ip: "192.0.2.1" }), { ...env, LOOKUP_RATE_LIMITER: { limit } }))!;
        expect(lookup.status).toBe(429);
    });

    it("checks Turnstile when its secret is set, on joining and on lost codes", async () => {
        const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("turnstile") ? { success: false } : { client_secret: "cs_test_secret_123" })));
        vi.stubGlobal("fetch", fetchMock);
        const withTurnstile = { ...env, TURNSTILE_SECRET_KEY: "turnstile-secret" };

        expect((await handleMembership(post("/membership/session", join()), withTurnstile))!.status).toBe(403);
        expect((await handleMembership(post("/membership/session", join({ turnstileToken: "bad" })), withTurnstile))!.status).toBe(403);
        expect((await handleMembership(post("/membership/resend", { email: "a@b.ie", turnstileToken: "bad" }), withTurnstile))!.status).toBe(403);
        expect(fetchMock.mock.calls.every(([url]) => String(url).includes("turnstile"))).toBe(true);
    });
});
