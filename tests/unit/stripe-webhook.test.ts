import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventbriteDate } from "../../worker/eventbrite.js";
import { CODE_PATTERN, memberCodeFor } from "../../worker/members.js";
import { handleMembership } from "../../worker/membership.js";
import { SIGNATURE_TOLERANCE_SECONDS, handleStripeEvent, verifyStripeSignature } from "../../worker/stripe-webhook.js";
import { fakeServices, GROUP, subscription, workerEnv as env } from "./fake-membership-services.ts";

const NOW = new Date("2026-10-23T10:00:00Z");

function sign(payload: string, secret = env.STRIPE_WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    return `t=${timestamp},v1=${signature}`;
}

function webhook(event: unknown, header?: string) {
    const payload = JSON.stringify(event);
    return new Request("https://x.workers.dev/stripe/webhook", { method: "POST", headers: { "Stripe-Signature": header ?? sign(payload) }, body: payload });
}

const joined = (overrides: Record<string, unknown> = {}) => ({
    id: "evt_join",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", mode: "subscription", subscription: "sub_1", customer_details: { email: "aoife@example.ie" }, ...overrides } },
});

function useServices(...args: Parameters<typeof fakeServices>) {
    const services = fakeServices(...args);
    vi.stubGlobal("fetch", services.fetchImpl);
    return services;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("webhook signature", () => {
    const payload = '{"id":"evt_1"}';
    const now = 1_800_000_000;

    it("accepts Stripe's signature, including when the header lists several", async () => {
        expect(await verifyStripeSignature(payload, sign(payload, "whsec_x", now), "whsec_x", now)).toBe(true);
        const header = `${sign(payload, "whsec_old", now)},v1=${createHmac("sha256", "whsec_x").update(`${now}.${payload}`).digest("hex")}`;
        expect(await verifyStripeSignature(payload, header, "whsec_x", now)).toBe(true);
    });

    it("rejects a wrong secret, a changed payload, old timestamps and junk", async () => {
        expect(await verifyStripeSignature(payload, sign(payload, "whsec_other", now), "whsec_x", now)).toBe(false);
        expect(await verifyStripeSignature('{"id":"evt_2"}', sign(payload, "whsec_x", now), "whsec_x", now)).toBe(false);
        expect(await verifyStripeSignature(payload, sign(payload, "whsec_x", now - SIGNATURE_TOLERANCE_SECONDS - 1), "whsec_x", now)).toBe(false);
        for (const header of ["", "t=abc,v1=00", `t=${now}`, "nonsense"]) expect(await verifyStripeSignature(payload, header, "whsec_x", now)).toBe(false);
    });

    it("answers 400 to unsigned requests and does nothing", async () => {
        const services = useServices();
        const res = (await handleMembership(webhook(joined(), "t=1,v1=bad"), env))!;
        expect(res.status).toBe(400);
        expect(services.calls).toEqual([]);
    });

    it("is switched off (404) until the webhook secret is set", async () => {
        const { STRIPE_WEBHOOK_SECRET: _, ...noSecret } = env;
        expect((await handleMembership(webhook(joined()), noSecret))!.status).toBe(404);
    });
});

describe("member codes", () => {
    it("look like CV-7K3P9Q, with no look-alike characters, and are the same for the same subscription", async () => {
        const a = await memberCodeFor("sub_1", "secret");
        expect(a).toMatch(CODE_PATTERN);
        expect(await memberCodeFor("sub_1", "secret")).toBe(a);
        expect(await memberCodeFor("sub_2", "secret")).not.toBe(a);
        expect(await memberCodeFor("sub_1", "other secret")).not.toBe(a);
    });

    it("never use 0, O, 1, I or L", async () => {
        for (let i = 0; i < 200; i++) expect((await memberCodeFor(`sub_${i}`, "s")).slice(3)).not.toMatch(/[01OIL]/);
    });
});

describe("checkout.session.completed", () => {
    it("saves the member's details, creates one €5 Eventbrite code until period end + 3 days, and sends one welcome email", async () => {
        const services = useServices();
        expect(await handleStripeEvent(env, joined(), NOW)).toBe("joined");

        const sub = services.subscriptions.get("sub_1")!;
        const code = sub.metadata.member_code;
        expect(code).toBe(await memberCodeFor("sub_1", env.MEMBER_CODE_SECRET));
        const [discount] = services.discounts.values();
        expect(services.discounts.size).toBe(1);
        expect(discount).toMatchObject({ type: "access", code, amount_off: "5.00", ticket_group_id: GROUP });
        expect(discount.end_date).toBe(eventbriteDate(new Date((1_800_000_000 + 3 * 86_400) * 1000)));
        expect(sub.metadata.eventbrite_discount_id).toBe(discount.id);
        expect(sub.metadata.welcome_email_sent_at).toBe(NOW.toISOString());

        expect(services.customers.get("cus_1")).toMatchObject({ name: "Aoife Murphy", metadata: { first_name: "Aoife", last_name: "Murphy", email_updates: "yes", heard_about: "A friend" } });

        expect(services.emails).toHaveLength(1);
        const [email] = services.emails;
        expect(email.to).toEqual(["aoife@example.ie"]);
        expect(email.from).toEqual({ name: "Cork Vegans", email: "members@corkvegans.ie" });
        expect(email.replyTo).toBe("crkvgns@gmail.com");
        expect(email.text).toContain(`Your member code: ${code}`);
        expect(email.text).toContain(`https://corkvegans.ie/events/?member=${code}`);
        expect(email.text).toContain("https://billing.stripe.com/p/login/test");
        expect(email.text).toContain("€10 a month");
        expect(email.html).toContain(code);
    });

    it("does nothing new when Stripe sends the same event again", async () => {
        const services = useServices();
        await handleStripeEvent(env, joined(), NOW);
        const before = services.calls.length;
        await handleStripeEvent(env, joined(), NOW);
        expect(services.discounts.size).toBe(1);
        expect(services.emails).toHaveLength(1);
        const creates = services.calls.slice(before).filter((c) => c.method === "POST" && /eventbriteapi|brevo/.test(c.url));
        expect(creates).toEqual([]);
    });

    it("reuses the Eventbrite code after a crash between creating it and saving it", async () => {
        const services = useServices();
        const code = await memberCodeFor("sub_1", env.MEMBER_CODE_SECRET);
        services.discounts.set("d99", { id: "d99", code, type: "access", amount_off: "5.00", ticket_group_id: GROUP, end_date: "x" });
        await handleStripeEvent(env, joined(), NOW);
        expect(services.discounts.size).toBe(1);
        expect(services.subscriptions.get("sub_1")!.metadata).toMatchObject({ member_code: code, eventbrite_discount_id: "d99" });
    });

    it("retries only the email if sending failed last time", async () => {
        const services = useServices({ fail: /api\.brevo\.com/ });
        await expect(handleStripeEvent(env, joined(), NOW)).rejects.toThrow(/Brevo responded 500/);
        expect(services.discounts.size).toBe(1);
        expect(services.subscriptions.get("sub_1")!.metadata.welcome_email_sent_at).toBeUndefined();

        const retry = fakeServices();
        retry.subscriptions.set("sub_1", services.subscriptions.get("sub_1")!);
        retry.discounts.set(...([...services.discounts.entries()][0]));
        vi.stubGlobal("fetch", retry.fetchImpl);
        await handleStripeEvent(env, joined(), NOW);
        expect(retry.discounts.size).toBe(1);
        expect(retry.emails).toHaveLength(1);
    });

    it("ignores payments that aren't memberships from the site", async () => {
        const services = useServices({ subscriptions: [subscription({ metadata: {} })] });
        expect(await handleStripeEvent(env, joined({ mode: "payment", subscription: null }), NOW)).toBe("ignored");
        expect(await handleStripeEvent(env, joined(), NOW)).toBe("ignored");
        expect(services.discounts.size).toBe(0);
        expect(services.emails).toHaveLength(0);
    });

    it("answers 500 so Stripe retries, and logs no personal details or secrets", async () => {
        useServices({ fail: /eventbriteapi/ });
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = (await handleMembership(webhook(joined()), env))!;
        expect(res.status).toBe(500);
        const logged = log.mock.calls.flat().join(" ");
        expect(logged).toContain("checkout.session.completed evt_join failed");
        for (const secret of ["aoife", "Aoife", "Murphy", "rk_test_dummy", "eventbrite-token", "whsec", "CV-"]) expect(logged).not.toContain(secret);
    });

    it("answers 200 once handled", async () => {
        useServices();
        const res = (await handleMembership(webhook(joined()), env))!;
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: true, result: "joined" });
    });
});

