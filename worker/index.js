/**
 * Standalone membership Worker. The logic lives in membership.js; the
 * Workers runtime only allows handlers as exports here.
 */
import { handleMembership } from "./membership.js";
import { MONTHLY_CRON, refreshWalletPasses } from "./google-wallet.js";
import { keepBrevoKeyAlive } from "./welcome-email.js";
import { sendPaymentAlert } from "./payment-alerts.js";

export default {
    async fetch(request, env, ctx) {
        return (await handleMembership(request, env, ctx)) ?? new Response("Not found", { status: 404 });
    },

    /**
     * wrangler.toml [triggers]: hourly on the 1st to the 3rd, moves Google
     * Wallet passes on to the new month; weekly, keeps the Brevo key alive
     * and emails the organisers about failed membership payments.
     */
    async scheduled(controller, env, ctx) {
        if (controller.cron === MONTHLY_CRON) {
            ctx.waitUntil(refreshWalletPasses(env));
            return;
        }
        ctx.waitUntil(keepBrevoKeyAlive(env));
        ctx.waitUntil(sendPaymentAlert(env));
    },
};
