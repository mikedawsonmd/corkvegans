/**
 * Standalone donations Worker: only /donate/session exists. The logic lives in
 * donate.js; the Workers runtime only allows handlers as exports here.
 */
import { handleDonate } from "./donate.js";

export default {
    async fetch(request, env) {
        return (await handleDonate(request, env)) ?? new Response("Not found", { status: 404 });
    },
};
