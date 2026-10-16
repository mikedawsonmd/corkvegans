// @ts-check
import { defineConfig } from "astro/config";

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
});
