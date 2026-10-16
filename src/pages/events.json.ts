import type { APIRoute } from "astro";
import { getSnapshot } from "../lib/events/data";

/**
 * Publishes the event snapshot used for this build. The next scheduled build
 * reads it back as "previous data", so a failing source never empties the list.
 */
export const GET: APIRoute = () =>
    new Response(JSON.stringify(getSnapshot()), { headers: { "Content-Type": "application/json" } });
