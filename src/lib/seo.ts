/** Structured data (schema.org JSON-LD). Only states facts the site can verify. */
import { links, site } from "../config/site";
import { DEFAULT_AUTHOR, type Story } from "./stories";

export function organizationJsonLd() {
    return {
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": `${site.url}/#organization`,
        name: site.name,
        url: `${site.url}/`,
        logo: new URL(site.logo, site.url).href,
        sameAs: [links.meetup, links.facebook, links.instagram],
    };
}

export function articleJsonLd(story: Story, url: string, imageUrl: string) {
    const author =
        story.author === DEFAULT_AUTHOR
            ? { "@type": "Organization", name: site.name, url: `${site.url}/` }
            : { "@type": "Person", name: story.author };
    return {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: story.title,
        description: story.description,
        image: [imageUrl],
        datePublished: story.publishedAt.toISOString(),
        dateModified: (story.updatedAt ?? story.publishedAt).toISOString(),
        author,
        publisher: {
            "@type": "Organization",
            "@id": `${site.url}/#organization`,
            name: site.name,
            logo: { "@type": "ImageObject", url: new URL(site.logo, site.url).href },
        },
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        articleSection: story.category,
    };
}
