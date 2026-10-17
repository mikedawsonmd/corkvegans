/**
 * The animal illustrations in public/images/illustrations/.
 *
 * `scale` is each animal's height relative to the cow, so animals shown
 * together stay in proportion (a chicken is smaller than a pig, a pig smaller
 * than a cow). `facing` is the way the drawing looks; placements can ask for
 * "left" or "right" and the image is mirrored when needed. Set `roams: false`
 * to keep an animal out of the random placements (the shark lives on the 404
 * page only).
 *
 * To add a drawing: put a single-colour SVG with the feet touching the bottom
 * edge in public/images/illustrations/ and add it here. It joins the random
 * groups automatically.
 */

export type Facing = "left" | "right" | "front";

export interface AnimalArt {
    src: string;
    width: number;
    height: number;
    scale: number;
    facing: Facing;
    roams?: boolean;
}

export const animals = {
    cow: { src: "/images/illustrations/cow.svg", width: 479, height: 355, scale: 1, facing: "left" },
    sheep: { src: "/images/illustrations/sheep.svg", width: 309, height: 348, scale: 0.74, facing: "front" },
    pig: { src: "/images/illustrations/pig.svg", width: 438, height: 317, scale: 0.68, facing: "right" },
    cat: { src: "/images/illustrations/cat.svg", width: 292, height: 348, scale: 0.46, facing: "front" },
    chicken: { src: "/images/illustrations/chicken.svg", width: 383, height: 380, scale: 0.42, facing: "right" },
    shark: { src: "/images/illustrations/basking_shark.svg", width: 475, height: 263, scale: 1, facing: "right", roams: false },
} satisfies Record<string, AnimalArt>;

export type AnimalName = keyof typeof animals;

/** Animals used in the random footer and page placements. */
export const roamingAnimals = (Object.keys(animals) as AnimalName[]).filter(
    (name) => (animals[name] as AnimalArt).roams !== false,
);

/** True when the drawing must be mirrored to look the requested way. */
export function isFlipped(name: AnimalName, face?: Facing): boolean {
    const facing: Facing = animals[name].facing;
    return face !== undefined && face !== "front" && facing !== "front" && face !== facing;
}

// ── Random placements (see AnimalSpots.astro) ─────────────────────────────
// On each page load the animals are shuffled and dealt out without repeats:
// first a group of 2–3 for the footer, then groups of 2–3 for spots around the
// page (marked with animalSpot()) while animals remain. An animal never
// appears twice on a page, and singles are only used when nothing else is.

/** Most groups placed around the page (on top of the footer). */
export const spotsPerPage = 2;

/** Two placements must be at least this far apart vertically (px), so a
 *  page header and the card right below it never both get animals. */
export const minSpotGap = 300;

/**
 * Where the animals sit:
 *   ledge – standing on the element's top edge (images, cards)
 *   floor – walking along the element's bottom edge, inside it (the hero,
 *           page headers, and the wide margins at the foot of sections)
 */
export type SpotKind = "ledge" | "floor";

/**
 * Colour, chosen to sit gently on the surface behind:
 *   soft  – the page background
 *   light – on photos and dark panels
 */
export type Tone = "soft" | "light";

const spotDefaults: Record<SpotKind, { size: number; max: number; tone: Tone }> = {
    ledge: { size: 38, max: 3, tone: "soft" },
    floor: { size: 34, max: 3, tone: "soft" },
};

/**
 * Attributes that mark an element as a possible animal spot. The element
 * must be `position: relative`. Spots sharing a `zone` count as one choice.
 * `size` is the height in px of the tallest animal; `max` the largest group;
 * `weight` makes a zone more (or less) likely to be picked. Floors stay in the
 * outer part of the width (the wide margins on desktop); `room` makes a floor
 * add bottom padding when used, so the animals never touch the content.
 * `hop` is for cards that lift on hover: put the spot on the element that
 * moves and the animals ride along, each giving a little hop.
 */
export function animalSpot(
    kind: SpotKind,
    zone: string,
    options: { size?: number; max?: number; tone?: Tone; weight?: number; room?: boolean; hop?: boolean } = {},
) {
    const { size, max, tone } = { ...spotDefaults[kind], ...options };
    return {
        "data-animal-spot": kind,
        "data-animal-zone": zone,
        "data-animal-size": String(size),
        "data-animal-max": String(max),
        "data-animal-tone": tone,
        ...(options.weight ? { "data-animal-weight": String(options.weight) } : {}),
        ...(options.room ? { "data-animal-room": "" } : {}),
        ...(options.hop ? { "data-animal-hop": "" } : {}),
    };
}
