/** Small text and URL helpers used when normalising external event data. */

/** Returns the URL if it is a well-formed https URL (optionally on an allowed host), else null. */
export function safeHttpsUrl(value: unknown, allowedHosts?: RegExp): string | null {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:") return null;
        if (allowedHosts && !allowedHosts.test(url.hostname)) return null;
        return url.toString();
    } catch {
        return null;
    }
}

/** Collapses whitespace and trims. */
export function cleanText(value: unknown): string {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Shortens text at a word boundary, adding an ellipsis when truncated. */
export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!-]+$/, "") + "…";
}

/** Strips Markdown syntax, leaving readable plain text. */
export function stripMarkdown(markdown: string): string {
    return markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
        .replace(/<[^>]+>/g, "") // stray HTML
        .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
        .replace(/^\s{0,3}>\s?/gm, "") // blockquotes
        .replace(/^\s*[*+-]\s+/gm, "") // bullets
        .replace(/(\*\*|__|\*|_|~~|`)/g, "") // emphasis / code
        .replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, "$1"); // escapes
}

/**
 * Turns a Meetup-style Markdown description into a short plain-text summary,
 * dropping the group-name line and the repeated "Connect with us" link block.
 */
export function summariseDescription(description: string, groupName: string, max = 280): string {
    const lines = description
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    if (lines[0] && lines[0].toLowerCase() === groupName.toLowerCase()) lines.shift();

    const kept = lines.filter((line) => {
        if (/connect with us/i.test(line)) return false;
        // A line that is nothing but links separated by pipes (social links block).
        const withoutLinks = line.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/[*\\|\s]/g, "");
        if (/\]\(/.test(line) && withoutLinks === "") return false;
        return true;
    });

    return truncate(cleanText(stripMarkdown(kept.join("\n"))), max);
}

/** Normalises a title for duplicate detection. */
export function normaliseTitle(title: string): string {
    return title
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/cork\s*vegans?/g, " ")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}
