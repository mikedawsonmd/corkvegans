import { expect, test, type Page } from "@playwright/test";
import { features } from "../../src/config/site.ts";

const ENDPOINT = "https://formspree.io/f/testfixture";

test("membership: coming soon, with no payment form, Stripe or Worker calls", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
        if (/stripe\.com|\/donate\/session/.test(r.url())) external.push(r.url());
    });
    await page.goto("/support/");

    const nav = page.getByRole("navigation", { name: "On this page" });
    await expect(nav.getByRole("link", { name: "Membership" })).toHaveAttribute("href", "#membership");
    await expect(nav.getByRole("link", { name: "Volunteer" })).toHaveAttribute("href", "#volunteer");

    const section = page.locator("#membership");
    await expect(section.getByRole("heading", { level: 2, name: "Membership" })).toBeVisible();
    await expect(section).toContainText("Cork Vegans membership is coming soon");
    await expect(section).toContainText("Membership will help us with things like:");
    await expect(section.getByRole("listitem")).toHaveCount(4);

    if (!features.payments) {
        await expect(section.getByText("Coming soon", { exact: true })).toBeVisible();
        await expect(page.locator("[data-donate-root], [data-donate-dialog], [data-donate-fallback], [data-donate-manage]")).toHaveCount(0);
        await expect(page.getByText(/Stripe|donat/i)).toHaveCount(0);
        await page.waitForLoadState("networkidle");
        expect(external).toEqual([]);
    }
});

test("membership: old #donate links still land on the section", async ({ page }) => {
    await page.goto("/support/#donate");
    await expect(page.locator("#membership-heading")).toBeInViewport();
});

test("home page points to membership", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("link", { name: /^Membership/ });
    await expect(card).toHaveAttribute("href", "/support/#membership");
    await expect(card).toContainText("Membership coming soon. Become a member to help keep our events going.");
    await card.click();
    await expect(page.locator("#membership-heading")).toBeInViewport();
});

test("the old donation thank-you page is gone", async ({ page }) => {
    const res = await page.goto("/support/thanks/");
    expect(res?.status()).toBe(404);
});

