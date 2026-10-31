/**
 * Fake Stripe, Eventbrite and Brevo APIs for the membership Worker's tests.
 * They keep state like the real services (subscription metadata, discount
 * codes, sent emails), so retries and duplicates can be tested end to end.
 */

export const ORG = "org-1";
export const GROUP = "group-1";

export const workerEnv = {
    PAYMENTS_ENABLED: "true",
    STRIPE_SECRET_KEY: "rk_test_dummy",
    STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
    MEMBER_CODE_SECRET: "member-code-secret",
    EVENTBRITE_TOKEN: "eventbrite-token",
    EVENTBRITE_ORGANIZATION_ID: ORG,
    EVENTBRITE_MEMBERS_TICKET_GROUP_ID: GROUP,
    BREVO_API_KEY: "xkeysib-dummy",
    EMAIL_FROM: "Cork Vegans <members@corkvegans.ie>",
    STRIPE_PORTAL_URL: "https://billing.stripe.com/p/login/test",
};

export interface FakeSubscription {
    id: string;
    customer: string;
    status: string;
    metadata: Record<string, string>;
    items: { data: { current_period_end: number; price: { unit_amount: number; recurring: { interval: string }; lookup_key: string | null } }[] };
}

export interface FakeDiscount {
    id: string;
    code: string;
    type: string;
    amount_off: string;
    ticket_group_id: string;
    end_date: string;
    used?: boolean;
}

export interface Call {
    method: string;
    url: string;
    body: string;
    headers: Record<string, string>;
}

export function subscription(overrides: Partial<FakeSubscription> = {}): FakeSubscription {
    return {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        metadata: { source: "corkvegans.ie", first_name: "Aoife", last_name: "Murphy", email_updates: "yes", heard_about: "A friend", frequency: "monthly", amount_eur: "10", plan: "preset" },
        items: { data: [{ current_period_end: 1_800_000_000, price: { unit_amount: 1000, recurring: { interval: "month" }, lookup_key: "membership_monthly_10" } }] },
        ...overrides,
    };
}

export function fakeServices(options: { subscriptions?: FakeSubscription[]; customers?: { id: string; email: string }[]; fail?: RegExp } = {}) {
    const subscriptions = new Map((options.subscriptions ?? [subscription()]).map((s) => [s.id, structuredClone(s)]));
    const customers = new Map((options.customers ?? [{ id: "cus_1", email: "aoife@example.ie" }]).map((c) => [c.id, { ...c, name: "", metadata: {} as Record<string, string> }]));
    const discounts = new Map<string, FakeDiscount>();
    const emails: { to: string[]; from: { name?: string; email: string }; replyTo: string; subject: string; text: string; html: string }[] = [];
    const calls: Call[] = [];
    let nextDiscount = 1;

    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

    const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(String(input));
        const method = init.method ?? "GET";
        const body = init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? "");
        const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
        calls.push({ method, url: url.href, body, headers });
        if (options.fail?.test(`${method} ${url.href}`)) return ok({ error: { type: "api_error", code: "boom", message: "aoife@example.ie broke" } }, 500);
        const form = Object.fromEntries(new URLSearchParams(body));
        const metadataOf = () => Object.fromEntries(Object.entries(form).flatMap(([k, v]) => (/^metadata\[(.+)\]$/.exec(k) ? [[/^metadata\[(.+)\]$/.exec(k)![1], v]] : [])));

        if (url.hostname === "api.stripe.com") {
            let m: RegExpExecArray | null;
            if ((m = /^\/v1\/subscriptions\/(sub_\w+)$/.exec(url.pathname))) {
                const sub = subscriptions.get(m[1]);
                if (!sub) return ok({ error: { code: "resource_missing" } }, 404);
                if (method === "POST") Object.assign(sub.metadata, metadataOf());
                return ok(sub);
            }
            if (url.pathname === "/v1/subscriptions" && method === "GET") {
                return ok({ data: [...subscriptions.values()].filter((s) => s.customer === url.searchParams.get("customer")) });
            }
            if ((m = /^\/v1\/customers\/(cus_\w+)$/.exec(url.pathname))) {
                const customer = customers.get(m[1])!;
                if (method === "POST") {
                    customer.name = form.name ?? customer.name;
                    Object.assign(customer.metadata, metadataOf());
                }
                return ok(customer);
            }
            if (url.pathname === "/v1/customers" && method === "GET") {
                return ok({ data: [...customers.values()].filter((c) => c.email === url.searchParams.get("email")) });
            }
        }

        if (url.hostname === "www.eventbriteapi.com") {
            const json = init.body ? JSON.parse(String(init.body)) : {};
            if (url.pathname === `/v3/organizations/${ORG}/discounts/` && method === "POST") {
                const d = json.discount;
                if ([...discounts.values()].some((x) => x.code === d.code)) return ok({ error: "ARGUMENTS_ERROR", error_description: `code ${d.code} already exists` }, 400);
                const discount = { ...d, id: `d${nextDiscount++}` };
                discounts.set(discount.id, discount);
                return ok(discount);
            }
            if (url.pathname === `/v3/organizations/${ORG}/discounts/` && method === "GET") {
                return ok({ discounts: [...discounts.values()].filter((x) => x.code === url.searchParams.get("code")) });
            }
            let m: RegExpExecArray | null;
            if ((m = /^\/v3\/discounts\/(\w+)\/$/.exec(url.pathname))) {
                const discount = discounts.get(m[1]);
                if (!discount) return ok({ error: "NOT_FOUND" }, 404);
                if (method === "DELETE") {
                    if (discount.used) return ok({ error: "DISCOUNT_CANNOT_BE_DELETED" }, 400);
                    discounts.delete(discount.id);
                    return ok({});
                }
                Object.assign(discount, json.discount);
                return ok(discount);
            }
        }

        if (url.hostname === "api.brevo.com" && url.pathname === "/v3/smtp/email") {
            if (headers["api-key"] !== workerEnv.BREVO_API_KEY) return ok({ code: "unauthorized", message: "Key not found" }, 401);
            const body = JSON.parse(String(init.body));
            emails.push({ to: body.to.map((t: { email: string }) => t.email), from: body.sender, replyTo: body.replyTo?.email, subject: body.subject, text: body.textContent, html: body.htmlContent });
            return ok({ messageId: `<email-${emails.length}@brevo>` }, 201);
        }

        return ok({ error: `unexpected ${method} ${url.href}` }, 500);
    };

    return { fetchImpl, subscriptions, customers, discounts, emails, calls };
}
