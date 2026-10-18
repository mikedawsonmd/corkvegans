import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { storyCategories } from "../../src/config/site.ts";
import { IMAGE_FOCUSES, parseStoryFile, storyImageKey } from "../../src/lib/stories.ts";

const config = parse(readFileSync(new URL("../../.pages.yml", import.meta.url), "utf8"));
const collection = config.content.find((c: { name: string }) => c.name === "stories");
type Field = { name: string; type: string; required?: boolean; default?: unknown; options?: Record<string, unknown>; list?: { max?: number }; fields?: Field[] };
const fields: Record<string, Field> = Object.fromEntries(collection.fields.map((f: Field) => [f.name, f]));
const social: Record<string, Field> = Object.fromEntries((fields.social.fields ?? []).map((f) => [f.name, f]));

describe("Pages CMS configuration", () => {
    it("points at the stories folder the site reads", () => {
        expect(collection.path).toBe("src/content/stories");
        expect(collection.format).toBe("yaml-frontmatter");
        expect(collection.exclude).toContain("README.md");
    });

    it("has exactly the fields the site's story schema expects", () => {
        expect(Object.keys(fields).sort()).toEqual(
            [
                "author",
                "body",
                "category",
                "description",
                "draft",
                "featuredImage",
                "featuredImageAlt",
                "imageFocus",
                "publishedAt",
                "social",
                "title",
                "updatedAt",
            ].sort(),
        );
        expect(Object.keys(social).sort()).toEqual(["igCaption", "image", "summary"]);
        expect(fields.body.type).toBe("rich-text");
        expect(fields.body.options?.format).toBe("markdown");
    });

    it("puts the Draft switch at the top of the form", () => {
        expect(collection.fields[0].name).toBe("draft");
    });

    it("requires the fields the site needs to publish, including a photo for social media", () => {
        for (const name of ["title", "description", "publishedAt", "category", "featuredImage", "featuredImageAlt"]) {
            expect(fields[name].required).toBe(true);
        }
    });

    it("only posts to social media when an editor adds the posting section (at most one)", () => {
        expect(fields.social.type).toBe("object");
        expect(fields.social.list?.max).toBe(1);
        expect(fields.social.required).toBeFalsy();
        expect("default" in fields.social).toBe(false);
        for (const f of Object.values(social)) expect(f.required).toBeFalsy();
    });

    it("offers the crop positions the site understands, defaulting to centre", () => {
        const values = (fields.imageFocus.options?.values as { name: string }[]).map((v) => v.name);
        expect(values).toEqual([...IMAGE_FOCUSES]);
        expect(fields.imageFocus.default).toBe("centre");
        expect(social.image.options?.media).toBe("stories");
    });

    it("keeps links out of the post text", () => {
        const pattern = social.summary.options?.pattern as { regex: string; message: string };
        const re = new RegExp(pattern.regex);
        expect(re.test("Our autumn potluck was a joy.\nThanks to everyone who came!")).toBe(true);
        expect(re.test("See https://example.com for more")).toBe(false);
        expect(re.test("Details at www.example.ie")).toBe(false);
        expect(pattern.message).toMatch(/links/);
    });

    it("leaves room for the Instagram sign-off within Instagram's 2,200 character limit", () => {
        expect(Number(social.igCaption.options?.maxlength)).toBeLessThanOrEqual(2200 - 50);
    });

    it("creates new stories as drafts", () => {
        expect(fields.draft.type).toBe("boolean");
        expect(fields.draft.default).toBe(true);
    });

    it("offers the same categories as the site", () => {
        expect(fields.category.options?.values).toEqual([...storyCategories]);
    });

    it("writes dates in a format the site accepts", () => {
        expect(fields.publishedAt.options?.format).toBe("yyyy-MM-dd");
        expect(fields.updatedAt.options?.format).toBe("yyyy-MM-dd");
    });

    it("stores images where the site can find and optimise them", () => {
        const media = config.media.find((m: { name: string }) => m.name === "stories");
        expect(media.input).toBe("src/assets/stories");
        expect(storyImageKey(`${media.output}/photo.jpg`)).toBe("/src/assets/stories/photo.jpg");
        expect(fields.featuredImage.options?.media).toBe("stories");
        expect(fields.body.options?.media).toBe("stories");
    });

    it("names story files from the title, with no filename box for editors to get wrong", () => {
        // Editing the box by hand (e.g. dropping ".md") makes saves fail with 'Invalid extension ""'.
        expect(collection.filename.template).toBe("{primary}.md");
        expect(collection.filename.field).toBe(false);
    });

    it("round-trips a file shaped like Pages CMS output", () => {
        const file = [
            "---",
            "title: My first story",
            "description: A short summary.",
            "category: Community",
            "author: Cork Vegans",
            "publishedAt: 2026-10-16",
            'updatedAt: ""',
            "featuredImage: /src/assets/stories/my-photo.jpg",
            "featuredImageAlt: People at a picnic",
            "draft: false",
            "---",
            "Some **bold** text.",
        ].join("\n");
        const r = parseStoryFile("my-first-story.md", file);
        expect(r.kind).toBe("published");
        expect(parseStoryFile("my-first-story.md", file.replace("draft: false", "draft: true")).kind).toBe("draft");
    });
});
