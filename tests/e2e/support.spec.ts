import { expect, test, type Page } from "@playwright/test";
import { features } from "../../src/config/site.ts";

const ENDPOINT = "https://formspree.io/f/testfixture";
const CARD_TOKEN = "sub_1TestMember00.AbCdEfGhIjKlMnOpQrStUv";

test("membership: benefits, terms link and no donation wording", async ({ page }) => {
    await page.goto("/membership/");

    const nav = page.getByRole("navigation", { name: "On this page" });
    await expect(nav.getByRole("link", { name: "Join" })).toHaveAttribute("href", "#join");
    await expect(nav.getByRole("link", { name: "Member discounts" })).toHaveAttribute("href", "#partners");
    await expect(nav.getByRole("link", { name: "Your card" })).toHaveCount(features.payments ? 1 : 0);

    const section = page.locator("#join");
    await expect(section.getByRole("heading", { level: 2, name: "What members get" })).toBeVisible();
    await expect(section).toContainText("every member gets the same benefits, whatever they pay");
    // The test partners make the partner discount a benefit.
    await expect(section.locator("ul").first().getByRole("listitem")).toHaveCount(5);
    await expect(section).toContainText("Discounts at our partner businesses");
    await expect(section).toContainText("€5 off one ticket for each paid Cork Vegans event (subject to availability)");
    await expect(section).toContainText("Free events stay free and open to everyone.");
    await expect(section.getByRole("link", { name: "membership terms" }).first()).toHaveAttribute("href", "/membership-terms/");
    await expect(page.getByText(/donat/i)).toHaveCount(0);
    await expect(page.locator("#donate")).toHaveCount(0);
});

