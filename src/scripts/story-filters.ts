/**
 * Stories page filters: category, search and sort, applied in the browser to
 * the full list rendered at build time. The view lives in the address
 * (?category=reviews&q=pizza&sort=oldest) so it can be shared, and "Show more"
 * reveals stories a batch at a time. Without JavaScript every story is listed.
 */

export type StorySort = "newest" | "oldest" | "title";

export interface StoryItem {
    category: string; // slug, e.g. "reviews"
    date: string; // ISO date
    title: string;
    text: string; // lower-cased title, summary, author and category
}

export interface FilterState {
    category: string; // "" = all
    query: string;
    sort: StorySort;
}

const SORTS: StorySort[] = ["newest", "oldest", "title"];

/** Below this many stories there's nothing worth filtering, so the controls stay hidden. */
export const MIN_STORIES_FOR_FILTERS = 4;

export function readState(params: URLSearchParams): FilterState {
    const sort = params.get("sort") as StorySort;
    return {
        category: (params.get("category") ?? "").trim().toLowerCase(),
        query: (params.get("q") ?? "").trim(),
        sort: SORTS.includes(sort) ? sort : "newest",
    };
}

/** The query string for a state, leaving out defaults ("" when nothing is set). */
export function stateToSearch(state: FilterState): string {
    const params = new URLSearchParams();
    if (state.category) params.set("category", state.category);
    if (state.query) params.set("q", state.query);
    if (state.sort !== "newest") params.set("sort", state.sort);
    const s = params.toString();
    return s ? `?${s}` : "";
}

/** Indexes of matching items, in display order. Every search word must match. */
export function applyFilters(items: StoryItem[], state: FilterState): number[] {
    const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = items
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => (!state.category || item.category === state.category) && words.every((w) => item.text.includes(w)));

    const byDate = (a: StoryItem, b: StoryItem) => a.date.localeCompare(b.date);
    const byTitle = (a: StoryItem, b: StoryItem) => a.title.localeCompare(b.title, "en", { sensitivity: "base" });
    matches.sort(({ item: a, i: ia }, { item: b, i: ib }) => {
        const order = state.sort === "oldest" ? byDate(a, b) : state.sort === "title" ? byTitle(a, b) : byDate(b, a);
        return order || ia - ib;
    });
    return matches.map(({ i }) => i);
}

/** e.g. "13 stories", "1 story in Reviews", "2 stories matching “pizza”". */
export function describeResults(count: number, state: FilterState, categoryLabel: string): string {
    let text = `${count} ${count === 1 ? "story" : "stories"}`;
    if (state.category) text += ` in ${categoryLabel}`;
    if (state.query) text += ` matching “${state.query}”`;
    return text;
}

export function initStoryFilters(root: HTMLElement) {
    const list = root.querySelector<HTMLElement>("[data-story-list]")!;
    const cards = [...list.querySelectorAll<HTMLElement>("[data-story]")];
    if (cards.length < MIN_STORIES_FOR_FILTERS) return;
    const controls = root.querySelector<HTMLElement>("[data-story-filters]")!;
    const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-category-chip]")];
    const search = root.querySelector<HTMLInputElement>("[data-story-search]")!;
    const sort = root.querySelector<HTMLSelectElement>("[data-story-sort]")!;
    const count = root.querySelector<HTMLElement>("[data-story-count]")!;
    const none = root.querySelector<HTMLElement>("[data-story-none]")!;
    const more = root.querySelector<HTMLButtonElement>("[data-story-more]")!;
    const batch = Number(root.dataset.batch) || 12;

    const items: StoryItem[] = cards.map((card) => ({
        category: card.dataset.category ?? "",
        date: card.dataset.date ?? "",
        title: card.dataset.title ?? "",
        text: card.dataset.text ?? "",
    }));
    const labels = new Map(chips.map((c) => [c.dataset.categoryChip ?? "", c.dataset.label ?? ""]));

    let state = readState(new URLSearchParams(location.search));
    if (state.category && !labels.has(state.category)) state = { ...state, category: "" };
    let shown = batch;

    function render() {
        const order = applyFilters(items, state);
        cards.forEach((card) => (card.hidden = true));
        order.forEach((index, position) => {
            list.append(cards[index]); // re-order to match the sort
            cards[index].hidden = position >= shown;
        });

        // Animals standing on the first card (AnimalSpots.astro) move to
        // whichever card is first now, so they never end up between rows.
        const animals = list.querySelector<HTMLElement>(".cv-animal-group");
        if (animals) {
            const first = order.length ? cards[order[0]].querySelector("article") : null;
            const current = animals.parentElement!;
            if (first && first !== current) {
                first.toggleAttribute("data-animal-hop", current.hasAttribute("data-animal-hop"));
                current.removeAttribute("data-animal-hop");
                first.append(animals);
            }
            animals.hidden = !first;
        }

        chips.forEach((chip) => chip.setAttribute("aria-pressed", String((chip.dataset.categoryChip ?? "") === state.category)));
        search.value = state.query;
        sort.value = state.sort;
        count.textContent = describeResults(order.length, state, labels.get(state.category) ?? "");
        none.hidden = order.length > 0;
        more.hidden = order.length <= shown;
    }

    function update(next: Partial<FilterState>, { push }: { push: boolean }) {
        state = { ...state, ...next };
        shown = batch;
        const url = `${location.pathname}${stateToSearch(state)}`;
        if (push) history.pushState(null, "", url);
        else history.replaceState(null, "", url);
        render();
    }

    chips.forEach((chip) => chip.addEventListener("click", () => update({ category: chip.dataset.categoryChip ?? "" }, { push: true })));
    sort.addEventListener("change", () => update({ sort: sort.value as StorySort }, { push: true }));
    let typing: number | undefined;
    search.addEventListener("input", () => {
        window.clearTimeout(typing);
        typing = window.setTimeout(() => update({ query: search.value.trim() }, { push: false }), 200);
    });
    search.form?.addEventListener("submit", (e) => e.preventDefault());
    root.querySelectorAll<HTMLButtonElement>("[data-story-clear]").forEach((b) =>
        b.addEventListener("click", () => {
            update({ category: "", query: "", sort: "newest" }, { push: true });
            search.focus();
        }),
    );
    more.addEventListener("click", () => {
        const firstNew = applyFilters(items, state)[shown];
        shown += batch;
        render();
        if (firstNew !== undefined) cards[firstNew].querySelector<HTMLElement>("h2 a, h3 a")?.focus();
    });
    window.addEventListener("popstate", () => {
        state = readState(new URLSearchParams(location.search));
        shown = batch;
        render();
    });

    controls.hidden = false;
    render();
}