describe("invoice.paid", () => {
    const paid = (billing_reason: string, sub = "sub_1") => ({
        id: "evt_paid",
        type: "invoice.paid",
        data: { object: { billing_reason, parent: { subscription_details: { subscription: sub } } } },
    });

    it("moves the code's end date to the new period end + 3 days on renewal", async () => {
        const services = useServices();
        await handleStripeEvent(env, joined(), NOW);
        services.subscriptions.get("sub_1")!.items.data[0].current_period_end = 1_802_678_400;
        expect(await handleStripeEvent(env, paid("subscription_cycle"), NOW)).toBe("extended");
        expect([...services.discounts.values()][0].end_date).toBe(eventbriteDate(new Date((1_802_678_400 + 3 * 86_400) * 1000)));
        expect(await handleStripeEvent(env, paid("subscription_update"), NOW)).toBe("extended"); // tier change mid-period
    });

    it("leaves the first invoice to checkout.session.completed", async () => {
        const services = useServices();
        expect(await handleStripeEvent(env, paid("subscription_create"), NOW)).toBe("ignored");
        expect(services.discounts.size).toBe(0);
    });

    it("waits for the code if the renewal arrives first", async () => {
        const services = useServices();
        expect(await handleStripeEvent(env, paid("subscription_cycle"), NOW)).toBe("no code yet");
        expect(services.discounts.size).toBe(0);
    });
});

