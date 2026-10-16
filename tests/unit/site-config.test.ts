import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { donations, links, site, volunteerForm } from "../../src/config/site.ts";

describe("site configuration", () => {
    it("uses the apex domain as canonical, matching CNAME", () => {
        const cname = readFileSync(new URL("../../public/CNAME", import.meta.url), "utf8").trim();
        expect(site.url).toBe(`https://${cname}`);
        expect(cname).toBe("corkvegans.ie");
    });

    it("only uses https links", () => {
        for (const url of Object.values(links)) expect(url).toMatch(/^https:\/\//);
    });

    it("has donation links that are either empty or https", () => {
        for (const url of [donations.oneOffUrl, donations.monthlyUrl]) expect(url === "" || url.startsWith("https://")).toBe(true);
    });

    it("has a form endpoint that is empty or a Formspree form URL", () => {
        expect(volunteerForm.endpoint === "" || /^https:\/\/formspree\.io\/f\/[A-Za-z0-9]+$/.test(volunteerForm.endpoint)).toBe(true);
    });

    it("contains no credentials", () => {
        const source = readFileSync(new URL("../../src/config/site.ts", import.meta.url), "utf8");
        expect(source).not.toMatch(/Bearer\s|sk_live|sk_test|gh[pousr]_|token\s*[:=]\s*"[^"]+"/i);
    });
});
