import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEFAULT_HOW_TO_CLAIM, collectPartners, parsePartnerFile, partnerLogoKey } from "../../src/lib/partners.ts";

const fixtures = Object.fromEntries(
    readdirSync(new URL("../fixtures/partners/", import.meta.url)).map((f) => [`/tests/fixtures/partners/${f}`, readFileSync(new URL(`../fixtures/partners/${f}`, import.meta.url), "utf8")]),
);

describe("partner businesses", () => {
    it("shows complete partners in name order, leaving out hidden and unfinished ones", () => {
        const { partners, problems } = collectPartners(fixtures);
        expect(partners.map((p) => p.name)).toEqual(["allotment Shop", "Green Bean Café"]);
        expect(problems).toEqual([{ file: "unfinished.yml", message: "Missing discount." }]);
    });

    it("tidies the fields: https websites only, and a default way to claim", () => {
        const { partners } = collectPartners(fixtures);
        const [shop, cafe] = partners;
        expect(cafe).toMatchObject({ discount: "10% off food and drinks", area: "Cork city centre", website: "https://example.com/green-bean", logo: "/src/assets/partners/green-bean.png", howToClaim: DEFAULT_HOW_TO_CLAIM });
        expect(shop).toMatchObject({ website: "", logo: null, description: "", howToClaim: "Mention Cork Vegans at the till." });
        expect(parsePartnerFile("a.yml", "name: A\ndiscount: B\nwebsite: example.ie/shop")).toMatchObject({ partner: { website: "https://example.ie/shop" } });
        expect(parsePartnerFile("a.yml", "name: A\ndiscount: B\nwebsite: javascript:alert(1)")).toMatchObject({ partner: { website: "" } });
    });

    it("reports unreadable files instead of failing the build", () => {
        expect(parsePartnerFile("x.yml", "name: [unclosed")).toMatchObject({ kind: "invalid" });
        expect(parsePartnerFile("x.yml", "")).toMatchObject({ kind: "invalid" });
        expect(parsePartnerFile("x.yml", "discount: 10% off")).toEqual({ kind: "invalid", problem: { file: "x.yml", message: "Missing business name." } });
    });

    it("only uses logos from the partners media folder", () => {
        expect(partnerLogoKey("/src/assets/partners/logo.png")).toBe("/src/assets/partners/logo.png");
        expect(partnerLogoKey("/src/assets/stories/photo.jpg")).toBeNull();
        expect(partnerLogoKey("/src/assets/partners/../../secrets.png")).toBeNull();
        expect(partnerLogoKey(null)).toBeNull();
    });
});

describe("Pages CMS: partners", () => {
    const config = parse(readFileSync(new URL("../../.pages.yml", import.meta.url), "utf8"));
    const collection = config.content.find((c: { name: string }) => c.name === "partners");
    const fields = Object.fromEntries(collection.fields.map((f: { name: string }) => [f.name, f]));

    it("points at the folder the site reads, one YAML file per partner", () => {
        expect(collection).toMatchObject({ path: "src/content/partners", format: "yaml" });
        expect(collection.exclude).toContain("README.md");
        expect(config.media.find((m: { name: string }) => m.name === "partners")).toMatchObject({ input: "src/assets/partners", output: "/src/assets/partners" });
    });

    it("has the fields the site reads, starting hidden so nothing goes live by accident", () => {
        expect(Object.keys(fields).sort()).toEqual(["area", "description", "discount", "hidden", "howToClaim", "logo", "name", "website"]);
        expect(collection.fields[0].name).toBe("hidden");
        expect(fields.hidden.default).toBe(true);
        expect(fields.name.required).toBe(true);
        expect(fields.discount.required).toBe(true);
        expect(fields.logo.options.media).toBe("partners");
    });

    it("writes files the parser accepts", () => {
        const file = Object.fromEntries(Object.keys(fields).map((k) => [k, k === "hidden" ? false : k === "logo" ? "/src/assets/partners/a.png" : k === "website" ? "https://example.ie" : `A ${k}`]));
        expect(parsePartnerFile("a.yml", JSON.stringify(file))).toMatchObject({ kind: "shown" });
    });
});
