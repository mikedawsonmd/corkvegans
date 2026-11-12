// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import { ICONS } from "./src/lib/icons.ts";

// The canonical domain is the apex (www.corkvegans.ie 301-redirects to it).
export default defineConfig({
    site: "https://corkvegans.ie",
    trailingSlash: "always",
    build: {
        format: "directory",
    },
    image: {
        // Only local images are optimised; remote images are never fetched at build.
        domains: [],
    },
    // Fonts are downloaded at build time and served from corkvegans.ie, then
    // preloaded (BaseLayout.astro), so they're ready when the page first shows.
    fonts: [
        {
            // Text: Astro also makes a fallback sized like Karla, so text
            // doesn't jump if Karla is ever slow.
            provider: fontProviders.google(),
            name: "Karla",
            cssVariable: "--font-karla",
            weights: [400, 500, 600, 700],
            styles: ["normal"],
            subsets: ["latin", "latin-ext"],
            fallbacks: ["sans-serif"],
        },
        {
            // Icons: only the ones in src/lib/icons.ts. "block" keeps an icon
            // invisible (never its name) for the moment the font takes to load.
            provider: fontProviders.googleicons(),
            name: "Material Symbols Outlined",
            cssVariable: "--font-material-symbols",
            weights: ["400"],
            display: "block",
            fallbacks: [],
            options: { experimental: { glyphs: [...ICONS] } },
        },
    ],
});
