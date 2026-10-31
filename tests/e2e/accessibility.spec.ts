import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const paths = ["/", "/events/", "/stories/", "/stories/example-community-picnic/", "/stories/example-no-image-review/", "/support/", "/membership/", "/resources/", "/about/", "/no-such-page/"];

for (const path of paths) {
    test(`${path} has no automatically detectable WCAG 2.2 AA violations`, async ({ page }) => {
        await page.goto(path);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
        expect(summary).toEqual([]);
    });
}

test("open mobile menu has no violations", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile only");
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("focus is visible on interactive elements", async ({ page }) => {
    await page.goto("/support/");
    await page.locator("#vf-name").focus();
    const outline = await page.locator("#vf-name").evaluate((el) => {
        const s = getComputedStyle(el);
        return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`;
    });
    expect(outline).not.toBe("none 0px none");
    await page.keyboard.press("Shift+Tab");
    const focusedOutline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(focusedOutline).not.toBe("none");
});

test("respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const duration = await page.locator(".animate-float").first().evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.1);
});
