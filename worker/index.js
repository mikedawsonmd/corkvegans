/**
 * Standalone membership Worker. The logic lives in membership.js; the
 * Workers runtime only allows handlers as exports here.
 */
import { handleMembership } from "./membership.js";
import { keepBrevoKeyAlive } from "./welcome-email.js";

export default {
    async fetch(request, env, ctx) {
        return (await handleMembership(request, env, ctx)) ?? new Response("Not found", { status: 404 });
    },

    /** Weekly (wrangler.toml [triggers]): keeps the Brevo API key from expiring. */
    async scheduled(_controller, env, ctx) {
        ctx.waitUntil(keepBrevoKeyAlive(env));
    },
};
