import type { APIRoute } from "astro";
import { site } from "../config/site";
import { getStories } from "../lib/content";
import { isoDate } from "../lib/stories";

/** XML sitemap of every public page. Drafts are never included (they are never built). */
export const GET: APIRoute = () => {
    const stories = getStories();
    const entries: { loc: string; lastmod?: string }[] = [
        { loc: "/" },
        { loc: "/events/" },
        { loc: "/stories/", lastmod: stories[0] ? isoDate(stories[0].updatedAt ?? stories[0].publishedAt) : undefined },
        ...stories.map((s) => ({ loc: `/stories/${s.slug}/`, lastmod: isoDate(s.updatedAt ?? s.publishedAt) })),
        { loc: "/resources/" },
        { loc: "/support/" },
        { loc: "/about/" },
    ];
    const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        entries
            .map((e) => `  <url><loc>${new URL(e.loc, site.url).href}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`)
            .join("\n") +
        `\n</urlset>\n`;
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