// The payment form is kept for membership but switched off (features.payments
// in src/config/site.ts). These run again as soon as it's switched back on.
test.describe("payment form", () => {
    test.skip(!features.payments, "features.payments is off");

    const SESSION_ENDPOINT = "https://donate.example/donate/session";

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

    async function mockStripe(page: Page, worker: (body: Record<string, unknown>) => { status: number; json: unknown } = () => ({ status: 200, json: { clientSecret: "cs_test_fake" } })) {
        const requests: Record<string, unknown>[] = [];
        await page.route("https://js.stripe.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_STRIPE_JS }));
        await page.route(SESSION_ENDPOINT, (route) => {
            const body = route.request().postDataJSON();
            requests.push(body);
            const { status, json } = worker(body);
            return route.fulfill({ status, json, headers: { "Access-Control-Allow-Origin": "*" } });
        });
        return requests;
    }

    test("donation form: monthly by default, with once amounts and limits", async ({ page }) => {
        await mockStripe(page);
        await page.goto("/support/#membership");
        await expect(page.locator("#donate")).toBeInViewport();

        const often = page.getByRole("group", { name: "How often?" });
        await expect(often.getByRole("radio", { name: "Monthly" })).toBeChecked();
        const monthly = page.getByRole("group", { name: "Monthly amount" });
        await expect(monthly.getByRole("radio")).toHaveCount(4);
        await expect(monthly.getByRole("radio", { name: "€10 a month" })).toBeChecked();

        await often.getByText("Once").click();
        await expect(page.getByRole("group", { name: "Monthly amount" })).toBeHidden();
        const once = page.getByRole("group", { name: "One-off amount" });
        for (const name of ["€10", "€20", "€50", "Other"]) await expect(once.getByRole("radio", { name, exact: true })).toBeAttached();
        await expect(once.getByRole("radio", { name: "€20", exact: true })).toBeChecked();

        await once.getByText("Other").click();
        const other = page.getByLabel("Other amount");
        await other.fill("1");
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByRole("alert").filter({ hasText: "smallest donation" })).toBeVisible();
        await expect(other).toHaveAttribute("aria-invalid", "true");
        await expect(other).toBeFocused();

        await other.fill("501");
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText("The most you can give online is €500")).toBeVisible();
        await other.fill("12.50");
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText("whole number of euros")).toBeVisible();

        await expect(page.getByRole("link", { name: /Manage or cancel your donation/ })).toHaveAttribute("href", "https://donate.example/manage");
        await expect(page.locator("#donate input[autocomplete^='cc-']")).toHaveCount(0); // no card fields on our page
    });

    test("donation form: opens checkout in a modal; closing it destroys the session", async ({ page, isMobile }) => {
        const requests = await mockStripe(page);
        await page.goto("/support/#membership");
        const destroyed = () => page.evaluate(() => (window as unknown as { __destroyed?: number }).__destroyed ?? 0);

        await page.getByRole("group", { name: "Monthly amount" }).getByText("€20").click();
        await page.getByRole("button", { name: "Continue" }).click();

        const dialog = page.getByRole("dialog", { name: "Donate €20 a month" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Donate €20 a month" })).toBeFocused();
        await expect(dialog.locator("[data-fake-checkout]")).toHaveText("Fake checkout pk_test_fixture cs_test_fake");
        await expect(page.locator("[data-donate-form]")).toBeVisible(); // the card behind is unchanged
        const scrollBefore = await page.evaluate(() => -parseInt(document.body.style.top, 10)); // page is locked here
        expect(scrollBefore).toBeGreaterThan(0);
        expect(requests).toEqual([{ frequency: "monthly", amount: 20 }]);
        if (isMobile) {
            const box = (await dialog.boundingBox())!;
            expect(box.width).toBe(page.viewportSize()!.width); // full-screen sheet
        } else {
            expect((await dialog.locator(".cv-dialog-panel").boundingBox())!.width).toBeLessThanOrEqual(560);
        }

        // X closes, destroys the checkout, returns focus and restores the scroll position.
        await dialog.getByRole("button", { name: "Close" }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();
        expect(await destroyed()).toBe(1);
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        await expect(page.locator("[data-fake-checkout]")).toHaveCount(0);

        // Escape closes too, and the next open creates a fresh session.
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
        expect(await destroyed()).toBe(2);
        expect(requests).toHaveLength(2);

        // So does clicking the dimmed backdrop (desktop only: on mobile the sheet fills the screen).
        if (!isMobile) {
            await page.getByRole("button", { name: "Continue" }).click();
            await expect(page.getByRole("dialog")).toBeVisible();
            await page.mouse.click(5, 5);
            await expect(page.getByRole("dialog")).toBeHidden();
            expect(await destroyed()).toBe(3);
        }
    });

    test("donation form: shows thanks in the modal, then resets the form", async ({ page, isMobile }) => {
        const requests = await mockStripe(page);
        await page.goto("/support/#membership");

        await page.getByRole("group", { name: "How often?" }).getByText("Once").click();
        await page.getByRole("group", { name: "One-off amount" }).getByText("Other").click();
        await page.getByLabel("Other amount").fill("€35");
        await page.getByRole("button", { name: "Continue" }).click();
        expect(requests.at(-1)).toEqual({ frequency: "once", amount: 35 });

        const dialog = page.getByRole("dialog", { name: "Donate €35" });
        await dialog.getByRole("button", { name: "Pay now" }).click();
        const thanks = dialog.locator("[data-donate-success]");
        await expect(thanks).toBeFocused();
        await expect(thanks.getByRole("heading", { name: "Thank you!" })).toBeVisible();
        await expect(thanks).toContainText("receipt is on its way to you by email");
        await expect(thanks.getByRole("link", { name: /manage your donation/ })).toBeHidden(); // one-off gift
        await expect(dialog.locator("[data-fake-checkout]")).toHaveCount(0);

        if (!isMobile) {
            await page.mouse.click(5, 5); // the backdrop mustn't wipe the thank-you
            await expect(thanks).toBeVisible();
        }

        await thanks.getByRole("button", { name: "Close" }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();
        await expect(page.getByRole("group", { name: "How often?" }).getByRole("radio", { name: "Monthly" })).toBeChecked();
        await expect(page.getByRole("group", { name: "Monthly amount" }).getByRole("radio", { name: "€10 a month" })).toBeChecked();
        await expect(page.getByLabel("Other amount")).toBeHidden();
    });

    test("donation form: monthly donors get the manage link after paying", async ({ page }) => {
        await mockStripe(page);
        await page.goto("/support/#membership");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Pay now" }).click();
        await expect(page.getByRole("dialog").locator("[data-donate-success]").getByRole("link", { name: /manage your donation/ })).toHaveAttribute("href", "https://donate.example/manage");
    });

    test("donation form: offers the Stripe page if the Worker fails", async ({ page }) => {
        let status = 502;
        await mockStripe(page, () => ({ status, json: { error: "checkout_unavailable" } }));
        await page.goto("/support/#membership");
        await page.getByRole("button", { name: "Continue" }).click();

        const error = page.locator("[data-donate-error]");
        await expect(error).toBeVisible();
        await expect(error).toContainText("couldn't load just now");
        await expect(error.getByRole("link", { name: /donate directly on Stripe/ })).toHaveAttribute("href", "https://donate.example/once");
        await expect(page.locator("[data-donate-form]")).toBeVisible();
        await expect(page.getByRole("dialog")).toBeHidden(); // errors stay in the card
        await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

        status = 429;
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(error).toContainText("tried a few times in a row");
    });
});

test("volunteer anchor and form labels", async ({ page }) => {
    await page.goto("/support/#volunteer");
    await expect(page.locator("#volunteer")).toBeInViewport();
    await expect(page.getByLabel("Name *")).toBeVisible();
    await expect(page.getByLabel("Email *")).toBeVisible();
    await expect(page.getByLabel("Message (optional)")).toBeVisible();
    await expect(page.getByRole("group", { name: /Areas you're interested in/ }).getByRole("checkbox")).toHaveCount(7);
    await expect(page.getByText("How we use your details")).toBeVisible();
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
