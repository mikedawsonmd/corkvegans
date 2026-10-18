/**
 * Social and email images: each story's sharing photo (socialImage, else the
 * featured image) cropped with sharp at build time, keeping the part chosen in
 * imageFocus, or fitted whole on a green border ("whole"). They're published
 * at fixed addresses next to the story, so the RSS feed and the social
 * posting script can find them:
 *
 *   /stories/<slug>/share-1200x630.jpg      Open Graph, Facebook, email
 *   /stories/<slug>/instagram-1080x1350.jpg Instagram (4:5)
 */

import sharp from "sharp";
import { getStoryImageFile } from "./content";
import type { Story } from "./stories";

export const CROPS = {
    share: { width: 1200, height: 630, file: "share-1200x630.jpg" },
    instagram: { width: 1080, height: 1350, file: "instagram-1080x1350.jpg" },
} as const;

export type CropKind = keyof typeof CROPS;

/** Site-relative address of a story's crop, e.g. /stories/my-story/share-1200x630.jpg. */
export function cropPath(slug: string, kind: CropKind): string {
    return `/stories/${slug}/${CROPS[kind].file}`;
}

/** True when the story has a sharing photo that can be cropped. */
export function hasSocialImage(story: Story): boolean {
    return getStoryImageFile(story.socialImage) !== null;
}

/** Border colour and margin for "Whole photo" (brand primary green). */
const BORDER = { r: 39, g: 93, b: 73 };
const MARGIN = 0.06; // of the shorter side

/** The whole photo, shrunk to fit inside the frame, centred on a green background. */
async function wholePhoto(file: string, width: number, height: number): Promise<Buffer> {
    const pad = Math.round(Math.min(width, height) * MARGIN);
    const inner = await sharp(file)
        .rotate()
        .resize(width - 2 * pad, height - 2 * pad, { fit: "inside" })
        .flatten({ background: "#ffffff" })
        .toBuffer();
    return sharp({ create: { width, height, channels: 3, background: BORDER } })
        .composite([{ input: inner, gravity: "centre" }])
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
}

// The feed needs each file's size, so crops are made once per build and reused.
const made = new Map<string, Promise<Buffer>>();

/** The cropped JPEG for a story (call only when hasSocialImage(story) is true). */
export function socialCrop(story: Story, kind: CropKind): Promise<Buffer> {
    const key = `${story.slug}:${kind}`;
    let crop = made.get(key);
    if (!crop) {
        const file = getStoryImageFile(story.socialImage);
        if (!file) throw new Error(`Story "${story.slug}" has no sharing photo to crop.`);
        const { width, height } = CROPS[kind];
        crop =
            story.imageFocus === "whole"
                ? wholePhoto(file, width, height)
                : sharp(file)
                      .rotate() // respect phone camera orientation
                      .resize(width, height, { fit: "cover", position: story.imageFocus })
                      .flatten({ background: "#ffffff" }) // transparent PNGs get a white background
                      .jpeg({ quality: 82, mozjpeg: true })
                      .toBuffer();
        made.set(key, crop);
    }
    return crop;
}
