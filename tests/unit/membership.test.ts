import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AMOUNT, LIMITS, MEMBER_CODE, PRESETS, amountHint, formatAmount, parseAmount, withMemberCode } from "../../src/lib/membership.ts";
import { CUSTOM_PRODUCT_ID, presetPrices, setUpCatalogue } from "../../scripts/stripe-membership-catalogue.ts";
import { keepBrevoKeyAlive, membershipPrice, parseSender, welcomeEmail } from "../../worker/welcome-email.js";
import * as members from "../../worker/members.js";
import * as worker from "../../worker/membership.js";

describe("membership amounts", () => {
    it.each([
        ["15", "monthly", 15],
        [" 15 ", "monthly", 15],
        ["€15", "monthly", 15],
        ["€ 2", "monthly", 2],
        ["500", "monthly", 500],
        ["50", "yearly", 50],
        ["€75", "yearly", 75],
    ] as const)("accepts %j %s", (raw, frequency, amount) => {
        expect(parseAmount(raw, frequency)).toEqual({ amount });
    });

    it.each([
        ["", "monthly", /Enter an amount/],
        ["15.50", "monthly", /whole number/],
        ["15,5", "monthly", /whole number/],
        ["-5", "monthly", /whole number/],
        ["ten", "monthly", /whole number/],
        ["1", "monthly", /smallest monthly amount is €2 a month/],
        ["0", "monthly", /smallest/],
        ["501", "monthly", /most we can take online is €500 a month/],
        ["49", "yearly", /smallest yearly amount is €50 a year/],
        ["501", "yearly", /most we can take online is €500 a year/],
    ] as const)("rejects %j %s", (raw, frequency, message) => {
        const result = parseAmount(raw, frequency);
        expect("error" in result && result.error).toMatch(message);
    });

    it("matches the Worker's presets and limits exactly", () => {
        expect(worker.PRESETS).toEqual(PRESETS);
        expect(worker.LIMITS).toEqual(LIMITS);
        for (const frequency of ["monthly", "yearly"] as const) expect(PRESETS[frequency]).toContain(DEFAULT_AMOUNT[frequency]);
    });

    it("formats amounts for people", () => {
        expect(formatAmount(10, "monthly")).toBe("€10 a month");
        expect(formatAmount(50, "yearly")).toBe("€50 a year");
        expect(amountHint("yearly")).toBe("Whole euros, from €50 to €500 a year.");
    });
});

describe("member codes on event links", () => {
    it("uses the same code format as the Worker", () => {
        expect(MEMBER_CODE.source).toBe(members.CODE_PATTERN.source);
    });

    it("adds the code to Eventbrite links only", () => {
        expect(withMemberCode("https://www.eventbrite.ie/e/social-123", "CV-7K3P9Q", "discount")).toBe("https://www.eventbrite.ie/e/social-123?discount=CV-7K3P9Q");
        expect(withMemberCode("https://www.eventbrite.ie/e/social-123?aff=site", "CV-7K3P9Q", "discount")).toBe("https://www.eventbrite.ie/e/social-123?aff=site&discount=CV-7K3P9Q");
        expect(withMemberCode("https://www.meetup.com/corkvegans/events/1/", "CV-7K3P9Q", "discount")).toBe("https://www.meetup.com/corkvegans/events/1/");
        expect(withMemberCode("https://eventbrite.ie.evil.example/e/1", "CV-7K3P9Q", "discount")).toBe("https://eventbrite.ie.evil.example/e/1");
        expect(withMemberCode("https://www.eventbrite.ie/e/1", "not-a-code", "discount")).toBe("https://www.eventbrite.ie/e/1");
        expect(withMemberCode("not a url", "CV-7K3P9Q", "discount")).toBe("not a url");
    });
});

