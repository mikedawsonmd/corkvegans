import { expect, test } from "@playwright/test";

const paths = ["/", "/events/", "/stories/", "/stories/example-community-picnic/", "/support/", "/about/", "/no-such-page/"];

test.describe("buttons use the shared style", () => {
    for (const path of paths) {
        test(`${path}`, async ({ page }) => {
            await page.goto(path);
            const problems = await page.evaluate(() => {
                const out: string[] = [];
                const describe = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
                for (const el of document.querySelectorAll<HTMLElement>("a, button, span, p")) {
                    if (!el.offsetParent) continue; // not visible
                    const s = getComputedStyle(el);
                    const pill = parseFloat(s.borderTopLeftRadius) >= 999;
                    const filledGreen = s.backgroundColor === "rgb(39, 93, 73)";
                    const outlined = s.borderTopStyle === "solid" && parseFloat(s.borderTopWidth) > 0 && (el.tagName === "A" || el.tagName === "BUTTON");
                    if (pill && (filledGreen || outlined) && !el.classList.contains("cv-btn") && el.id !== "menuButton") {
                        out.push(`${describe(el)} looks like a button but doesn't use .cv-btn`);
                    }
                    if (el.classList.contains("cv-btn-md") && el.getBoundingClientRect().height < 48) out.push(`${describe(el)} is shorter than 48px`);
                    if (el.classList.contains("cv-btn-sm") && el.getBoundingClientRect().height < 44) out.push(`${describe(el)} is shorter than 44px`);
                }
                return out;
            });
            expect(problems).toEqual([]);
        });
    }
});
