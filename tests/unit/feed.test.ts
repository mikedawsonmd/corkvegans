import { describe, expect, it } from "vitest";
import { buildFeed, escapeXml, FEED_LIMIT, type FeedItem } from "../../src/lib/feed.ts";

const channel = {
    title: "Cork Vegans: Stories & Updates",
    url: "https://corkvegans.ie/stories/",
    feedUrl: "https://corkvegans.ie/stories/feed.xml",
    description: "Stories",
    language: "en-ie",
    logoUrl: "https://corkvegans.ie/images/logo.png",
};

const item = (n: number, image = true): FeedItem => ({
    title: `Story ${n} <& "friends">`,
    url: `https://corkvegans.ie/stories/story-${n}/`,
    date: new Date(Date.UTC(2026, 9, 30 - n, 12)),
    summary: `Summary ${n} with café & Cork's best`,
    category: "Community",
    author: "Aoife",
    image: image ? { url: `https://corkvegans.ie/stories/story-${n}/share-1200x630.jpg`, length: 1234, width: 1200, height: 630 } : null,
});

describe("RSS feed", () => {
    it("escapes text for XML", () => {
        expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;");
    });

    it("produces RSS 2.0 with a self link and the namespaces it uses", () => {
        const xml = buildFeed(channel, [item(1)]);
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true);
        expect(xml).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
        expect(xml).toContain('<atom:link href="https://corkvegans.ie/stories/feed.xml" rel="self" type="application/rss+xml"/>');
        expect(xml).toContain("<title>Cork Vegans: Stories &amp; Updates</title>");
    });

    it("gives each item its link, date, summary and image for email tools", () => {
        const xml = buildFeed(channel, [item(1)]);
        expect(xml).toContain("<title>Story 1 &lt;&amp; &quot;friends&quot;&gt;</title>");
        expect(xml).toContain('<guid isPermaLink="true">https://corkvegans.ie/stories/story-1/</guid>');
        expect(xml).toContain("<pubDate>Thu, 29 Oct 2026 12:00:00 GMT</pubDate>");
        expect(xml).toContain("<description>Summary 1 with café &amp; Cork&apos;s best</description>");
        expect(xml).toContain('<enclosure url="https://corkvegans.ie/stories/story-1/share-1200x630.jpg" length="1234" type="image/jpeg"/>');
        expect(xml).toContain('<media:content url="https://corkvegans.ie/stories/story-1/share-1200x630.jpg" medium="image" type="image/jpeg" width="1200" height="630"/>');
    });

    it("leaves out the image when a story has none", () => {
        expect(buildFeed(channel, [item(1, false)])).not.toContain("<enclosure");
    });

    it("keeps the most recent stories and dates the feed by the newest one", () => {
        const items = Array.from({ length: FEED_LIMIT + 5 }, (_, i) => item(i + 1));
        const xml = buildFeed(channel, items);
        expect(xml.match(/<item>/g)).toHaveLength(FEED_LIMIT);
        expect(xml).toContain(`<lastBuildDate>${items[0].date.toUTCString()}</lastBuildDate>`);
    });
});
