import { expect, test } from "@playwright/test";

const pages = [
    { path: "/", h1: "Welcome to Cork Vegans" },
    { path: "/events/", h1: "Upcoming events" },
    { path: "/stories/", h1: "Stories & Updates" },
    { path: "/stories/example-community-picnic/", h1: "Example: A sunny community picnic" },
    { path: "/support/", h1: "Support Cork Vegans" },
    { path: "/resources/", h1: "Useful links" },
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
        for (const [label, path] of [["Events", "/events/"], ["Stories", "/stories/"], ["Resources", "/resources/"], ["About", "/about/"]]) {
            await nav.getByRole("link", { name: label }).click();
            await expect(page).toHaveURL(path);
            await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
        }
        await expect(nav.getByRole("link", { name: "Get connected" })).toHaveCount(0);
    });

    test("header stays full height on desktop when scrolling", async ({ page, isMobile }) => {
        test.skip(isMobile, "desktop behaviour");
        await page.goto("/about/");
        await page.mouse.wheel(0, 1500);
        await expect(page.locator("#siteHeader")).toHaveClass(/shadow-md/);
        await expect(page.locator("#headerLogo")).toHaveClass(/h-\[48px\]/);
        expect(Math.round((await page.locator("#headerLogo").boundingBox())!.height)).toBe(48);
    });

    test("header shrinks on mobile when scrolling", async ({ page, isMobile }) => {
        test.skip(!isMobile, "mobile behaviour");
        await page.goto("/about/");
        await page.evaluate(() => window.scrollTo(0, 1500));
        await expect(page.locator("#headerLogo")).toHaveClass(/h-\[36px\]/);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator("#headerLogo")).toHaveClass(/h-\[48px\]/);
    });

    test("the space reserved for the header matches its full size", async ({ page }) => {
        for (const path of ["/", "/about/", "/stories/"]) {
            await page.goto(path);
            const [header, spacer] = await page.evaluate(() => [
                document.getElementById("siteHeader")!.getBoundingClientRect().height,
                document.getElementById("headerSpacer")!.getBoundingClientRect().height,
            ]);
            expect(Math.abs(header - spacer)).toBeLessThanOrEqual(1);
        }
    });

    test("header changes size once when scrolling slowly past the shrink point, without flickering", async ({ page, isMobile }) => {
        test.skip(!isMobile, "only shrinks on mobile");
        await page.goto("/about/");
        await page.evaluate(() => {
            const w = window as unknown as { changes: number };
            w.changes = 0;
            let last = document.getElementById("headerInner")!.classList.contains("py-sm");
            const tick = () => {
                const now = document.getElementById("headerInner")!.classList.contains("py-sm");
                if (now !== last) w.changes++;
                last = now;
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        for (let y = 0; y <= 120; y += 3) {
            await page.evaluate((y) => window.scrollTo(0, y), y);
            await page.waitForTimeout(16);
        }
        await page.waitForTimeout(800);
        expect(await page.evaluate(() => (window as unknown as { changes: number }).changes)).toBe(1);
        // Shrinking doesn't move the page underneath.
        expect(Math.round(await page.evaluate(() => window.scrollY))).toBe(120);
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
        for (const path of ["/", "/events/", "/no-such-page/", "/about/"]) {
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

    test("footer has site links, then social links at the very bottom", async ({ page }) => {
        await page.goto("/about/");
        const footer = page.locator("footer");
        await expect(footer.getByRole("navigation", { name: "Footer" }).getByRole("link")).toHaveText(["Events", "Stories", "Resources", "About", "Contact", "Support us", "Membership terms", "Privacy"]);
        const socials = footer.getByRole("list", { name: "Cork Vegans on social media" }).getByRole("link");
        await expect(socials).toHaveCount(4);
        for (const [name, href] of [
            ["Meetup", "https://www.meetup.com/corkvegans/"],
            ["Eventbrite", "https://www.eventbrite.ie/o/cork-vegans-91797524863"],
            ["Facebook", "https://www.facebook.com/corkvegans/"],
            ["Instagram", "https://www.instagram.com/corkvegans"],
        ]) {
            const link = footer.getByRole("link", { name: new RegExp(`on ${name}`) });
            await expect(link).toHaveAttribute("href", href);
            await expect(link).toHaveAttribute("rel", /noopener/);
        }
        const socialTop = (await socials.first().boundingBox())!.y;
        const copyrightBottom = await footer.getByText(/© \d{4} Cork Vegans/).evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
        expect(socialTop + 0).toBeGreaterThan(copyrightBottom - (await page.evaluate(() => window.scrollY)));
        await footer.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Resources" }).click();
        await expect(page).toHaveURL("/resources/");
    });

    test("resources page lists external links safely", async ({ page }) => {
        await page.goto("/resources/");
        const tiles = page.locator("main ul a");
        await expect(tiles).toHaveCount(2);
        await expect(page.getByRole("link", { name: /WhatsApp community/ })).toHaveAttribute("href", "https://chat.whatsapp.com/GLVQxJC9qCFK4xGSUafwo3");
        await expect(page.getByRole("link", { name: /Cork vegan food map/ })).toHaveAttribute("href", "https://maps.app.goo.gl/2pRjVTprqDZsYrKp8");
        for (const tile of await tiles.all()) {
            await expect(tile).toHaveAttribute("target", "_blank");
            await expect(tile).toHaveAttribute("rel", /noopener/);
        }
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
