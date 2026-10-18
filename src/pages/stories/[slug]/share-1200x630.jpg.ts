/** 1200 × 630 crop of the story's sharing photo: Open Graph, Facebook and email (see src/lib/social-images.ts). */
import type { APIRoute, GetStaticPaths } from "astro";
import { getStories } from "../../../lib/content";
import { hasSocialImage, socialCrop } from "../../../lib/social-images";
import type { Story } from "../../../lib/stories";

export const getStaticPaths = (() =>
    getStories()
        .filter(hasSocialImage)
        .map((story) => ({ params: { slug: story.slug }, props: { story } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
    new Response(new Uint8Array(await socialCrop((props as { story: Story }).story, "share")), { headers: { "Content-Type": "image/jpeg" } });
