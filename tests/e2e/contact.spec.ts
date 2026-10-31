import { expect, test, type Page } from "@playwright/test";

const ENDPOINT = "https://formspree.io/f/contactfixture";

/** Opens the contact form on a fake clock, so tests can skip past the too-fast spam check. */
async function openForm(page: Page, path = "/about/#contact") {
    await page.clock.install();
    await page.goto(path);
}

async function fillValid(page: Page) {
    await page.getByLabel("Name *").fill("Aoife Test");
    await page.getByLabel("Email *").fill("aoife@example.ie");
    await page.getByLabel("What's it about?").selectOption("recommend");
    await page.getByLabel("Message *").fill("The new café on Princes Street has amazing vegan pastries.");
    await page.getByLabel("Link (optional)").fill("example-cafe.ie");
    await page.getByLabel(/I understand Cork Vegans will use these details/).check();
}

test("the About page has a contact section with topics and a privacy note", async ({ page }) => {
    await page.goto("/about/#contact");
    await expect(page.locator("#contact")).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Get in touch" })).toBeVisible();
    await expect(page.getByLabel("What's it about?").locator("option")).toHaveCount(9);
    await expect(page.locator("#contact").getByText("How we use your details")).toBeVisible();
    await expect(page.getByRole("link", { name: "volunteer form" })).toHaveAttribute("href", "/support/#volunteer");
});

test("links elsewhere on the site open the form with the right topic", async ({ page }) => {
    await page.goto("/events/");
    await page.getByRole("link", { name: "Suggest one" }).click();
    await expect(page).toHaveURL("/about/?topic=event#contact");
    await expect(page.getByLabel("What's it about?")).toHaveValue("event");
    await expect(page.locator("[data-topic-hint]")).toContainText("roughly where and when");

    await page.goto("/stories/");
    await expect(page.getByRole("link", { name: "Tell us" })).toHaveAttribute("href", "/about/?topic=story#contact");
    await page.goto("/resources/");
    await expect(page.getByRole("link", { name: "Recommend it" })).toHaveAttribute("href", "/about/?topic=recommend#contact");

    await page.goto("/membership/#partners");
    await page.getByRole("link", { name: "Become a partner" }).click();
    await expect(page).toHaveURL("/about/?topic=partner#contact");
    await expect(page.getByLabel("What's it about?")).toHaveValue("partner");
    await expect(page.getByLabel("What's it about?").locator("option:checked")).toHaveText("Discount partnership");
    await expect(page.locator("[data-topic-hint]")).toContainText("the discount you'd like to offer Cork Vegans members");
    await expect(page.locator("footer").getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/about/#contact");
});

test("the hint under the message follows the chosen topic", async ({ page }) => {
    await page.goto("/about/#contact");
    await page.getByLabel("What's it about?").selectOption("press");
    await expect(page.locator("[data-topic-hint]")).toContainText("deadline");
});

test("shows accessible errors and sends nothing when incomplete", async ({ page }) => {
    let sent = false;
    await page.route(ENDPOINT, (route) => {
        sent = true;
        return route.fulfill({ status: 200, json: { ok: true } });
    });
    await openForm(page);
    await page.getByRole("button", { name: "Send message" }).click();
    const summary = page.locator("#contact [data-error-summary]");
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("link")).toHaveCount(4);
    await expect(page.locator("#cf-message")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Link (optional)").fill("not a link");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator("#cf-link-error")).toContainText("web address");
    expect(sent).toBe(false);
});

test("sends the message, with the topic in the subject, and confirms only once accepted", async ({ page }) => {
    let body: Record<string, string> = {};
    await page.route(ENDPOINT, async (route) => {
        body = route.request().postDataJSON();
        await route.fulfill({ status: 200, json: { ok: true } });
    });
    await openForm(page);
    await fillValid(page);
    await page.clock.fastForward(6000);
    await page.getByRole("button", { name: "Send message" }).click();

    const success = page.locator("#contact [data-form-success]");
    await expect(success).toBeFocused();
    await expect(success).toContainText("we've received your message");
    expect(body).toEqual({
        name: "Aoife Test",
        email: "aoife@example.ie",
        topic: "Recommend a business, restaurant or product",
        message: "The new café on Princes Street has amazing vegan pastries.",
        link: "example-cafe.ie",
        privacy: "acknowledged",
        _gotcha: "",
        _subject: "Contact: Recommend a business, restaurant or product",
    });
});

test("quietly drops submissions sent too fast or with the spam trap filled", async ({ page }) => {
    let sent = 0;
    await page.route(ENDPOINT, (route) => {
        sent++;
        return route.fulfill({ status: 200, json: { ok: true } });
    });
    await openForm(page);
    await fillValid(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator("#contact [data-form-success]")).toBeVisible();

    // A different address, so the page really reloads (a #hash change alone doesn't).
    await openForm(page, "/about/?topic=other#contact");
    await fillValid(page);
    await page.locator("#cf-gotcha").evaluate((el: HTMLInputElement) => (el.value = "cheap pills"));
    await page.clock.fastForward(60_000);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator("#contact [data-form-success]")).toBeVisible();
    expect(sent).toBe(0);
});

test("keeps the message and explains when sending fails", async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.fulfill({ status: 422, json: { errors: [{ message: "Form is disabled" }] } }));
    await openForm(page);
    await fillValid(page);
    await page.clock.fastForward(6000);
    await page.getByRole("button", { name: "Send message" }).click();
    const summary = page.locator("#contact [data-error-summary]");
    await expect(summary).toContainText("couldn't be sent");
    await expect(summary).toContainText("Form is disabled");
    await expect(page.getByLabel("Message *")).toHaveValue("The new café on Princes Street has amazing vegan pastries.");
});
