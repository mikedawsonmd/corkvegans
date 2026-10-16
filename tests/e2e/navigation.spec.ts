import { expect, test } from "@playwright/test";

const pages = [
    { path: "/", h1: "Welcome to Cork Vegans" },
    { path: "/events/", h1: "Upcoming events" },
    { path: "/stories/", h1: "Stories & Updates" },
    { path: "/stories/page/2/", h1: "Stories & Updates" },
    { path: "/stories/example-community-picnic/", h1: "Example: A sunny community picnic" },
    { path: "/support/", h1: "Support Cork Vegans" },
    { path: "/about/", h1: "About Cork Vegans" },
];

test.describe("pages load directly", () => {
    for (const p of pages) {
        test(`${p.path} loads with one h1`, async ({ page }) => {
            const res = await page.goto(p.path);
            expect(res?.status()).toBe(200);
            await expect(page.locator("h1")).toHaveCount(1);
            await expect(page.locator("h1")).toHaveText(p.h1);
            await expect(page.locator("footer")).toBeVisible();
        });
    }

    test("unknown URLs show the 404 page", async ({ page }) => {
        const res = await page.goto("/no-such-page/");
        expect(res?.status()).toBe(404);
        await expect(page.locator("h1")).toHaveText("Page not found");
    });

    test("no broken images or failed asset requests", async ({ page }) => {
        for (const p of pages) {
            const failed: string[] = [];
            page.on("response", (r) => {
                if (r.url().startsWith("http://localhost") && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
            });
            await page.goto(p.path, { waitUntil: "networkidle" });
            const broken = await page.$$eval("img", (imgs) =>
                imgs.filter((i) => i.loading !== "lazy" && i.complete && i.naturalWidth === 0).map((i) => i.src),
            );
            expect(broken, `${p.path} broken images`).toEqual([]);
            expect(failed, `${p.path} failed requests`).toEqual([]);
            page.removeAllListeners("response");
        }
    });
});

test.describe("navigation", () => {
    test("desktop nav links work and show the active page", async ({ page, isMobile }) => {
        test.skip(isMobile, "desktop navigation");
        await page.goto("/");
        const nav = page.getByRole("navigation", { name: "Main" });
        for (const [label, path] of [["Events", "/events/"], ["Stories", "/stories/"], ["About", "/about/"]]) {
            await nav.getByRole("link", { name: label }).click();
            await expect(page).toHaveURL(path);
            await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
        }
        await nav.getByRole("link", { name: "Get connected" }).click();
        await expect(page).toHaveURL("/#communityLinks");
        await expect(page.locator("#communityLinks")).toBeInViewport();
    });

    test("'Support us' is the primary header action on every page", async ({ page }) => {
        for (const path of ["/", "/events/", "/stories/", "/about/"]) {
            await page.goto(path);
            const cta = page.locator("#headerButton");
            await expect(cta).toHaveText("Support us");
            await expect(cta).toHaveClass(/cv-btn-primary/);
            await expect(cta).toBeVisible();
        }
        await page.locator("#headerButton").click();
        await expect(page).toHaveURL("/support/");
        await expect(page.locator("#headerButton")).toHaveAttribute("aria-current", "page");
    });

    test("header and logo sit in the same place on short and long pages", async ({ page, isMobile }) => {
        test.skip(isMobile, "desktop layout");
        await page.setViewportSize({ width: 1920, height: 1400 });
        const positions = new Set<string>();
        for (const path of ["/", "/stories/page/2/", "/no-such-page/", "/about/"]) {
            await page.goto(path);
            positions.add(await page.evaluate(() => {
                const logo = document.getElementById("headerLogo")!.getBoundingClientRect();
                const cta = document.getElementById("headerButton")!.getBoundingClientRect();
                return `${Math.round(logo.x)} ${Math.round(logo.height)} ${Math.round(cta.right)}`;
            }));
        }
        expect([...positions]).toHaveLength(1);
    });

    test("mobile menu opens, closes with Escape and returns focus", async ({ page, isMobile }) => {
        test.skip(!isMobile, "mobile navigation");
        await page.goto("/");
        const button = page.getByRole("button", { name: "Menu" });
        await expect(button).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator("#mobileMenu")).toBeHidden();

        await button.click();
        await expect(button).toHaveAttribute("aria-expanded", "true");
        const menu = page.locator("#mobileMenu");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("link")).toHaveCount(4);

        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(button).toBeFocused();

        await button.click();
        await menu.getByRole("link", { name: "Stories" }).click();
        await expect(page).toHaveURL("/stories/");
        await expect(page.locator("#mobileMenu a[aria-current=page]")).toHaveText("Stories");
    });

    test("menu is keyboard operable", async ({ page, isMobile }) => {
        test.skip(!isMobile, "mobile navigation");
        await page.goto("/");
        await page.getByRole("button", { name: "Menu" }).focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#mobileMenu")).toBeVisible();
        await page.keyboard.press("Tab");
        await expect(page.locator("#mobileMenu a").first()).toBeFocused();
    });

    test("skip link moves focus to main content", async ({ page }) => {
        await page.goto("/events/");
        await page.keyboard.press("Tab");
        const skip = page.getByRole("link", { name: "Skip to main content" });
        await expect(skip).toBeFocused();
        await expect(skip).toBeInViewport();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/#main$/);
    });

    test("footer links and 'Get connected' resolve from inner pages", async ({ page }) => {
        await page.goto("/about/");
        await page.locator("footer").getByRole("link", { name: "Get connected" }).click();
        await expect(page).toHaveURL("/#communityLinks");
        await expect(page.locator("#communityLinks")).toBeInViewport();
    });
});

test.describe("responsive layout", () => {
    for (const width of [320, 375, 768, 1024, 1440, 1920]) {
        test(`no horizontal scrolling at ${width}px`, async ({ page, isMobile }) => {
            test.skip(isMobile, "viewport set explicitly");
            await page.setViewportSize({ width, height: 900 });
            for (const p of pages) {
                await page.goto(p.path);
                const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
                expect(overflow, `${p.path} at ${width}px`).toBeLessThanOrEqual(0);
            }
        });
    }
});
