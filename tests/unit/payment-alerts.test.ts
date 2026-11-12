import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentAlertEmail, sendPaymentAlert } from "../../worker/payment-alerts.js";
import { fakeServices, subscription, workerEnv } from "./fake-membership-services.ts";

const NOW = new Date("2026-11-16T06:17:00Z");
const DAY = 86_400;
const nowSeconds = NOW.getTime() / 1000;

function useServices(subs: ReturnType<typeof subscription>[]) {
    const services = fakeServices({ subscriptions: subs });
    vi.stubGlobal("fetch", services.fetchImpl);
    return services;
}

const ended = (id: string, reason: string, daysAgo: number, name = "Ciara") =>
    subscription({ id, status: "canceled", ended_at: nowSeconds - daysAgo * DAY, cancellation_details: { reason }, metadata: { ...subscription().metadata, first_name: name } });

afterEach(() => vi.unstubAllGlobals());

describe("weekly failed-payment alert", () => {
    it("sends nothing when no payments are failing", async () => {
        const services = useServices([subscription({ id: "sub_1active" }), ended("sub_1byrequest", "cancellation_requested", 2)]);
        expect(await sendPaymentAlert(workerEnv, NOW)).toBe(0);
        expect(services.emails).toHaveLength(0);
    });

    it("lists failing payments and memberships ended this week by failed retries, to the organisers only", async () => {
        const services = useServices([
            subscription({ id: "sub_1pastdue", status: "past_due", livemode: true }),
            ended("sub_1failedweek", "payment_failed", 3, "Seán <b>"),
            ended("sub_1failedold", "payment_failed", 9),
            ended("sub_1cancelled", "cancellation_requested", 1),
            subscription({ id: "sub_1othersite", status: "past_due", metadata: { source: "elsewhere" } }),
        ]);
        expect(await sendPaymentAlert(workerEnv, NOW)).toBe(2);
        expect(services.emails).toHaveLength(1);
        const [email] = services.emails;
        expect(email.to).toEqual(["crkvgns@gmail.com"]);
        expect(email.subject).toBe("Cork Vegans: 2 membership payments failed");
        expect(email.text).toContain("Aoife Murphy, €10 a month (Stripe is retrying the payment): https://dashboard.stripe.com/subscriptions/sub_1pastdue");
        expect(email.text).toContain("Seán <b> Murphy, €10 a month (ended 13 Nov 2026)");
        expect(email.text).not.toMatch(/sub_1failedold|sub_1cancelled|sub_1othersite/);
        // Member names come from the join form, so they're escaped in the HTML.
        expect(email.html).toContain("Seán &lt;b&gt; Murphy");
        expect(email.html).not.toContain("<b> Murphy");
        // No member email addresses or codes.
        expect(email.text).not.toMatch(/@example|CV-/);
    });

    it("links test-mode subscriptions to the test dashboard", () => {
        const { text } = paymentAlertEmail([subscription({ id: "sub_1test", status: "past_due", livemode: false })], []);
        expect(text).toContain("https://dashboard.stripe.com/test/subscriptions/sub_1test");
        expect(text).not.toContain("Membership ended");
    });

    it("runs from the weekly cron alongside the Brevo check, and skips while payments are off", async () => {
        const services = useServices([subscription({ id: "sub_1pastdue", status: "past_due" })]);
        const entry = (await import("../../worker/index.js")).default;
        const waits: Promise<unknown>[] = [];
        // The Brevo check calls an endpoint the fakes don't know, so only the alert's result matters here.
        await entry.scheduled({ cron: "17 6 * * 1" }, workerEnv, { waitUntil: (p: Promise<unknown>) => waits.push(p.catch(() => "brevo")) });
        expect(await Promise.all(waits)).toEqual(["brevo", 1]);
        expect(services.emails).toHaveLength(1);
        expect(await sendPaymentAlert({ ...workerEnv, PAYMENTS_ENABLED: "false" }, NOW)).toBe("skipped");
    });
});
