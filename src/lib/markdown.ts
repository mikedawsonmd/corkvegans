/**
 * Renders story Markdown (which may contain HTML from the CMS editor) to
 * safe HTML. Everything goes through an allow-list sanitiser, so scripts,
 * iframes, inline event handlers and javascript: URLs can never reach a page.
 */

import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const marked = new Marked({ gfm: true, breaks: false });

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [
        "p", "br", "h2", "h3", "h4", "h5", "h6",
        "strong", "b", "em", "i", "u", "s", "del", "sup", "sub", "mark",
        "a", "ul", "ol", "li", "blockquote",
        "img", "figure", "figcaption", "hr",
        "code", "pre",
        "table", "thead", "tbody", "tr", "th", "td",
    ],
    allowedAttributes: {
        a: ["href", "title"],
        img: ["src", "alt", "title", "width", "height"],
        th: ["colspan", "rowspan", "scope"],
        td: ["colspan", "rowspan"],
        ol: ["start"],
    },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    transformTags: {
        // The page title is the only <h1>; demote any headings the editor used.
        h1: "h2",
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
};

export function renderStoryMarkdown(markdown: string): string {
    const html = marked.parse(markdown, { async: false }) as string;
    return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * Rewrites <img> tags in already-sanitised HTML. `resolve` receives the
 * original src and returns replacement attributes, null to leave it as is,
 * or false to remove the image (e.g. a deleted media file).
 * All remaining images get lazy loading and an alt attribute.
 */
export async function enhanceStoryHtml(
    html: string,
    resolve: (src: string) => Promise<{ src: string; width?: number; height?: number } | null | false>,
): Promise<string> {
    const tags = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    const replacements = new Map<string, string>();

    for (const tag of new Set(tags)) {
        const src = /\ssrc="([^"]*)"/.exec(tag)?.[1];
        if (!src) continue;
        const resolved = await resolve(decodeHtmlAttr(src));
        if (resolved === false) {
            replacements.set(tag, "");
            continue;
        }
        let next = tag;
        if (resolved) {
            next = next.replace(/\ssrc="[^"]*"/, ` src="${escapeAttr(resolved.src)}"`);
            next = next.replace(/\s(width|height)="[^"]*"/g, "");
            if (resolved.width && resolved.height) {
                next = next.replace(/<img\b/, `<img width="${resolved.width}" height="${resolved.height}"`);
            }
        }
        if (!/\salt="/.test(next)) next = next.replace(/<img\b/, '<img alt=""');
        next = next.replace(/\s*\/?>$/, ' loading="lazy" decoding="async" />');
        replacements.set(tag, next);
    }

    let out = html;
    for (const [from, to] of replacements) out = out.split(from).join(to);
    return out;
}

function decodeHtmlAttr(value: string): string {
    return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
