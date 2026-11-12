import { describe, expect, it, vi } from "vitest";
import { isMemberTicket, mergeTicketIds, syncMemberTickets } from "../../src/lib/events/member-tickets.ts";

describe("member tickets", () => {
    it("recognises hidden tickets named for members", () => {
        for (const name of ["Member ticket", "Member discount", "Members only", "MEMBER early bird"]) expect(isMemberTicket({ id: "1", name, hidden: true })).toBe(true);
        for (const name of ["General Admission", "Non-member", "Non member ticket", "Remembrance walk"]) expect(isMemberTicket({ id: "1", name, hidden: true })).toBe(false);
        expect(isMemberTicket({ id: "1", name: "Member ticket", hidden: false })).toBe(false);
        expect(isMemberTicket({ name: "Member ticket", hidden: true })).toBe(false);
    });

    it("keeps the group's tickets and only reports a change when something is new", () => {
        const current = { past: ["1"], ev: ["2"] };
        expect(mergeTicketIds(current, { ev: ["2"] })).toBeNull();
        expect(mergeTicketIds(current, { ev: ["2", "3"], next: ["4"] })).toEqual({ past: ["1"], ev: ["2", "3"], next: ["4"] });
        expect(current).toEqual({ past: ["1"], ev: ["2"] });
    });

    function fakeEventbrite(group: Record<string, string[]>, codes: { id: string; amount_off: string; end_date: string }[] = [], failCode?: string) {
        const posts: unknown[] = [];
        const codePosts: { id: string; body: unknown }[] = [];
        const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
            expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
            const path = new URL(url).pathname;
            const code = /^\/v3\/discounts\/(\w+)\/$/.exec(path);
            if (init.method === "POST" && code) {
                if (code[1] === failCode) return new Response("nope", { status: 500 });
                codePosts.push({ id: code[1], body: JSON.parse(String(init.body)) });
                return Response.json({ id: code[1] });
            }
            if (path === "/v3/organizations/9/discounts/") {
                expect(new URL(url).searchParams.get("ticket_group_id")).toBe("77");
                expect(new URL(url).searchParams.get("scope")).toBe("multi_events");
                return Response.json({ discounts: codes });
            }
            if (init.method === "POST") {
                posts.push(JSON.parse(String(init.body)));
                return Response.json({ id: "77", event_ticket_ids: {} });
            }
            if (path === "/v3/organizations/9/events/") {
                expect(new URL(url).searchParams.get("status")).toBe("draft,live,started");
                return Response.json({ events: [{ id: "e1", name: { text: "Supper club" } }, { id: "e2", name: { text: "Talk" } }] });
            }
            if (path === "/v3/events/e1/ticket_classes/") {
                return Response.json({ ticket_classes: [{ id: "t1", name: "General Admission", hidden: false }, { id: "t2", name: "Member ticket", hidden: true }] });
            }
            if (path === "/v3/events/e2/ticket_classes/") return Response.json({ ticket_classes: [{ id: "t3", name: "Free entry", hidden: false }] });
            if (path === "/v3/ticket_groups/77/") return Response.json({ name: "Members", event_ticket_ids: group });
            return new Response("not found", { status: 404 });
        });
        return { fetchImpl: fetchImpl as unknown as typeof fetch, posts, codePosts };
    }

    it("adds new member tickets to the group without dropping the others", async () => {
        const { fetchImpl, posts } = fakeEventbrite({ old: ["t0"] });
        const lines: string[] = [];
        const result = await syncMemberTickets({ token: "secret-token", organizationId: "9", ticketGroupId: "77", fetchImpl, log: (l) => lines.push(l) });
        expect(posts).toEqual([{ ticket_group: { event_ticket_ids: { old: ["t0"], e1: ["t2"] } } }]);
        expect(result.added).toEqual([{ event: "Supper club", ticket: "Member ticket" }]);
        expect(lines).toEqual(['Member tickets: added "Member ticket" (Supper club) to the Members group', "Member tickets: re-saved 0 member codes so they cover every member ticket"]);
    });

    it("leaves the group alone when every member ticket is already in it", async () => {
        const { fetchImpl, posts } = fakeEventbrite({ e1: ["t2"] });
        expect((await syncMemberTickets({ token: "secret-token", organizationId: "9", ticketGroupId: "77", fetchImpl, log: () => {} })).added).toEqual([]);
        expect(posts).toEqual([]);
    });

    // A code only discounts tickets that were in the group when it was last
    // saved, so every run re-saves each member code with its own values.
    it("re-saves every member code unchanged, so codes made before a ticket was added still discount it", async () => {
        const codes = [
            { id: "d1", amount_off: "5.00", end_date: "2026-12-15T14:06:27" },
            { id: "d2", amount_off: "5.00", end_date: "2027-11-15T13:04:05" },
        ];
        const groups: Record<string, string[]>[] = [{ old: ["t0"] }, { e1: ["t2"] }];
        for (const group of groups) {
            const { fetchImpl, codePosts } = fakeEventbrite(group, codes);
            const lines: string[] = [];
            expect((await syncMemberTickets({ token: "secret-token", organizationId: "9", ticketGroupId: "77", fetchImpl, log: (l) => lines.push(l) })).refreshed).toBe(2);
            expect(codePosts).toEqual([
                { id: "d1", body: { discount: { amount_off: "5.00", end_date: "2026-12-15T14:06:27" } } },
                { id: "d2", body: { discount: { amount_off: "5.00", end_date: "2027-11-15T13:04:05" } } },
            ]);
            expect(lines.at(-1)).toBe("Member tickets: re-saved 2 member codes so they cover every member ticket");
        }
    });

    it("re-saves the other codes when one fails, then reports it so the run shows a warning", async () => {
        const codes = [
            { id: "d1", amount_off: "5.00", end_date: "2026-12-15T14:06:27" },
            { id: "d2", amount_off: "5.00", end_date: "2027-11-15T13:04:05" },
        ];
        const { fetchImpl, codePosts } = fakeEventbrite({ e1: ["t2"] }, codes, "d1");
        const err = await syncMemberTickets({ token: "secret-token", organizationId: "9", ticketGroupId: "77", fetchImpl, log: () => {} }).catch((e: Error) => e);
        expect((err as Error).message).toBe("1 member code could not be re-saved");
        expect(codePosts.map((p) => p.id)).toEqual(["d2"]);
    });

    it("throws a message that never includes the token", async () => {
        const fetchImpl = vi.fn(async () => new Response("secret-token", { status: 403 })) as unknown as typeof fetch;
        const err = await syncMemberTickets({ token: "secret-token", organizationId: "9", ticketGroupId: "77", fetchImpl }).catch((e: Error) => e);
        expect((err as Error).message).toBe("Eventbrite API returned HTTP 403 for /organizations/9/events/");
    });
});
