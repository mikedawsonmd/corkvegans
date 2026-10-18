/**
 * RSS 2.0 feed of stories (/stories/feed.xml), for feed readers and
 * RSS-to-email tools such as Buttondown, MailerLite and Mailchimp. Each item's
 * image is given both as an <enclosure> and as <media:content>, since email
 * tools differ in which one they read.
 */

export interface FeedImage {
    url: string;
    length: number; // bytes
    width: number;
    height: number;
}

export interface FeedItem {
    title: string;
    url: string;
    date: Date;
    summary: string;
    category: string;
    author: string;
    image: FeedImage | null;
}

export interface FeedChannel {
    title: string;
    url: string; // the Stories page
    feedUrl: string;
    description: string;
    language: string;
    logoUrl: string;
}

/** Most recent stories included in the feed. */
export const FEED_LIMIT = 20;

export function escapeXml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function itemXml(item: FeedItem): string {
    const e = escapeXml;
    const lines = [
        "    <item>",
        `      <title>${e(item.title)}</title>`,
        `      <link>${e(item.url)}</link>`,
        `      <guid isPermaLink="true">${e(item.url)}</guid>`,
        `      <pubDate>${item.date.toUTCString()}</pubDate>`,
        `      <description>${e(item.summary)}</description>`,
        `      <category>${e(item.category)}</category>`,
        `      <dc:creator>${e(item.author)}</dc:creator>`,
    ];
    if (item.image) {
        const i = item.image;
        lines.push(
            `      <enclosure url="${e(i.url)}" length="${i.length}" type="image/jpeg"/>`,
            `      <media:content url="${e(i.url)}" medium="image" type="image/jpeg" width="${i.width}" height="${i.height}"/>`,
        );
    }
    lines.push("    </item>");
    return lines.join("\n");
}

/** Builds the feed. Items should already be newest first; only the first FEED_LIMIT are kept. */
export function buildFeed(channel: FeedChannel, items: FeedItem[]): string {
    const e = escapeXml;
    const kept = items.slice(0, FEED_LIMIT);
    // The newest story's date, so the feed only changes when the stories do.
    const updated = kept[0]?.date ?? new Date(0);
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
        "  <channel>",
        `    <title>${e(channel.title)}</title>`,
        `    <link>${e(channel.url)}</link>`,
        `    <atom:link href="${e(channel.feedUrl)}" rel="self" type="application/rss+xml"/>`,
        `    <description>${e(channel.description)}</description>`,
        `    <language>${e(channel.language)}</language>`,
        `    <lastBuildDate>${updated.toUTCString()}</lastBuildDate>`,
        "    <image>",
        `      <url>${e(channel.logoUrl)}</url>`,
        `      <title>${e(channel.title)}</title>`,
        `      <link>${e(channel.url)}</link>`,
        "    </image>",
        ...kept.map(itemXml),
        "  </channel>",
        "</rss>",
        "",
    ].join("\n");
}
