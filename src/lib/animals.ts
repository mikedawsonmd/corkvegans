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
