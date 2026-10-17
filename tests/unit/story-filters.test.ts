import { describe, expect, it } from "vitest";
import { applyFilters, describeResults, readState, stateToSearch, type StoryItem } from "../../src/scripts/story-filters.ts";

const item = (title: string, category: string, date: string, extra = ""): StoryItem => ({
    title,
    category,
    date,
    text: `${title} ${extra} ${category}`.toLowerCase(),
});

const items = [
    item("Pizza night at My Goodness", "reviews", "2026-09-01", "great vegan pizza in cork"),
    item("Autumn potluck", "community", "2026-10-01", "by Aoife"),
    item("Douglas walk", "events", "2026-08-15", "a walk in Douglas"),
    item("apple tart recipe", "guides", "2026-10-01", "baking"),
];
const state = (over: Partial<ReturnType<typeof readState>> = {}) => ({ category: "", query: "", sort: "newest" as const, ...over });

describe("stories filters", () => {
    it("lists newest first by default, keeping the original order for ties", () => {
        expect(applyFilters(items, state())).toEqual([1, 3, 0, 2]);
    });

    it("sorts oldest first and by title, ignoring case", () => {
        expect(applyFilters(items, state({ sort: "oldest" }))).toEqual([2, 0, 1, 3]);
        expect(applyFilters(items, state({ sort: "title" }))).toEqual([3, 1, 2, 0]);
    });

    it("filters by category", () => {
        expect(applyFilters(items, state({ category: "reviews" }))).toEqual([0]);
    });

    it("searches every word, case-insensitively, across title, summary and author", () => {
        expect(applyFilters(items, state({ query: "PIZZA cork" }))).toEqual([0]);
        expect(applyFilters(items, state({ query: "aoife" }))).toEqual([1]);
        expect(applyFilters(items, state({ query: "pizza douglas" }))).toEqual([]);
    });

    it("combines category and search", () => {
        expect(applyFilters(items, state({ category: "events", query: "walk" }))).toEqual([2]);
        expect(applyFilters(items, state({ category: "reviews", query: "walk" }))).toEqual([]);
    });
});

describe("filter state in the address", () => {
    it("reads and writes the query string, leaving out defaults", () => {
        const s = readState(new URLSearchParams("category=Reviews&q=pizza&sort=oldest"));
        expect(s).toEqual({ category: "reviews", query: "pizza", sort: "oldest" });
        expect(stateToSearch(s)).toBe("?category=reviews&q=pizza&sort=oldest");
        expect(stateToSearch(state())).toBe("");
    });

    it("ignores an unknown sort", () => {
        expect(readState(new URLSearchParams("sort=random")).sort).toBe("newest");
    });
});

describe("result summary", () => {
    it("describes what's shown", () => {
        expect(describeResults(13, state(), "")).toBe("13 stories");
        expect(describeResults(1, state({ category: "reviews" }), "Reviews")).toBe("1 story in Reviews");
        expect(describeResults(2, state({ query: "pizza" }), "")).toBe("2 stories matching “pizza”");
    });
});
