/**
 * Standalone membership Worker. The logic lives in membership.js; the
 * Workers runtime only allows handlers as exports here.
 */
import { handleMembership } from "./membership.js";
import { MONTHLY_CRON, refreshWalletPasses } from "./google-wallet.js";
import { keepBrevoKeyAlive } from "./welcome-email.js";

export default {
    async fetch(request, env, ctx) {
        return (await handleMembership(request, env, ctx)) ?? new Response("Not found", { status: 404 });
    },

    /**
     * wrangler.toml [triggers]: hourly on the 1st to the 3rd, moves Google
     * Wallet passes on to the new month; weekly, keeps the Brevo key alive.
     */
    async scheduled(controller, env, ctx) {
        ctx.waitUntil(controller.cron === MONTHLY_CRON ? refreshWalletPasses(env) : keepBrevoKeyAlive(env));
    },
};
