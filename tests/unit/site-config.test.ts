import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contactForm, donations, links, site, volunteerForm } from "../../src/config/site.ts";

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
        for (const url of [donations.oneOffUrl, donations.manageUrl]) expect(url === "" || url.startsWith("https://")).toBe(true);
    });

    it("only ever exposes a Stripe publishable key, never a secret one", () => {
        expect(donations.publishableKey === "" || /^pk_(live|test)_\w+$/.test(donations.publishableKey)).toBe(true);
        expect(donations.sessionEndpoint === "" || /^https:\/\/.+\/donate\/session$/.test(donations.sessionEndpoint)).toBe(true);
    });

    it("has form endpoints that are empty or Formspree form URLs", () => {
        for (const endpoint of [volunteerForm.endpoint, contactForm.endpoint]) {
            expect(endpoint === "" || /^https:\/\/formspree\.io\/f\/[A-Za-z0-9]+$/.test(endpoint)).toBe(true);
        }
    });

    it("keeps contact messages separate from volunteer enquiries", () => {
        if (contactForm.endpoint) expect(contactForm.endpoint).not.toBe(volunteerForm.endpoint);
    });

    it("contains no credentials", () => {
        const source = readFileSync(new URL("../../src/config/site.ts", import.meta.url), "utf8");
        expect(source).not.toMatch(/Bearer\s|[sr]k_live|[sr]k_test|gh[pousr]_|token\s*[:=]\s*"[^"]+"/i);
    });
});
