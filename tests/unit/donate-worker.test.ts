import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT, checkoutSessionParams, handleDonate, parseDonation } from "../../worker/donate.js";

const ORIGIN = "https://corkvegans.ie";
let ipCounter = 0;

function post(body: unknown, { origin = ORIGIN, ip = `203.0.113.${++ipCounter}`, contentType = "application/json" } = {}) {
    return new Request("https://donate.example.workers.dev/donate/session", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": contentType, "CF-Connecting-IP": ip },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

function stubStripe(response: { status?: number; body: unknown } = { body: { client_secret: "cs_test_secret_123" } }) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(response.body), { status: response.status ?? 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

const env = { STRIPE_SECRET_KEY: "rk_test_dummy", PAYMENTS_ENABLED: "true" };

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("donation Worker: routing and CORS", () => {
    it("entry point exports only handlers, as the Workers runtime requires", async () => {
        const entry = await import("../../worker/index.js");
        expect(Object.keys(entry)).toEqual(["default"]);
        expect(typeof entry.default.fetch).toBe("function");
        stubStripe();
        const res = await entry.default.fetch(new Request("https://x.workers.dev/"), env);
        expect(res.status).toBe(404);
    });

    it("answers 404 for /donate/session unless PAYMENTS_ENABLED is \"true\"", async () => {
        const fetchMock = stubStripe();
        for (const flag of [undefined, "", "false", "1", "TRUE"]) {
            const off = { STRIPE_SECRET_KEY: "rk_test_dummy", ...(flag === undefined ? {} : { PAYMENTS_ENABLED: flag }) };
            expect((await handleDonate(post({ frequency: "once", amount: 10 }), off))!.status).toBe(404);
            const preflight = new Request("https://x.workers.dev/donate/session", { method: "OPTIONS", headers: { Origin: ORIGIN } });
            expect((await handleDonate(preflight, off))!.status).toBe(404);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ignores other paths so the Meetup proxy keeps working", async () => {
        expect(await handleDonate(new Request("https://x.workers.dev/events"), env)).toBeNull();
    });

    it("answers preflight from corkvegans.ie and localhost only", async () => {
        for (const origin of [ORIGIN, "http://localhost:4321", "http://127.0.0.1:8787"]) {
            const res = (await handleDonate(new Request("https://x.workers.dev/donate/session", { method: "OPTIONS", headers: { Origin: origin } }), env))!;
            expect(res.status).toBe(204);
            expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
        }
        for (const origin of ["https://evil.example", "https://corkvegans.ie.evil.example", "http://localhost.evil.example"]) {
            const res = (await handleDonate(new Request("https://x.workers.dev/donate/session", { method: "OPTIONS", headers: { Origin: origin } }), env))!;
            expect(res.status).toBe(403);
            expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
        }
    });

    it("refuses POSTs from other origins and non-POST methods", async () => {
        const fetchMock = stubStripe();
        expect((await handleDonate(post({ frequency: "once", amount: 10 }, { origin: "https://evil.example" }), env))!.status).toBe(403);
        expect((await handleDonate(new Request("https://x.workers.dev/donate/session", { headers: { Origin: ORIGIN } }), env))!.status).toBe(405);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("donation Worker: validation", () => {
    it.each([
        { frequency: "once", amount: 2 },
        { frequency: "monthly", amount: 500 },
    ])("accepts %j", (body) => {
        expect(parseDonation(body)).toMatchObject(body);
    });

    it.each([
        { frequency: "once", amount: 1 },
        { frequency: "once", amount: 501 },
        { frequency: "once", amount: 2.5 },
        { frequency: "once", amount: "10" },
        { frequency: "yearly", amount: 10 },
        { frequency: "once" },
        { frequency: "once", amount: 10, currency: "usd" },
        { frequency: "once", amount: 10, turnstileToken: 5 },
        [],
        null,
        "once",
    ])("rejects %j with 400", async (body) => {
        const fetchMock = stubStripe();
        const res = (await handleDonate(post(body), env))!;
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid_request" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON, the wrong content type and oversized bodies", async () => {
        stubStripe();
        expect((await handleDonate(post("{not json"), env))!.status).toBe(400);
        expect((await handleDonate(post({ frequency: "once", amount: 10 }, { contentType: "text/plain" }), env))!.status).toBe(400);
        expect((await handleDonate(post({ frequency: "once", amount: 10, turnstileToken: "x".repeat(3000) }), env))!.status).toBe(400);
    });
});

describe("donation Worker: Stripe Checkout Session", () => {
    it("creates an embedded one-off donation session and returns only the client secret", async () => {
        const fetchMock = stubStripe();
        const res = (await handleDonate(post({ frequency: "once", amount: 25 }), env))!;
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ clientSecret: "cs_test_secret_123" });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer rk_test_dummy", "Stripe-Version": "2026-09-30.endive" });
        expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
            ui_mode: "embedded_page",
            redirect_on_completion: "never",
            mode: "payment",
            submit_type: "donate",
            customer_creation: "always",
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": "eur",
            "line_items[0][price_data][unit_amount]": "2500",
            "line_items[0][price_data][product_data][name]": "Donation to Cork Vegans",
            "name_collection[individual][enabled]": "true",
            "metadata[source]": "corkvegans.ie",
            "metadata[frequency]": "once",
        });
    });

    it("creates a monthly subscription session", () => {
        const params = Object.fromEntries(checkoutSessionParams({ frequency: "monthly", amount: 10 }));
        expect(params).toMatchObject({
            mode: "subscription",
            "line_items[0][price_data][unit_amount]": "1000",
            "line_items[0][price_data][recurring][interval]": "month",
            "line_items[0][price_data][product_data][name]": "Monthly donation to Cork Vegans",
        });
        expect(params).not.toHaveProperty("submit_type");
        expect(params).not.toHaveProperty("customer_creation");
    });

    it("hides Stripe error details from the browser and never logs the key", async () => {
        stubStripe({ status: 400, body: { error: { type: "invalid_request_error", code: "parameter_unknown", param: "name_collection", message: "Secret detail" } } });
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = (await handleDonate(post({ frequency: "once", amount: 10 }), env))!;
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: "checkout_unavailable" });
        const logged = log.mock.calls.flat().join(" ");
        expect(logged).toContain("parameter_unknown");
        expect(logged).not.toContain("rk_test_dummy");
        expect(logged).not.toContain("Secret detail");
    });

    it("fails safely when the secret key is missing", async () => {
        const fetchMock = stubStripe();
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await handleDonate(post({ frequency: "once", amount: 10 }), { PAYMENTS_ENABLED: "true" }))!.status).toBe(500);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("donation Worker: abuse protection", () => {
    it(`allows ${RATE_LIMIT} sessions per IP per minute without a rate limit binding`, async () => {
        stubStripe();
        const statuses = [];
        for (let i = 0; i <= RATE_LIMIT; i++) statuses.push((await handleDonate(post({ frequency: "once", amount: 10 }, { ip: "198.51.100.7" }), env))!.status);
        expect(statuses.slice(0, RATE_LIMIT).every((s) => s === 200)).toBe(true);
        expect(statuses.at(-1)).toBe(429);
        expect((await handleDonate(post({ frequency: "once", amount: 10 }, { ip: "198.51.100.8" }), env))!.status).toBe(200);
    });

    it("uses the Cloudflare rate limit binding when present", async () => {
        stubStripe();
        const limit = vi.fn(async () => ({ success: false }));
        const res = (await handleDonate(post({ frequency: "once", amount: 10 }, { ip: "192.0.2.1" }), { ...env, DONATE_RATE_LIMITER: { limit } }))!;
        expect(res.status).toBe(429);
        expect(limit).toHaveBeenCalledWith({ key: "192.0.2.1" });
    });

    it("checks Turnstile when its secret is set", async () => {
        const fetchMock = vi.fn(async (url: string) =>
            String(url).includes("turnstile")
                ? new Response(JSON.stringify({ success: false }))
                : new Response(JSON.stringify({ client_secret: "cs_test_secret_123" })),
        );
        vi.stubGlobal("fetch", fetchMock);
        const withTurnstile = { ...env, TURNSTILE_SECRET_KEY: "turnstile-secret" };

        expect((await handleDonate(post({ frequency: "once", amount: 10 }), withTurnstile))!.status).toBe(403);
        expect((await handleDonate(post({ frequency: "once", amount: 10, turnstileToken: "bad" }), withTurnstile))!.status).toBe(403);
        expect(fetchMock.mock.calls.every(([url]) => String(url).includes("turnstile"))).toBe(true);

        fetchMock.mockImplementation(async (url: string) =>
            new Response(JSON.stringify(String(url).includes("turnstile") ? { success: true } : { client_secret: "cs_test_secret_123" })),
        );
        expect((await handleDonate(post({ frequency: "once", amount: 10, turnstileToken: "good" }), withTurnstile))!.status).toBe(200);
    });
});
