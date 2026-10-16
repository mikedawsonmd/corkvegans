import { describe, expect, it } from "vitest";
import { collectStories, parseDate, parseStoryFile, relatedStories, slugify, storyImageKey } from "../../src/lib/stories.ts";

const story = (fields: string, body = "Hello world.") => `---\n${fields}\n---\n${body}\n`;
const valid = story(
    [
        'title: "Our first potluck"',
        'description: "A lovely evening."',
        "category: Community",
        "author: Aoife",
        "publishedAt: 2026-10-01",
        "featuredImage: /src/assets/stories/potluck.jpg",
        'featuredImageAlt: "Dishes on a table"',
        "draft: false",
    ].join("\n"),
);

describe("parsing a story file", () => {
    it("reads a valid published story", () => {
        const result = parseStoryFile("our-first-potluck.md", valid);
        expect(result.kind).toBe("published");
        if (result.kind !== "published") return;
        expect(result.story).toMatchObject({
            slug: "our-first-potluck",
            title: "Our first potluck",
            description: "A lovely evening.",
            category: "Community",
            author: "Aoife",
            featuredImage: "/src/assets/stories/potluck.jpg",
            featuredImageAlt: "Dishes on a table",
            updatedAt: null,
            readingMinutes: 1,
        });
        expect(result.story.publishedAt.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    });

    it("excludes drafts without validating them", () => {
        expect(parseStoryFile("x.md", story("draft: true\npublishedAt: banana")).kind).toBe("draft");
        expect(parseStoryFile("x.md", story('draft: "true"')).kind).toBe("draft");
    });

    it("treats a missing draft field as published (files added by hand)", () => {
        expect(parseStoryFile("x.md", story('title: T\ndescription: D\npublishedAt: "2026-01-01"')).kind).toBe("published");
    });

    it("applies defaults for author and category, and uses the title as fallback alt text", () => {
        const r = parseStoryFile("x.md", story("title: T\ndescription: D\npublishedAt: 2026-01-01\nfeaturedImage: /src/assets/stories/a.jpg\ndraft: false"));
        expect(r.kind === "published" && r.story).toMatchObject({ author: "Cork Vegans", category: "Stories", featuredImageAlt: "T" });
    });

    it.each([
        ["no front matter", "Just text"],
        ["broken YAML", story('title: "unclosed\ndraft: [')],
        ["front matter that is a list", story("- a\n- b")],
        ["missing title", story("description: D\npublishedAt: 2026-01-01\ndraft: false")],
        ["missing description", story("title: T\npublishedAt: 2026-01-01\ndraft: false")],
        ["missing date", story("title: T\ndescription: D\ndraft: false")],
        ["invalid date", story('title: T\ndescription: D\npublishedAt: "2026-13-45x"\ndraft: false')],
        ["invalid updated date", story('title: T\ndescription: D\npublishedAt: 2026-01-01\nupdatedAt: "soon"\ndraft: false')],
    ])("reports %s as a problem instead of throwing", (_, raw) => {
        expect(parseStoryFile("x.md", raw).kind).toBe("invalid");
    });

    it("rejects filenames that can't become a web address", () => {
        expect(parseStoryFile("!!!.md", valid).kind).toBe("invalid");
    });
});

describe("collecting stories", () => {
    it("sorts newest first, skips drafts and reports problems", () => {
        const files = {
            "/c/older.md": story("title: Older\ndescription: D\npublishedAt: 2026-01-01\ndraft: false"),
            "/c/newer.md": story("title: Newer\ndescription: D\npublishedAt: 2026-06-01\ndraft: false"),
            "/c/wip.md": story("title: WIP\ndraft: true"),
            "/c/bad.md": story("title: Bad\ndraft: false"),
        };
        const { stories, problems, drafts } = collectStories(files);
        expect(stories.map((s) => s.slug)).toEqual(["newer", "older"]);
        expect(drafts).toBe(1);
        expect(problems.map((p) => p.file)).toEqual(["bad.md"]);
    });

    it("prevents two stories from sharing a web address", () => {
        const s = story("title: T\ndescription: D\npublishedAt: 2026-01-01\ndraft: false");
        const { stories, problems } = collectStories({ "/c/My-Story.md": s, "/c/my-story.md": s });
        expect(stories).toHaveLength(1);
        expect(problems[0].message).toContain("/stories/my-story/");
    });

    it("finds related stories, same category first", () => {
        const make = (slug: string, category: string, date: string) =>
            story(`title: ${slug}\ndescription: D\ncategory: ${category}\npublishedAt: ${date}\ndraft: false`);
        const { stories } = collectStories({
            "/a.md": make("a", "News", "2026-05-01"),
            "/b.md": make("b", "Reviews", "2026-04-01"),
            "/c.md": make("c", "News", "2026-03-01"),
            "/d.md": make("d", "Events", "2026-06-01"),
        });
        const a = stories.find((s) => s.slug === "a")!;
        expect(relatedStories(a, stories).map((s) => s.slug)).toEqual(["c", "d", "b"]);
    });
});

describe("helpers", () => {
    it("makes clean slugs", () => {
        expect(slugify("Café Review: Tofu & Tempeh!")).toBe("cafe-review-tofu-and-tempeh");
        expect(slugify("  --  ")).toBe("");
    });

    it("parses dates strictly", () => {
        expect(parseDate("2026-10-16")?.toISOString()).toBe("2026-10-16T12:00:00.000Z");
        expect(parseDate("2026-10-16T09:30")).toBeInstanceOf(Date);
        expect(parseDate("16/10/2026")).toBeNull();
        expect(parseDate("")).toBeNull();
        expect(parseDate(42)).toBeNull();
    });

    it("only accepts images from the stories media folder", () => {
        expect(storyImageKey("/src/assets/stories/a.jpg")).toBe("/src/assets/stories/a.jpg");
        expect(storyImageKey("src/assets/stories/sub/b.png")).toBe("/src/assets/stories/sub/b.png");
        expect(storyImageKey("/src/assets/stories/../../../secrets.txt")).toBeNull();
        expect(storyImageKey("/src/assets/stories/%2e%2e/x.jpg")).toBeNull();
        expect(storyImageKey("https://example.com/a.jpg")).toBeNull();
        expect(storyImageKey(null)).toBeNull();
    });
});