test("membership: coming soon, with no join form, Stripe or Worker calls", async ({ page }) => {
    test.skip(features.payments, "features.payments is on");
    const external: string[] = [];
    page.on("request", (r) => {
        if (/stripe\.com|\/membership\//.test(r.url())) external.push(r.url());
    });
    await page.goto("/membership/");
    await expect(page.locator("#join").getByText("Coming soon", { exact: true })).toBeVisible();
    await expect(page.locator("[data-membership-root], [data-membership-dialog], [data-membership-manage]")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(external).toEqual([]);
});

test("home page points to membership", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("link", { name: /^Membership (Become|Membership is)/ });
    await expect(card).toHaveAttribute("href", "/membership/");
    await expect(card).toContainText("€5 off our paid events, early booking and member events");
    await card.click();
    await expect(page.locator("h1")).toHaveText("Cork Vegans membership");
});

test("the Support page sends people to the Membership page", async ({ page }) => {
    await page.goto("/support/#membership");
    const section = page.locator("#membership");
    await expect(section.getByRole("heading", { level: 2, name: "Membership" })).toBeInViewport();
    await expect(section).toContainText("€5 off our paid events, early booking and member events");
    await expect(page.locator("[data-membership-root]")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Membership" })).toHaveAttribute("href", "/membership/");
    await section.getByRole("link", { name: features.payments ? "Become a member" : "Find out more" }).click();
    await expect(page).toHaveURL(/\/membership\/$/);
});

test("the old thank-you page is gone", async ({ page }) => {
    const res = await page.goto("/support/thanks/");
    expect(res?.status()).toBe(404);
});

test("membership terms and privacy pages", async ({ page }) => {
    await page.goto("/membership-terms/");
    await expect(page.getByRole("heading", { level: 1, name: "Membership terms" })).toBeVisible();
    for (const heading of ["What members get", "Your membership card", "Partner discounts", "Contribute what you can", "Renewal", "Cancelling", "Changing your amount", "Membership refunds", "Event tickets"]) {
        await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    await expect(page.getByText("You can cancel any time in your membership portal. Your benefits continue until the end of the period you've paid for, and you won't be charged again.")).toBeVisible();
    await expect(page.getByText("If you change your mind within 14 days of joining and haven't used any member benefits")).toBeVisible();
    await expect(page.getByRole("link", { name: "crkvgns@gmail.com" }).first()).toHaveAttribute("href", "mailto:crkvgns@gmail.com");

    await page.locator("footer").getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy\/$/);
    for (const name of ["Stripe", "Brevo", "Eventbrite"]) await expect(page.locator("main, body").getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Your rights" })).toBeVisible();
});

test("events page remembers a member code from the welcome email link", async ({ page }) => {
    await page.goto("/events/?member=CV-7K3P9Q");
    await expect(page).toHaveURL(/\/events\/$/);
    expect(await page.evaluate(() => localStorage.getItem("cv-member-code"))).toBe("CV-7K3P9Q");
    // Only Eventbrite links get the code; others are left alone.
    for (const href of await page.locator("[data-event-list] a[href]").evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href))) {
        if (!/eventbrite\.(ie|com|co\.uk)\/e\//.test(href)) expect(href).not.toContain("CV-7K3P9Q");
    }
});

// The join form is on in test builds (CV_FIXTURES=1), against a fake Worker and Stripe.
test.describe("join form", () => {
    test.skip(!features.payments, "features.payments is off");

    const WORKER = "https://membership.example";

    // Stands in for Stripe.js: "mounts" a fake checkout with a button that
    // completes it, so the whole flow runs without contacting Stripe.
    const FAKE_STRIPE_JS = `
        window.Stripe = (key) => ({
            async createEmbeddedCheckoutPage({ fetchClientSecret, onComplete }) {
                const secret = await fetchClientSecret();
                let el;
                return {
                    mount(target) {
                        el = target;
                        target.innerHTML = '<p data-fake-checkout>Fake checkout ' + key + ' ' + secret + '</p><button type="button">Pay now</button>';
                        target.querySelector("button").onclick = () => onComplete();
                    },
                    destroy() { if (el) el.innerHTML = ""; window.__destroyed = (window.__destroyed || 0) + 1; },
                };
            },
        });
    `;

    type Reply = { status: number; json: unknown };
    async function mockWorker(
        page: Page,
        { session = () => ({ status: 200, json: { clientSecret: "cs_test_fake_secret_x" } }), code = () => ({ status: 200, json: { status: "ready", code: "CV-7K3P9Q", cardToken: CARD_TOKEN } }), resend = () => ({ status: 200, json: { ok: true } }) }: {
            session?: (body: Record<string, unknown>) => Reply;
            code?: (n: number) => Reply;
            resend?: (body: Record<string, unknown>) => Reply;
        } = {},
    ) {
        const requests: { path: string; body: Record<string, unknown> }[] = [];
        let codeCalls = 0;
        await page.route("https://js.stripe.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_STRIPE_JS }));
        await page.route(`${WORKER}/**`, (route) => {
            const path = new URL(route.request().url()).pathname;
            const body = route.request().postDataJSON();
            requests.push({ path, body });
            const { status, json } = path === "/membership/session" ? session(body) : path === "/membership/code" ? code(++codeCalls) : resend(body);
            return route.fulfill({ status, json, headers: { "Access-Control-Allow-Origin": "*" } });
        });
        return requests;
    }

    async function fillDetails(page: Page) {
        await page.getByLabel("First name").fill("Aoife");
        await page.getByLabel("Last name").fill("Murphy");
        await page.locator("[data-membership-form]").getByLabel("Email", { exact: true }).fill("aoife@example.ie");
        await page.getByLabel("How did you hear about us?").fill("A friend");
        await page.getByLabel(/I agree to the/).check();
    }

    test("monthly by default, yearly amounts, and friendly limits for Other", async ({ page }) => {
        await mockWorker(page);
        await page.goto("/membership/#join");

        const often = page.getByRole("group", { name: "How often?" });
        await expect(often.getByRole("radio", { name: "Monthly" })).toBeChecked();
        const monthly = page.getByRole("group", { name: "Monthly amount" });
        for (const name of ["€5 a month", "€10 a month", "€15 a month", "Other"]) await expect(monthly.getByRole("radio", { name, exact: true })).toBeAttached();
        await expect(monthly.getByRole("radio", { name: "€10 a month" })).toBeChecked();
        await expect(page.getByText("Same benefits whatever you choose. Pick what works for you.")).toBeVisible();

        await often.getByText("Yearly").click();
        await expect(monthly).toBeHidden();
        const yearly = page.getByRole("group", { name: "Yearly amount" });
        await expect(yearly.getByRole("radio")).toHaveCount(3);
        await expect(yearly.getByRole("radio", { name: "€50 a year" })).toBeChecked();
        await expect(yearly.getByRole("radio", { name: "€100 a year" })).toBeAttached();

        await fillDetails(page);
        await yearly.getByText("Other").click();
        const other = page.getByLabel("Your amount");
        await expect(page.getByText("Whole euros, from €50 to €500 a year.")).toBeVisible();
        await other.fill("40");
        await page.getByRole("button", { name: "Join" }).click();
        await expect(page.getByRole("alert").filter({ hasText: "smallest yearly amount is €50 a year" })).toBeVisible();
        await expect(other).toHaveAttribute("aria-invalid", "true");
        await expect(other).toBeFocused();

        await other.fill("501");
        await page.getByRole("button", { name: "Join" }).click();
        await expect(page.getByText("The most we can take online is €500 a year")).toBeVisible();
        await other.fill("12.50");
        await page.getByRole("button", { name: "Join" }).click();
        await expect(page.getByText("whole number of euros")).toBeVisible();

        await expect(page.locator("#join input[autocomplete^='cc-']")).toHaveCount(0); // no card fields on our page
    });

    test("asks for the details and the terms before opening checkout", async ({ page }) => {
        const requests = await mockWorker(page);
        await page.goto("/membership/#join");
        await page.getByRole("button", { name: "Join" }).click();

        await expect(page.locator("#mf-first-name-error")).toHaveText("Enter your first name.");
        await expect(page.locator("#mf-last-name-error")).toHaveText("Enter your last name.");
        await expect(page.locator("#mf-email-error")).toHaveText("Enter your email address.");
        await expect(page.locator("#mf-terms-error")).toHaveText("Tick the box to agree to the membership terms.");
        await expect(page.getByLabel("First name")).toBeFocused();
        await page.locator("[data-membership-form]").getByLabel("Email", { exact: true }).fill("not-an-email");
        await page.getByRole("button", { name: "Join" }).click();
        await expect(page.locator("#mf-email-error")).toContainText("right format");
        expect(requests).toEqual([]);

        await expect(page.getByRole("link", { name: /membership terms/ }).first()).toHaveAttribute("href", "/membership-terms/");
        await expect(page.getByLabel("Keep me posted about Cork Vegans events by email")).not.toBeChecked();
    });

    test("opens checkout in a modal with the amount, and closing it destroys the session", async ({ page, isMobile }) => {
        const requests = await mockWorker(page);
        await page.goto("/membership/#join");
        const destroyed = () => page.evaluate(() => (window as unknown as { __destroyed?: number }).__destroyed ?? 0);

        await page.getByRole("group", { name: "Monthly amount" }).getByText("€15").click();
        await fillDetails(page);
        await page.getByLabel("Keep me posted about Cork Vegans events by email").check();
        await page.getByRole("button", { name: "Join" }).click();

        const dialog = page.getByRole("dialog", { name: "Join for €15 a month" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Join for €15 a month" })).toBeFocused();
        await expect(dialog.locator("[data-fake-checkout]")).toHaveText("Fake checkout pk_test_fixture cs_test_fake_secret_x");
        expect(requests).toEqual([
            {
                path: "/membership/session",
                body: { frequency: "monthly", amount: 15, firstName: "Aoife", lastName: "Murphy", email: "aoife@example.ie", heardAbout: "A friend", updates: true, terms: true },
            },
        ]);
        if (isMobile) {
            expect((await dialog.boundingBox())!.width).toBe(page.viewportSize()!.width); // full-screen sheet
        } else {
            expect((await dialog.locator(".cv-dialog-panel").boundingBox())!.width).toBeLessThanOrEqual(560);
        }

        await dialog.getByRole("button", { name: "Close" }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole("button", { name: "Join" })).toBeFocused();
        expect(await destroyed()).toBe(1);

        await page.getByRole("button", { name: "Join" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
        expect(await destroyed()).toBe(2);
        expect(requests).toHaveLength(2);
    });

    test("welcomes the new member with their code, copy button and how to use it", async ({ page, context, isMobile }) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await mockWorker(page, { code: (n) => (n < 2 ? { status: 200, json: { status: "pending" } } : { status: 200, json: { status: "ready", code: "CV-7K3P9Q", cardToken: CARD_TOKEN } }) });
        await page.goto("/membership/#join");
        await fillDetails(page);
        await page.getByRole("button", { name: "Join" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Pay now" }).click();

        const welcome = page.locator("[data-membership-success]");
        await expect(welcome).toBeFocused();
        await expect(welcome.getByRole("heading", { name: "Welcome to Cork Vegans!" })).toBeVisible();
        await expect(welcome.locator("[data-member-code]")).toHaveText("CV-7K3P9Q");
        await expect(welcome).toContainText("€5 off one ticket for each paid Cork Vegans event");
        await expect(welcome).toContainText("unlocks member tickets before general release");
        await expect(welcome.getByRole("link", { name: "Book with your member discount" })).toHaveAttribute("href", "/events/");
        expect(await page.evaluate(() => localStorage.getItem("cv-member-code"))).toBe("CV-7K3P9Q");
        await expect(welcome.getByRole("link", { name: "Open your membership card" })).toHaveAttribute("href", `/membership/card/#${CARD_TOKEN}`);
        expect(await page.evaluate(() => localStorage.getItem("cv-card-token"))).toBe(CARD_TOKEN);

        if (!isMobile) {
            await welcome.getByRole("button", { name: "Copy code" }).click();
            await expect(welcome.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("CV-7K3P9Q");
            await page.mouse.click(5, 5); // the backdrop mustn't wipe the welcome
            await expect(welcome).toBeVisible();
        }

        await welcome.getByRole("button", { name: "Close" }).click();
        await expect(page.getByRole("dialog")).toBeHidden();
        await expect(page.getByLabel("First name")).toHaveValue("");
        await expect(page.getByRole("group", { name: "Monthly amount" }).getByRole("radio", { name: "€10 a month" })).toBeChecked();
    });

    test("says the code is on its way by email if it isn't ready", async ({ page }) => {
        await mockWorker(page, { code: () => ({ status: 404, json: { error: "not_found" } }) });
        await page.goto("/membership/#join");
        await fillDetails(page);
        await page.getByRole("button", { name: "Join" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Pay now" }).click();
        await expect(page.locator("[data-code-later]")).toContainText("on its way to you by email");
        await expect(page.locator("[data-code-ready]")).toBeHidden();
    });

    test("shows the fallback error if the Worker fails", async ({ page }) => {
        let status = 502;
        await mockWorker(page, { session: () => ({ status, json: { error: "checkout_unavailable" } }) });
        await page.goto("/membership/#join");
        await fillDetails(page);
        await page.getByRole("button", { name: "Join" }).click();

        const error = page.locator("[data-membership-error]");
        await expect(error).toBeVisible();
        await expect(error).toContainText("couldn't load just now");
        await expect(error.getByRole("link", { name: "crkvgns@gmail.com" })).toHaveAttribute("href", "mailto:crkvgns@gmail.com");
        await expect(page.getByRole("dialog")).toBeHidden(); // errors stay in the card
        await expect(page.getByRole("button", { name: "Join" })).toBeEnabled();

        status = 429;
        await page.getByRole("button", { name: "Join" }).click();
        await expect(error).toContainText("tried a few times in a row");
    });

    test("Lost your code? gives the same answer for any email", async ({ page }) => {
        const requests = await mockWorker(page);
        await page.goto("/membership/#join");
        const lookup = page.locator("[data-lookup-form]");
        await expect(lookup.getByRole("heading", { name: "Lost your code?" })).toBeVisible();

        await lookup.getByRole("button", { name: "Send my code" }).click();
        await expect(lookup.locator("#mf-lookup-email-error")).toHaveText("Enter your email address.");
        expect(requests).toEqual([]);

        await lookup.getByLabel("Email").fill("someone@example.ie");
        await lookup.getByRole("button", { name: "Send my code" }).click();
        await expect(lookup.getByRole("status")).toHaveText("If there's an active membership for that email, we've sent the code. It can take a few minutes to arrive.");
        expect(requests).toEqual([{ path: "/membership/resend", body: { email: "someone@example.ie" } }]);
    });

    test("links members to the portal", async ({ page }) => {
        await mockWorker(page);
        await page.goto("/membership/#join");
        await expect(page.getByRole("link", { name: /Manage or cancel your membership/ })).toHaveAttribute("href", "https://billing.example/login");
    });
});

test("volunteer anchor and form labels", async ({ page }) => {
    await page.goto("/support/#volunteer");
    await expect(page.locator("#volunteer")).toBeInViewport();
    await expect(page.getByLabel("Name *")).toBeVisible();
    await expect(page.getByLabel("Email *")).toBeVisible();
    await expect(page.getByLabel("Message (optional)")).toBeVisible();
    await expect(page.getByRole("group", { name: /Areas you're interested in/ }).getByRole("checkbox")).toHaveCount(7);
    await expect(page.getByText("How we use your details", { exact: true })).toBeVisible();
});

test("shows accessible errors and does not submit an incomplete form", async ({ page }) => {
    let submitted = false;
    await page.route(ENDPOINT, (route) => {
        submitted = true;
        return route.fulfill({ status: 200, json: { ok: true } });
    });
    await page.goto("/support/");
    await page.getByRole("button", { name: "Send enquiry" }).click();

    const summary = page.locator("[data-error-summary]");
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("link")).toHaveCount(3);
    await expect(page.locator("#vf-name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#vf-name-error")).toHaveText("Enter your name.");

    await page.locator("#vf-email").fill("not-an-email");
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await expect(page.locator("#vf-email-error")).toContainText("format");

    await summary.getByRole("link", { name: "Enter your name." }).click();
    await expect(page.locator("#vf-name")).toBeFocused();
    expect(submitted).toBe(false);
});

test("confirms success only after the form service accepts the enquiry", async ({ page }) => {
    let body: Record<string, string> = {};
    await page.route(ENDPOINT, async (route) => {
        body = route.request().postDataJSON();
        await route.fulfill({ status: 200, json: { ok: true } });
    });
    await page.goto("/support/");
    await page.getByLabel("Name *").fill("Aoife Test");
    await page.getByLabel("Email *").fill("aoife@example.ie");
    await page.getByLabel("Photography and video").check();
    await page.getByLabel("Social media and communications").check();
    await page.getByLabel("Message (optional)").fill("Happy to help!");
    await page.getByLabel(/I understand Cork Vegans/).check();
    await page.getByRole("button", { name: "Send enquiry" }).click();

    const success = page.locator("[data-form-success]");
    await expect(success).toBeVisible();
    await expect(success).toBeFocused();
    await expect(page.locator("[data-volunteer-form]")).toBeHidden();
    expect(body).toMatchObject({
        name: "Aoife Test",
        email: "aoife@example.ie",
        interests: "Photography and video, Social media and communications",
        message: "Happy to help!",
        _gotcha: "",
    });
});

test("shows a useful message when the form service fails", async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.fulfill({ status: 422, json: { errors: [{ message: "Form is disabled" }] } }));
    await page.goto("/support/");
    await page.getByLabel("Name *").fill("Aoife");
    await page.getByLabel("Email *").fill("aoife@example.ie");
    await page.getByLabel(/I understand Cork Vegans/).check();
    await page.getByRole("button", { name: "Send enquiry" }).click();

    const summary = page.locator("[data-error-summary]");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("couldn't be sent");
    await expect(summary).toContainText("Form is disabled");
    await expect(page.locator("[data-form-success]")).toBeHidden();
    await expect(page.getByRole("button", { name: "Send enquiry" })).toBeEnabled();
});

test("handles network failure", async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.abort("internetdisconnected"));
    await page.goto("/support/");
    await page.getByLabel("Name *").fill("Aoife");
    await page.getByLabel("Email *").fill("aoife@example.ie");
    await page.getByLabel(/I understand Cork Vegans/).check();
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await expect(page.locator("[data-error-summary]")).toContainText("check your connection");
    await expect(page.locator("[data-form-success]")).toBeHidden();
});
