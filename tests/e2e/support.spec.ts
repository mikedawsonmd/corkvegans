import { expect, test } from "@playwright/test";

const ENDPOINT = "https://formspree.io/f/testfixture";

test("donation section offers one-off and monthly options via the hosted provider", async ({ page }) => {
    await page.goto("/support/#donate");
    await expect(page.locator("#donate")).toBeInViewport();
    await expect(page.locator('[data-donate="once"]')).toHaveAttribute("href", "https://donate.example/once");
    const monthly = page.getByRole("group", { name: "Choose a monthly amount" }).getByRole("link");
    await expect(monthly).toHaveCount(2);
    await expect(monthly.first()).toHaveAccessibleName("€5 a month (continues to Test Provider)");
    await expect(monthly.first()).toHaveAttribute("href", "https://donate.example/monthly-5");
    await expect(page.getByRole("link", { name: /Manage or cancel your donation/ })).toHaveAttribute("href", "https://donate.example/manage");
    await expect(page.locator("#donate a[target]")).toHaveCount(0); // same tab
    await expect(page.getByText(/never sees or stores your card details/)).toBeVisible();
    await expect(page.locator("#donate input")).toHaveCount(0); // no card fields on our site
});

test("donation thank-you page links back and is hidden from search", async ({ page }) => {
    await page.goto("/support/thanks/");
    await expect(page.getByRole("heading", { level: 1, name: "Thank you!" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.getByRole("link", { name: "See upcoming events" })).toHaveAttribute("href", "/events/");
    await expect(page.getByRole("link", { name: "Go to the homepage" })).toHaveAttribute("href", "/");
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
