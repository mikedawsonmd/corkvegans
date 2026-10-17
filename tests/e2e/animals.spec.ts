import { expect, test, type Page } from "@playwright/test";

/** Every placement on the page: the footer group first, then the groups around the page. */
const placements = (page: Page) =>
    page.evaluate(() => {
        const footer = document.querySelector("[data-animal-footer]")!;
        const groups = [footer, ...document.querySelectorAll(".cv-animal-group")];
        return groups.map((g) => {
            const spot = g.parentElement!;
            const edge = spot.dataset.animalSpot === "floor" ? "bottom" : "top";
            return {
                animals: [...g.children].map((c) => (c as HTMLElement).style.getPropertyValue("--cv-animal-src").match(/(\w+)\.svg/)?.[1]),
                y: spot.getBoundingClientRect()[edge] + window.scrollY,
            };
        });
    });

test("footer shows a group of 2–3 animals, different on each reload", async ({ page }) => {
    let previous = "";
    for (let i = 0; i < 6; i++) {
        await page.goto("/");
        const [footer] = await placements(page);
        expect(footer.animals.length).toBeGreaterThanOrEqual(2);
        expect(footer.animals.length).toBeLessThanOrEqual(3);
        const key = [...footer.animals].sort().join();
        expect(key).not.toBe(previous);
        previous = key;
    }
});

for (const path of ["/", "/about/", "/events/", "/stories/", "/support/", "/resources/"]) {
    test(`${path}: animals are never repeated, come in groups and are spaced apart`, async ({ page }) => {
        for (let i = 0; i < 5; i++) {
            await page.goto(path);
            const all = await placements(page);
            const names = all.flatMap((p) => p.animals);
            expect(new Set(names).size).toBe(names.length);
            for (const p of all) expect(p.animals.length).toBeGreaterThanOrEqual(2);
            // Spots are 300px apart when picked; a heading bar that gains an
            // animal then pushes later content down a little, so allow slack.
            for (let a = 0; a < all.length; a++) {
                for (let b = a + 1; b < all.length; b++) expect(Math.abs(all[a].y - all[b].y)).toBeGreaterThanOrEqual(250);
            }
        }
    });
}

test("animal illustrations are decorative and can't be dragged or saved", async ({ page }) => {
    await page.goto("/support/");
    expect(await page.locator("img[src*='/illustrations/']").count()).toBe(0);
    const animals = page.locator(".cv-animal");
    expect(await animals.count()).toBeGreaterThan(0);
    for (const el of await animals.all()) {
        expect(await el.evaluate((e) => e.closest("[aria-hidden='true']") !== null)).toBe(true);
    }
    for (const group of await page.locator(".cv-animal-group").all()) {
        expect(await group.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
    }
});