describe("welcome email", () => {
    const price = { amount: 10, interval: "month", custom: false };

    it("has the code, how to use it, and the links, in text and HTML", () => {
        const email = welcomeEmail({ firstName: "Aoife", code: "CV-7K3P9Q", price, discountEur: 5, portalUrl: "https://billing.stripe.com/p/login/x" });
        expect(email.subject).toContain("member code");
        for (const part of [email.text, email.html]) {
            expect(part).toContain("CV-7K3P9Q");
            expect(part).toContain("€5 off one ticket for each paid Cork Vegans event");
            expect(part).toContain("https://corkvegans.ie/events/?member=CV-7K3P9Q");
            expect(part).toContain("https://www.eventbrite.ie/o/cork-vegans-91797524863");
            expect(part).toContain("https://billing.stripe.com/p/login/x");
            expect(part).toContain("https://corkvegans.ie/membership-terms/");
            expect(part).toContain("switch between €5, €10 and €15 a month in the portal");
            expect(part).not.toMatch(/donat|—/i);
        }
        expect(email.text).toContain("You're paying €10 a month");
    });

    it("tells yearly and custom-amount members to cancel and rejoin, as the portal only switches monthly set amounts", () => {
        for (const price of [
            { amount: 12, interval: "year", custom: true },
            { amount: 12, interval: "month", custom: true },
            { amount: 50, interval: "year", custom: false },
        ]) {
            const email = welcomeEmail({ code: "CV-7K3P9Q", price, discountEur: 5, portalUrl: "https://p" });
            expect(email.text).toContain(`You're paying €${price.amount} a ${price.interval}`);
            expect(email.text).toContain("cancel in the portal and join again at the new amount");
            expect(email.text).not.toContain("switch between");
            expect(email.text).toMatch(/^Hi there,/);
        }
    });

    it("reads the sender in the form Brevo wants", () => {
        expect(parseSender("Cork Vegans <members@corkvegans.ie>")).toEqual({ name: "Cork Vegans", email: "members@corkvegans.ie" });
        expect(parseSender('"Cork Vegans" <members@corkvegans.ie>')).toEqual({ name: "Cork Vegans", email: "members@corkvegans.ie" });
        expect(parseSender("members@corkvegans.ie")).toEqual({ email: "members@corkvegans.ie" });
    });

    it("keeps the Brevo key in use with one read-only call, on the weekly cron", async () => {
        const fetchMock = vi.fn(async () => new Response("{}"));
        vi.stubGlobal("fetch", fetchMock);
        try {
            expect(await keepBrevoKeyAlive({})).toBe("skipped");
            expect(fetchMock).not.toHaveBeenCalled();

            const waits: Promise<unknown>[] = [];
            const entry = (await import("../../worker/index.js")).default;
            await entry.scheduled({}, { BREVO_API_KEY: "xkeysib-dummy" }, { waitUntil: (p: Promise<unknown>) => waits.push(p) });
            expect(await Promise.all(waits)).toEqual(["ok"]);
            const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
            expect(url).toBe("https://api.brevo.com/v3/smtp/statistics/aggregatedReport");
            expect(init.method ?? "GET").toBe("GET");
            expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-dummy");

            fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
            await expect(keepBrevoKeyAlive({ BREVO_API_KEY: "xkeysib-dummy" })).rejects.toThrow("401");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("escapes names in the HTML", () => {
        expect(welcomeEmail({ firstName: "<b>Aoife</b>", code: "CV-7K3P9Q", price, discountEur: 5 }).html).toContain("&lt;b&gt;Aoife&lt;/b&gt;");
    });

    it("reads the current price from the subscription", () => {
        expect(membershipPrice({ items: { data: [{ price: { unit_amount: 5000, recurring: { interval: "year" }, lookup_key: "membership_yearly_50" } }] } })).toEqual({ amount: 50, interval: "year", custom: false });
        expect(membershipPrice({ items: { data: [{ price: { unit_amount: 1200, recurring: { interval: "month" }, lookup_key: null } }] } })).toEqual({ amount: 12, interval: "month", custom: true });
    });
});

describe("Stripe catalogue script", () => {
    it("defines the five preset prices with lookup keys", () => {
        expect(presetPrices().map((p) => p.lookupKey)).toEqual(["membership_monthly_5", "membership_monthly_10", "membership_monthly_15", "membership_yearly_50", "membership_yearly_100"]);
    });

    it("matches the Worker's product for custom amounts", () => {
        expect(worker.CUSTOM_PRODUCT_ID).toBe(CUSTOM_PRODUCT_ID);
    });

    it("gives each preset its own product, so members can switch in the customer portal", () => {
        const products = presetPrices().map((p) => p.productId);
        expect(new Set(products).size).toBe(5);
        expect(products).not.toContain(CUSTOM_PRODUCT_ID);
        expect(presetPrices()[1]).toMatchObject({ productId: "cv_membership_monthly_10", productName: "Cork Vegans membership: €10 a month" });
    });

    /** A fake Stripe holding some products and active prices; records every POST. */
    function fakeStripe(products: Record<string, { active: boolean }>, prices: { id: string; product: string; lookup_key: string }[]) {
        const posts: { path: string; body: Record<string, string> }[] = [];
        const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
            const url = new URL(input);
            const body = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
            if (init.method === "POST") {
                posts.push({ path: url.pathname, body });
                return new Response(JSON.stringify({ id: url.pathname === "/v1/prices" ? `price_new${posts.length}` : body.id }));
            }
            if (url.pathname === "/v1/prices") return new Response(JSON.stringify({ data: prices }));
            const product = products[url.pathname.replace("/v1/products/", "")];
            return product ? new Response(JSON.stringify(product)) : new Response(JSON.stringify({ error: { message: "No such product" } }), { status: 404 });
        });
        return { fetchImpl, posts };
    }

    it("creates the products and prices on a fresh account", async () => {
        const { fetchImpl, posts } = fakeStripe({}, []);
        await setUpCatalogue("sk_test_x", fetchImpl, () => {});
        expect(posts.filter((p) => p.path === "/v1/products").map((p) => p.body.id)).toEqual([CUSTOM_PRODUCT_ID, ...presetPrices().map((p) => p.productId)]);
        const created = posts.filter((p) => p.path === "/v1/prices").map((p) => p.body);
        expect(created.map((c) => c.lookup_key)).toEqual(presetPrices().map((p) => p.lookupKey));
        expect(created[3]).toEqual({ product: "cv_membership_yearly_50", currency: "eur", unit_amount: "5000", "recurring[interval]": "year", lookup_key: "membership_yearly_50", nickname: "€50 a year" });
    });

    it("changes nothing when everything exists", async () => {
        const products = Object.fromEntries([CUSTOM_PRODUCT_ID, ...presetPrices().map((p) => p.productId)].map((id) => [id, { active: true }]));
        const { fetchImpl, posts } = fakeStripe(products, presetPrices().map((p, i) => ({ id: `price_${i}`, product: p.productId, lookup_key: p.lookupKey })));
        await setUpCatalogue("sk_test_x", fetchImpl, () => {});
        expect(posts).toEqual([]);
    });

    it("moves lookup keys off the old single product and archives its prices", async () => {
        const { fetchImpl, posts } = fakeStripe({}, [{ id: "price_old_m5", product: "prod_old", lookup_key: "membership_monthly_5" }]);
        const lines: string[] = [];
        await setUpCatalogue("sk_test_x", fetchImpl, (line) => lines.push(line));
        const prices = posts.filter((p) => p.path === "/v1/prices").map((p) => p.body);
        expect(prices[0]).toMatchObject({ product: "cv_membership_monthly_5", lookup_key: "membership_monthly_5", transfer_lookup_key: "true" });
        expect(prices[1]).not.toHaveProperty("transfer_lookup_key");
        expect(posts).toContainEqual({ path: "/v1/prices/price_old_m5", body: { active: "false" } });
        expect(lines.join("\n")).toContain("old product prod_old");
    });
});
