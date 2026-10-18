import { describe, expect, it } from "vitest";
import {
    collectStories,
    firstParagraph,
    parseDate,
    parseStoryFile,
    plainText,
    relatedStories,
    resolveSummary,
    slugify,
    storyImageKey,
    SUMMARY_FALLBACK_LENGTH,
    trimToWords,
} from "../../src/lib/stories.ts";

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

    it("ignores README files in the stories folder", () => {
        const { stories, problems } = collectStories({ "/c/README.md": "# Stories\n\nNotes for admins." });
        expect(stories).toEqual([]);
        expect(problems).toEqual([]);
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
        expect(storyImageKey("/src/assets/other/c.jpg")).toBeNull();
        expect(storyImageKey("https://example.com/a.jpg")).toBeNull();
        expect(storyImageKey(null)).toBeNull();
    });
});

describe("sharing fields and fallbacks", () => {
    const base = ["title: T", 'description: "The short summary."', "publishedAt: 2026-10-01", "featuredImage: /src/assets/stories/a.jpg", "draft: false"];
    const parse = (extra: string[] = [], body = "First paragraph of the story.\n\nSecond paragraph.") => {
        const r = parseStoryFile("x.md", story([...base, ...extra].join("\n"), body));
        if (r.kind !== "published") throw new Error("expected a published story");
        return r.story;
    };

    it("uses safe defaults when no sharing fields are set (existing stories keep working)", () => {
        expect(parse()).toMatchObject({
            summary: "The short summary.",
            socialImage: "/src/assets/stories/a.jpg",
            imageFocus: "centre",
            igCaption: "",
            publishSocial: false,
        });
    });

    it("prefers the sharing summary, image, focus and caption when set", () => {
        const s = parse(['summary: "A sharing summary."', "socialImage: /src/assets/stories/b.jpg", "imageFocus: top", 'igCaption: "An IG caption"', "publishSocial: true"]);
        expect(s).toMatchObject({ summary: "A sharing summary.", socialImage: "/src/assets/stories/b.jpg", imageFocus: "top", igCaption: "An IG caption", publishSocial: true });
    });

    it("only posts when publishSocial is really ticked", () => {
        expect(parse(["publishSocial: false"]).publishSocial).toBe(false);
        expect(parse(['publishSocial: "yes"']).publishSocial).toBe(false);
    });

    it("accepts American spelling and ignores unknown crop positions", () => {
        expect(parse(["imageFocus: center"]).imageFocus).toBe("centre");
        expect(parse(["imageFocus: sideways"]).imageFocus).toBe("centre");
    });

    it("strips links from summaries", () => {
        expect(parse(['summary: "Read [our recap](https://x.ie) or see www.x.ie today."']).summary).toBe("Read our recap or see today.");
    });
});

describe("summary fallback from the story text", () => {
    it("uses the first real paragraph as plain text, skipping headings and images", () => {
        const body = "# A heading\n\n![photo](/src/assets/stories/a.jpg)\n\nWe had **a lovely** evening at [My Goodness](https://mygoodness.ie).\n\nMore.";
        expect(resolveSummary("", "", body)).toBe("We had a lovely evening at My Goodness.");
    });

    it("trims long paragraphs to about 200 characters on a word boundary", () => {
        const out = resolveSummary("", "", "word ".repeat(80).trim());
        expect(out.length).toBeLessThanOrEqual(SUMMARY_FALLBACK_LENGTH);
        expect(out.endsWith("word…")).toBe(true);
    });

    it("trims cleanly without cutting a word or leaving punctuation before the ellipsis", () => {
        expect(trimToWords("One two three, four five", 16)).toBe("One two three…");
        expect(trimToWords("Short enough", 50)).toBe("Short enough");
    });

    it("turns Markdown into plain text", () => {
        expect(plainText("## Hi\n- **Bold** _and_ `code` [link](https://a.ie)")).toBe("Hi Bold and code link");
    });

    it("finds no paragraph in an empty story", () => {
        expect(firstParagraph("")).toBe("");
    });
});