describe("customer.subscription.updated and .deleted", () => {
    const event = (type: string, object: unknown) => ({ id: "evt_sub", type, data: { object } });

    it("keeps the code when a member cancels at period end or changes tier", async () => {
        const services = useServices();
        await handleStripeEvent(env, joined(), NOW);
        const sub = services.subscriptions.get("sub_1")!;
        const before = structuredClone([...services.discounts.values()]);
        expect(await handleStripeEvent(env, event("customer.subscription.updated", { ...sub, cancel_at_period_end: true }), NOW)).toBe("unchanged");
        expect([...services.discounts.values()]).toEqual(before);
    });

    it("deletes an unused code when the membership ends, and is fine if it's already gone", async () => {
        const services = useServices();
        await handleStripeEvent(env, joined(), NOW);
        const sub = services.subscriptions.get("sub_1")!;
        expect(await handleStripeEvent(env, event("customer.subscription.deleted", { ...sub, status: "canceled" }), NOW)).toBe("deleted");
        expect(services.discounts.size).toBe(0);
        expect(await handleStripeEvent(env, event("customer.subscription.deleted", { ...sub, status: "canceled" }), NOW)).toBe("gone");
    });

    it("ends a used code now, since Eventbrite can't delete used codes", async () => {
        const services = useServices();
        await handleStripeEvent(env, joined(), NOW);
        const [discount] = services.discounts.values();
        discount.used = true;
        const sub = services.subscriptions.get("sub_1")!;
        expect(await handleStripeEvent(env, event("customer.subscription.deleted", sub), NOW)).toBe("ended");
        expect(discount.end_date).toBe(eventbriteDate(NOW));
    });

    it("acknowledges other events without doing anything", async () => {
        const services = useServices();
        expect(await handleStripeEvent(env, event("customer.created", {}), NOW)).toBe("ignored");
        expect(services.calls).toEqual([]);
    });
});

describe("Eventbrite dates", () => {
    it("are local Irish time without a zone, as Eventbrite's discount dates expect", () => {
        expect(eventbriteDate(new Date("2026-07-01T12:00:00Z"))).toBe("2026-07-01T13:00:00");
        expect(eventbriteDate(new Date("2026-12-01T12:00:00Z"))).toBe("2026-12-01T12:00:00");
    });
});
