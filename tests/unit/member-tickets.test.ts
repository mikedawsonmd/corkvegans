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

    function fakeEventbrite(group: Record<string, string[]>) {
        const posts: unknown[] = [];
        const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
            expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
            const path = new URL(url).pathname;
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
        return { fetchImpl: fetchImpl as unknown as typeof fetch, posts };
    }

    it("adds new member tickets to the group without dropping the others", async () => {
        const { fetchImpl, posts } = fakeEventbrite({ old: ["t0"] });
        const lines: string[] = [];
        const result = await syncMemberTickets({ token: "secret-token", organizationId: "9", ticketGroupId: "77", fetchImpl, log: (l) => lines.push(l) });
        expect(posts).toEqual([{ ticket_group: { event_ticket_ids: { old: ["t0"], e1: ["t2"] } } }]);
        expect(result.added).toEqual([{ event: "Supper club", ticket: "Member ticket" }]);
        expect(lines).toEqual(['Member tickets: added "Member ticket" (Supper club) to the Members group']);
    });

    it("changes nothing when every member ticket is already in the group", async () => {
        const { fetchImpl, posts } = fakeEventbrite({ e1: ["t2"] });
        expect((await syncMemberTickets({ token: "secret-token", organizationId: "9", ticketGroupId: "77", fetchImpl, log: () => {} })).added).toEqual([]);
        expect(posts).toEqual([]);
    });

    it("throws a message that never includes the token", async () => {
        const fetchImpl = vi.fn(async () => new Response("secret-token", { status: 403 })) as unknown as typeof fetch;
        const err = await syncMemberTickets({ token: "secret-token", organizationId: "9", ticketGroupId: "77", fetchImpl }).catch((e: Error) => e);
        expect((err as Error).message).toBe("Eventbrite API returned HTTP 403 for /organizations/9/events/");
    });
});
