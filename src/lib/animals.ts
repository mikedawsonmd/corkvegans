/**
 * The animal illustrations in public/images/illustrations/.
 *
 * `scale` is each animal's height relative to the cow, so animals shown
 * together stay in proportion (a chicken is smaller than a pig, a pig smaller
 * than a cow). `facing` is the way the drawing looks; placements can ask for
 * "left" or "right" and the image is mirrored when needed.
 */

export type Facing = "left" | "right" | "front";

export interface AnimalArt {
    src: string;
    width: number;
    height: number;
    scale: number;
    facing: Facing;
}

export const animals = {
    cow: { src: "/images/illustrations/cow.svg", width: 479, height: 355, scale: 1, facing: "left" },
    sheep: { src: "/images/illustrations/sheep.svg", width: 309, height: 348, scale: 0.74, facing: "front" },
    pig: { src: "/images/illustrations/pig.svg", width: 438, height: 317, scale: 0.68, facing: "right" },
    cat: { src: "/images/illustrations/cat.svg", width: 292, height: 348, scale: 0.46, facing: "front" },
    chicken: { src: "/images/illustrations/chicken.svg", width: 383, height: 380, scale: 0.42, facing: "right" },
    shark: { src: "/images/illustrations/basking_shark.svg", width: 475, height: 263, scale: 1, facing: "right" },
} satisfies Record<string, AnimalArt>;

export type AnimalName = keyof typeof animals;

/** True when the drawing must be mirrored to look the requested way. */
export function isFlipped(name: AnimalName, face?: Facing): boolean {
    const facing: Facing = animals[name].facing;
    return face !== undefined && face !== "front" && facing !== "front" && face !== facing;
}

export interface Placement {
    name: AnimalName;
    face?: Facing;
}

/**
 * Footer scenes: one is picked at random on each page load. Animals are
 * listed left to right and stand on the top edge of the green footer panel.
 */
export const footerScenes: { side: "left" | "right"; animals: Placement[] }[] = [
    { side: "right", animals: [{ name: "cow", face: "left" }] },
    { side: "left", animals: [{ name: "pig", face: "right" }, { name: "chicken", face: "right" }] },
    { side: "right", animals: [{ name: "chicken", face: "right" }, { name: "cow", face: "left" }] },
    { side: "left", animals: [{ name: "sheep" }, { name: "chicken", face: "left" }] },
    { side: "right", animals: [{ name: "cat" }, { name: "pig", face: "left" }] },
    { side: "left", animals: [{ name: "sheep" }, { name: "pig", face: "right" }, { name: "chicken", face: "right" }] },
    {
        side: "left",
        animals: [
            { name: "cow", face: "right" },
            { name: "sheep" },
            { name: "pig", face: "right" },
            { name: "cat" },
            { name: "chicken", face: "right" },
        ],
    },
];

// ── Animals around the page ───────────────────────────────────────────────
// Elements marked with animalSpot() are places an animal may appear. On each
// page load a script in BaseLayout picks a few spots (one per zone at most)
// and puts a random animal or group in each.

/** How many spots get animals on each page, on top of the footer scene. */
export const spotsPerPage = 2;

/**
 * Groups that may appear in a spot, listed left to right as if walking to
 * the right (the last animal leads). Mirrored as a whole when facing left.
 */
export const groupings: AnimalName[][] = [
    ["cow"],
    ["sheep"],
    ["pig"],
    ["cat"],
    ["chicken"],
    ["pig", "chicken"],
    ["cow", "chicken"],
    ["sheep", "chicken"],
    ["sheep", "pig"],
    ["cat", "chicken"],
    ["cow", "sheep"],
    ["sheep", "pig", "chicken"],
];

/**
 * Where the animals sit:
 *   ledge  – standing on the element's top edge (images, cards, lists of cards)
 *   bar    – standing on a section heading's coloured bar
 *   floor  – walking along the element's bottom edge, inside it (hero)
 */
export type SpotKind = "ledge" | "bar" | "floor";

/**
 * Colour, chosen to sit gently on the surface behind:
 *   soft  – the page background
 *   light – on photos and dark panels
 */
export type Tone = "soft" | "light";

const spotDefaults: Record<SpotKind, { size: number; max: number; tone: Tone }> = {
    ledge: { size: 38, max: 3, tone: "soft" },
    bar: { size: 34, max: 2, tone: "soft" },
    floor: { size: 46, max: 3, tone: "light" },
};

/**
 * Attributes that mark an element as a possible animal spot. The element
 * must be `position: relative`. Spots sharing a `zone` (e.g. all the cards in
 * one grid) count as one choice, so a page never gets two animals in the same
 * place. `size` is the height in px of the tallest animal; `max` the largest
 * group; `weight` makes a zone more (or less) likely to be picked.
 */
export function animalSpot(
    kind: SpotKind,
    zone: string,
    options: { size?: number; max?: number; tone?: Tone; weight?: number } = {},
) {
    const { size, max, tone } = { ...spotDefaults[kind], ...options };
    return {
        "data-animal-spot": kind,
        "data-animal-zone": zone,
        "data-animal-size": String(size),
        "data-animal-max": String(max),
        "data-animal-tone": tone,
        ...(options.weight ? { "data-animal-weight": String(options.weight) } : {}),
    };
}
