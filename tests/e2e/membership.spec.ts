import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { features } from "../../src/config/site.ts";

const WORKER = "https://membership.example";
const TOKEN = "sub_1TestMember00.AbCdEfGhIjKlMnOpQrStUv";

test.describe("partner discounts", () => {
    test("lists shown partners in name order, without hidden or unfinished ones", async ({ page }) => {
        await page.goto("/membership/#partners");
        const list = page.locator("[data-partner-list] > li");
        await expect(list).toHaveCount(2);
        await expect(list.locator("h3")).toHaveText(["allotment Shop", "Green Bean Café"]);
        await expect(page.getByText("Hidden Bakery")).toHaveCount(0);
        await expect(page.getByText("Unfinished Entry")).toHaveCount(0);

        const cafe = list.nth(1);
        await expect(cafe).toContainText("10% off food and drinks");
        await expect(cafe).toContainText("Cork city centre");
        await expect(cafe).toContainText("Show your membership card when you pay.");
        await expect(cafe.getByRole("img", { name: "Green Bean Café logo" })).toBeVisible();
        await expect(cafe.getByRole("link", { name: /Visit Green Bean Café/ })).toHaveAttribute("href", "https://example.com/green-bean");

        const shop = list.nth(0);
        await expect(shop).toContainText("Mention Cork Vegans at the till.");
        await expect(shop.getByRole("link")).toHaveCount(0); // its website isn't https
    });

    test("asks businesses to become partners", async ({ page }) => {
        await page.goto("/membership/");
        const box = page.locator("[data-become-partner]");
        await expect(box.getByRole("heading", { name: "Run a local business?" })).toBeVisible();
        await expect(box.getByRole("link", { name: "Become a partner" })).toHaveAttribute("href", "/about/?topic=partner#contact");
    });

    test("Membership is in the main menu", async ({ page, isMobile }) => {
        test.skip(isMobile, "desktop navigation");
        await page.goto("/");
        await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Membership" }).click();
        await expect(page).toHaveURL(/\/membership\/$/);
    });
});

