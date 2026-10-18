/** RSS feed of stories for feed readers and the email newsletter (see src/lib/feed.ts). */
import type { APIRoute } from "astro";
import { site } from "../../config/site";
import { getStories } from "../../lib/content";
import { buildFeed, FEED_LIMIT, type FeedItem } from "../../lib/feed";
import { CROPS, cropPath, hasSocialImage, socialCrop } from "../../lib/social-images";

export const GET: APIRoute = async () => {
    const abs = (path: string) => new URL(path, site.url).href;
    const items: FeedItem[] = await Promise.all(
        getStories()
            .slice(0, FEED_LIMIT)
            .map(async (story) => ({
                title: story.title,
                url: abs(`/stories/${story.slug}/`),
                date: story.publishedAt,
                summary: story.summary,
                category: story.category,
                author: story.author,
                image: hasSocialImage(story)
                    ? {
                          url: abs(cropPath(story.slug, "share")),
                          length: (await socialCrop(story, "share")).length,
                          width: CROPS.share.width,
                          height: CROPS.share.height,
                      }
                    : null,
            })),
    );

    const xml = buildFeed(
        {
            title: "Cork Vegans: Stories & Updates",
            url: abs("/stories/"),
            feedUrl: abs("/stories/feed.xml"),
            description: "News, reviews, event recaps and stories from around Cork's vegan community.",
            language: "en-ie",
            logoUrl: abs("/images/logo.png"),
        },
        items,
    );
    return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
