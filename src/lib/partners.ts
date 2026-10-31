/**
 * Partner businesses that give members a discount, shown on the Membership
 * page. One YAML file each in src/content/partners/, edited in Pages CMS
 * ("Partners"). Hidden partners and files with problems are left out, so a
 * half-finished entry can't break the page.
 */

import { parse as parseYaml } from "yaml";

export interface Partner {
    name: string;
    /** Short, e.g. "10% off food". */
    discount: string;
    description: string;
    area: string;
    /** https only, or "". */
    website: string;
    /** As Pages CMS writes it, e.g. "/src/assets/partners/logo.png", or null. */
    logo: string | null;
    howToClaim: string;
}

export interface PartnerProblem {
    file: string;
    message: string;
}

export const DEFAULT_HOW_TO_CLAIM = "Show your membership card when you pay.";

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");

function httpsUrl(value: unknown): string {
    const raw = text(value, 300);
    if (!raw) return "";
    try {
        const url = new URL(/^[a-z]+:/i.test(raw) ? raw : `https://${raw}`);
        return url.protocol === "https:" ? url.href : "";
    } catch {
        return "";
    }
}

export type PartnerResult = { kind: "shown"; partner: Partner } | { kind: "hidden" } | { kind: "invalid"; problem: PartnerProblem };

export function parsePartnerFile(file: string, raw: string): PartnerResult {
    const fail = (message: string): PartnerResult => ({ kind: "invalid", problem: { file, message } });
    let data: unknown;
    try {
        data = parseYaml(raw);
    } catch (err) {
        return fail(`The file could not be read: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("The file is empty or not a set of fields.");
    const d = data as Record<string, unknown>;
    // Missing = shown (files added by hand); Pages CMS always writes the field.
    if (d.hidden === true || d.hidden === "true") return { kind: "hidden" };

    const name = text(d.name, 80);
    if (!name) return fail("Missing business name.");
    const discount = text(d.discount, 80);
    if (!discount) return fail("Missing discount.");
    const logo = typeof d.logo === "string" && d.logo.trim() ? d.logo.trim() : null;
    return {
        kind: "shown",
        partner: {
            name,
            discount,
            description: text(d.description, 300),
            area: text(d.area, 60),
            website: httpsUrl(d.website),
            logo,
            howToClaim: text(d.howToClaim, 200) || DEFAULT_HOW_TO_CLAIM,
        },
    };
}

/** Shown partners in name order, and any problems to report at build time. */
export function collectPartners(files: Record<string, string>): { partners: Partner[]; problems: PartnerProblem[] } {
    const partners: Partner[] = [];
    const problems: PartnerProblem[] = [];
    for (const [path, raw] of Object.entries(files)) {
        const result = parsePartnerFile(path.split("/").pop() ?? path, raw);
        if (result.kind === "shown") partners.push(result.partner);
        else if (result.kind === "invalid") problems.push(result.problem);
    }
    partners.sort((a, b) => a.name.localeCompare(b.name, "en-IE", { sensitivity: "base" }));
    return { partners, problems };
}

/** Maps a logo value from Pages CMS to a key in the image map; anything outside the partners folder is rejected. */
export function partnerLogoKey(value: string | null): string | null {
    if (!value) return null;
    const match = /(?:^|\/)assets\/partners\/(.+)$/.exec(value.trim());
    if (!match) return null;
    const rel = decodeURIComponent(match[1]);
    if (rel.split("/").some((part) => part === ".." || part === "")) return null;
    return `/src/assets/partners/${rel}`;
}