test.describe("membership card", () => {
    test.skip(!features.payments, "features.payments is off");

    type Reply = { status: number; json: unknown };
    async function mockCard(page: Page, reply: () => Reply) {
        const tokens: string[] = [];
        await page.route(`${WORKER}/membership/card`, (route) => {
            tokens.push(route.request().postDataJSON().token);
            const { status, json } = reply();
            return route.fulfill({ status, json, headers: { "Access-Control-Allow-Origin": "*" } });
        });
        return tokens;
    }

    const thisMonth = () => new Date().toLocaleDateString("en-IE", { month: "long", timeZone: "Europe/Dublin" });
    const thisYear = () => new Date().toLocaleDateString("en-IE", { year: "numeric", timeZone: "Europe/Dublin" });

    test("shows the name, this month and year, a ticking clock and a QR code for the check page", async ({ page }) => {
        const tokens = await mockCard(page, () => ({ status: 200, json: { status: "valid", firstName: "Aoife" } }));
        await page.goto(`/membership/card/#${TOKEN}`);
        const card = page.getByRole("article", { name: "Cork Vegans member" });
        await expect(card).toBeVisible();
        await expect(card.locator("[data-card-name]")).toHaveText("Aoife");
        await expect(card.locator("[data-card-month]")).toHaveText(thisMonth());
        await expect(card.locator("[data-card-year]")).toHaveText(thisYear());
        await expect(card.getByRole("img", { name: "QR code for businesses to check this card" }).locator("svg")).toBeVisible();
        const clock = card.locator("[data-card-clock]");
        const first = await clock.textContent();
        await expect(clock).not.toHaveText(first ?? "", { timeout: 3000 });
        expect(tokens[0]).toBe(TOKEN);
        // The address keeps the token, for home-screen shortcuts, and it's saved for the Membership page.
        await expect(page).toHaveURL(new RegExp(`/membership/card/#${TOKEN.replace(".", "\\.")}$`));
        expect(await page.evaluate(() => localStorage.getItem("cv-card-token"))).toBe(TOKEN);

        await page.goto("/membership/#card");
        await page.getByRole("link", { name: "Open my card" }).click();
        await expect(page).toHaveURL(new RegExp(`/membership/card/#${TOKEN.replace(".", "\\.")}$`));
        await expect(page.locator("[data-card-name]")).toHaveText("Aoife");
    });

    test("says when a cancelled membership ends, and stops showing the month once it has", async ({ page }) => {
        let status = "valid";
        await mockCard(page, () => ({ status: 200, json: status === "valid" ? { status, firstName: "Aoife", endsOn: "2027-01-15" } : { status } }));
        await page.goto(`/membership/card/#${TOKEN}`);
        await expect(page.locator("[data-card-ends]")).toHaveText("Membership ends 15 January 2027");
        status = "ended";
        await page.reload();
        await expect(page.getByRole("heading", { name: "Your membership has ended" })).toBeVisible();
        await expect(page.locator("[data-card-month]")).toBeHidden();
    });

    test("without a link, or with a wrong one, points to the welcome email", async ({ page }) => {
        await mockCard(page, () => ({ status: 404, json: { error: "not_found" } }));
        await page.goto("/membership/card/");
        await expect(page.getByRole("heading", { name: "Open your card from your welcome email" })).toBeVisible();
        await page.goto(`/membership/card/#${TOKEN}`);
        await expect(page.getByRole("heading", { name: "Open your card from your welcome email" })).toBeVisible();
    });

    test("offline, shows this month's last answer, or asks to try again", async ({ page }) => {
        let up = true;
        await mockCard(page, () => (up ? { status: 200, json: { status: "valid", firstName: "Aoife" } } : { status: 502, json: { error: "unavailable" } }));
        await page.goto(`/membership/card/#${TOKEN}`);
        await expect(page.locator("[data-card-name]")).toHaveText("Aoife");
        up = false;
        await page.reload();
        await expect(page.locator("[data-card-name]")).toHaveText("Aoife");
        await expect(page.locator("[data-card-offline]")).toContainText("Offline: last checked");

        // Last month's answer doesn't count.
        await page.evaluate(() => {
            const cached = JSON.parse(localStorage.getItem("cv-card-status") ?? "{}");
            localStorage.setItem("cv-card-status", JSON.stringify({ ...cached, checkedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }));
        });
        await page.reload();
        await expect(page.getByRole("alert").getByRole("heading", { name: "We couldn't load your card" })).toBeVisible();
        up = true;
        await page.getByRole("button", { name: "Try again" }).click();
        await expect(page.locator("[data-card-name]")).toHaveText("Aoife");
    });

    test("the card and the check page have no automatically detectable WCAG 2.2 AA violations", async ({ page }) => {
        await mockCard(page, () => ({ status: 200, json: { status: "valid", firstName: "Aoife", endsOn: "2027-01-15" } }));
        for (const path of ["/membership/card/", "/membership/check/"]) {
            await page.goto(`${path}#${TOKEN}`);
            await expect(page.locator("[data-state='valid']")).toBeAttached();
            const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
            expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
        }
    });

    test("the check page tells a business whether the card is valid", async ({ page }) => {
        let reply: Reply = { status: 200, json: { status: "valid", firstName: "Aoife" } };
        await mockCard(page, () => reply);
        await page.goto(`/membership/check/#${TOKEN}`);
        await expect(page.getByRole("heading", { name: "Valid member" })).toBeVisible();
        await expect(page.getByText("Aoife", { exact: true })).toBeVisible();
        await expect(page.getByText(/^Checked /).first()).toBeVisible();
        // Nothing about the card is saved on the business's phone.
        expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /card|member/.test(k)))).toEqual([]);

        reply = { status: 200, json: { status: "ended" } };
        await page.reload();
        await expect(page.getByRole("heading", { name: "Not a current member" })).toBeVisible();

        reply = { status: 404, json: { error: "not_found" } };
        await page.reload();
        await expect(page.getByRole("heading", { name: "Not a valid card" })).toBeVisible();
        await page.goto("/membership/check/#not-a-token");
        await expect(page.getByRole("heading", { name: "Not a valid card" })).toBeVisible();

        reply = { status: 502, json: { error: "unavailable" } };
        await page.goto(`/membership/check/#${TOKEN}`);
        await expect(page.getByRole("heading", { name: "We couldn't check right now" })).toBeVisible();
        reply = { status: 200, json: { status: "valid", firstName: "Aoife" } };
        await page.getByRole("button", { name: "Try again" }).click();
        await expect(page.getByRole("heading", { name: "Valid member" })).toBeVisible();
    });
});
