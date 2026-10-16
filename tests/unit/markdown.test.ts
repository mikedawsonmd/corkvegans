import { describe, expect, it } from "vitest";
import { enhanceStoryHtml, renderStoryMarkdown } from "../../src/lib/markdown.ts";

describe("story rendering and sanitising", () => {
    it("renders headings, lists, links, quotes and images", () => {
        const html = renderStoryMarkdown("## Hi\n\n- a\n- b\n\n> quote\n\n[link](https://example.com)\n\n![alt](/src/assets/stories/x.jpg)");
        expect(html).toContain("<h2>Hi</h2>");
        expect(html).toContain("<li>a</li>");
        expect(html).toContain("<blockquote>");
        expect(html).toContain('<a href="https://example.com">link</a>');
        expect(html).toContain('<img src="/src/assets/stories/x.jpg" alt="alt" />');
    });

    it("demotes H1 to H2 so the story title stays the only H1", () => {
        expect(renderStoryMarkdown("# Big")).toBe("<h2>Big</h2>\n");
    });

    it("removes scripts, iframes, event handlers, styles and javascript: URLs", () => {
        const html = renderStoryMarkdown(
            [
                "<script>alert(1)</script>",
                '<p onclick="alert(1)" style="color:red">x</p>',
                '<a href="javascript:alert(1)">bad</a>',
                '<img src="javascript:alert(1)">',
                '<img src="http://insecure.example/x.jpg">',
                '<iframe src="https://example.com"></iframe>',
                "<svg><script>alert(1)</script></svg>",
                '[md link](javascript:alert(1))',
            ].join("\n\n"),
        );
        expect(html).not.toMatch(/script|onclick|style=|javascript:|iframe|svg|insecure/i);
    });

    it("keeps mailto and tel links", () => {
        const html = renderStoryMarkdown("[mail](mailto:a@b.ie) [call](tel:+353)");
        expect(html).toContain('href="mailto:a@b.ie"');
        expect(html).toContain('href="tel:+353"');
    });

    it("rewrites resolvable images and lazy-loads all images", async () => {
        const html = await enhanceStoryHtml(
            '<p><img src="/src/assets/stories/x.jpg" alt="x" /><img src="https://cdn.example/y.jpg" /></p>',
            async (src) => (src.endsWith("x.jpg") ? { src: "/_astro/x.webp", width: 800, height: 600 } : null),
        );
        expect(html).toContain('<img width="800" height="600" src="/_astro/x.webp" alt="x" loading="lazy" decoding="async" />');
        expect(html).toContain('<img alt="" src="https://cdn.example/y.jpg" loading="lazy" decoding="async" />');
    });

    it("removes images whose file no longer exists", async () => {
        const html = await enhanceStoryHtml('<p>Before<img src="/src/assets/stories/gone.jpg" alt="x" />After</p>', async () => false);
        expect(html).toBe("<p>BeforeAfter</p>");
    });
});
