/**
 * Hides events that have finished since the site was built, keeps the
 * homepage preview at its limit, and shows a notice if the data is stale.
 */
export function refreshEventLists(now: number = Date.now()) {
    document.querySelectorAll<HTMLElement>("[data-event-list]").forEach((list) => {
        const limit = Number(list.dataset.limit) || Infinity;
        const cards = [...list.querySelectorAll<HTMLElement>("[data-event-card]")];

        let shown = 0;
        for (const card of cards) {
            const ended = Number(card.dataset.eventEnd) <= now;
            const visible = !ended && shown < limit;
            card.hidden = !visible;
            if (visible) shown++;
        }

        const items = list.querySelector<HTMLElement>("[data-event-items]");
        const empty = list.querySelector<HTMLElement>("[data-event-empty]");
        if (items) items.hidden = shown === 0;
        if (empty) empty.hidden = shown > 0;

        const asOf = Date.parse(list.dataset.asOf ?? "");
        const staleMs = Number(list.dataset.staleMs);
        const notice = list.querySelector<HTMLElement>("[data-stale-notice]");
        if (notice) notice.hidden = !(Number.isNaN(asOf) || (staleMs > 0 && now - asOf > staleMs));
    });
}
