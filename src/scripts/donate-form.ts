/**
 * Donation form: asks the Worker for a Checkout Session, then mounts Stripe
 * Embedded Checkout in place of the form. Stripe.js (and Turnstile, when a
 * site key is configured) load only on pages that include the form.
 */

import { formatAmount, parseAmount, type Frequency } from "../lib/donations.ts";

const STRIPE_JS = "https://js.stripe.com/endive/stripe.js";
const TURNSTILE_JS = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface EmbeddedCheckout {
    mount(target: HTMLElement): void;
    destroy(): void;
}
interface StripeInstance {
    createEmbeddedCheckoutPage(options: { fetchClientSecret: () => Promise<string>; onComplete?: () => void }): Promise<EmbeddedCheckout>;
}
interface Turnstile {
    render(container: HTMLElement, options: Record<string, unknown>): string;
    reset(widgetId: string): void;
}
declare global {
    interface Window {
        Stripe?: (publishableKey: string) => StripeInstance;
        turnstile?: Turnstile;
    }
}

export class DonateError extends Error {
    constructor(readonly kind: "rate_limited" | "failed") {
        super(kind);
    }
}

const FAILURE_MESSAGES: Record<DonateError["kind"], string> = {
    failed: "Sorry, the donation form couldn't load just now.",
    rate_limited: "You've tried a few times in a row, so we've paused things for a minute.",
};

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
    if (!scripts.has(src)) {
        scripts.set(
            src,
            new Promise((resolve, reject) => {
                const el = document.createElement("script");
                el.src = src;
                el.async = true;
                el.onload = () => resolve();
                el.onerror = () => reject(new DonateError("failed"));
                document.head.append(el);
            }),
        );
    }
    return scripts.get(src)!;
}

/** POSTs the donation to the Worker and returns the Checkout Session client secret. */
export async function requestClientSecret(endpoint: string, body: { frequency: Frequency; amount: number; turnstileToken?: string }): Promise<string> {
    let res: Response;
    try {
        res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
        });
    } catch {
        throw new DonateError("failed");
    }
    if (res.status === 429) throw new DonateError("rate_limited");
    const data = await res.json().catch(() => null);
    if (!res.ok || typeof data?.clientSecret !== "string") throw new DonateError("failed");
    return data.clientSecret;
}

/** Invisible unless Cloudflare needs the visitor to tick a box. Tokens are single use. */
function setupTurnstile(container: HTMLElement, sitekey: string) {
    let token = "";
    let widgetId: string | undefined;
    const waiting: ((value: string) => void)[] = [];
    const ready = loadScript(TURNSTILE_JS).then(() => {
        widgetId = window.turnstile!.render(container, {
            sitekey,
            appearance: "interaction-only",
            callback: (value: string) => {
                token = value;
                waiting.splice(0).forEach((resolve) => resolve(value));
            },
            "expired-callback": () => (token = ""),
            "error-callback": () => (token = ""),
        });
    });
    return {
        async token(timeoutMs = 15_000): Promise<string> {
            await ready;
            if (token) return token;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new DonateError("failed")), timeoutMs);
                waiting.push((value) => {
                    clearTimeout(timer);
                    resolve(value);
                });
            });
        },
        reset() {
            token = "";
            if (widgetId !== undefined) window.turnstile?.reset(widgetId);
        },
    };
}

/** Stops the page behind a modal scrolling (including iOS) and puts it back where it was. */
function lockScroll() {
    const { body } = document;
    const scrollY = window.scrollY;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    Object.assign(body.style, { position: "fixed", top: `-${scrollY}px`, left: "0", right: "0", paddingRight: scrollbar ? `${scrollbar}px` : "" });
    return () => {
        Object.assign(body.style, { position: "", top: "", left: "", right: "", paddingRight: "" });
        window.scrollTo({ top: scrollY, behavior: "instant" });
    };
}

export function initDonateForm(root: HTMLElement) {
    const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const form = $<HTMLFormElement>("[data-donate-form]");
    const otherWrap = $("[data-other-wrap]");
    const otherInput = $<HTMLInputElement>("#df-other");
    const amountError = $("[data-amount-error]");
    const failure = $("[data-donate-error]");
    const failureMessage = $("[data-donate-error-message]");
    const continueButton = $<HTMLButtonElement>("[data-continue]");
    const status = $("[data-donate-status]");
    const dialog = $<HTMLDialogElement>("[data-donate-dialog]");
    const dialogTitle = $("[data-dialog-title]");
    const mountPoint = $("[data-checkout]");
    const success = $("[data-donate-success]");
    const successMonthly = root.querySelector<HTMLElement>("[data-success-monthly]"); // only when a manage link is configured

    const { publishableKey = "", endpoint = "", turnstileSitekey } = root.dataset;
    const stripeReady = loadScript(STRIPE_JS).then(() => {
        if (!window.Stripe) throw new DonateError("failed");
        return window.Stripe(publishableKey);
    });
    stripeReady.catch(() => {}); // reported when the visitor presses Continue
    const turnstile = turnstileSitekey ? setupTurnstile($("[data-turnstile]"), turnstileSitekey) : null;

    let checkout: EmbeddedCheckout | null = null;
    let completed = false;
    let unlockScroll: (() => void) | null = null;
    let busy = false;

    const frequency = () => (form.querySelector<HTMLInputElement>('input[name="frequency"]:checked')?.value ?? "monthly") as Frequency;
    const selectedAmount = () => form.querySelector<HTMLInputElement>(`input[name="amount-${frequency()}"]:checked`);

    function clearAmountError() {
        amountError.textContent = "";
        otherInput.removeAttribute("aria-invalid");
    }

    function sync() {
        form.querySelectorAll<HTMLFieldSetElement>("[data-amounts]").forEach((fieldset) => {
            const active = fieldset.dataset.amounts === frequency();
            fieldset.hidden = !active;
            fieldset.disabled = !active;
        });
        otherWrap.hidden = selectedAmount()?.value !== "other";
        clearAmountError();
    }

    function closeCheckout() {
        checkout?.destroy();
        checkout = null;
        mountPoint.replaceChildren();
    }

    function openDialog(title: string) {
        dialogTitle.textContent = title;
        mountPoint.hidden = false;
        success.hidden = true;
        completed = false;
        unlockScroll = lockScroll();
        dialog.showModal();
        dialogTitle.focus();
    }

    // Every way of closing (X, Escape, backdrop, the Close button) ends here.
    dialog.addEventListener("close", () => {
        closeCheckout(); // a fresh Checkout Session is created next time
        unlockScroll?.();
        unlockScroll = null;
        if (completed) {
            form.reset();
            sync();
        }
        continueButton.focus({ preventScroll: true });
    });
    $("[data-dialog-close]").addEventListener("click", () => dialog.close());
    $("[data-dialog-done]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
        // The <dialog> is a full-screen layer, so clicks around the panel land on it.
        if (event.target === dialog && !completed) dialog.close();
    });

    form.addEventListener("change", (event) => {
        const name = (event.target as HTMLInputElement).name;
        if (name === "frequency" || name.startsWith("amount-")) sync();
    });
    otherInput.addEventListener("input", clearAmountError);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        failure.hidden = true;

        const freq = frequency();
        let amount = Number(selectedAmount()?.value);
        if (selectedAmount()?.value === "other") {
            const result = parseAmount(otherInput.value);
            if ("error" in result) {
                amountError.textContent = result.error;
                otherInput.setAttribute("aria-invalid", "true");
                otherInput.focus();
                return;
            }
            amount = result.amount;
        }

        busy = true;
        continueButton.disabled = true;
        status.textContent = "Loading secure checkout…";
        try {
            const turnstileToken = turnstile ? await turnstile.token() : undefined;
            const [stripe, clientSecret] = await Promise.all([stripeReady, requestClientSecret(endpoint, { frequency: freq, amount, turnstileToken })]);
            closeCheckout(); // Stripe allows one embedded checkout at a time
            checkout = await stripe.createEmbeddedCheckoutPage({
                fetchClientSecret: () => Promise.resolve(clientSecret),
                onComplete: () => {
                    completed = true;
                    closeCheckout();
                    mountPoint.hidden = true;
                    if (successMonthly) successMonthly.hidden = freq !== "monthly";
                    success.hidden = false;
                    success.focus();
                },
            });
            openDialog(`Donate ${formatAmount(amount, freq)}`);
            checkout.mount(mountPoint);
        } catch (err) {
            closeCheckout();
            if (dialog.open) dialog.close();
            failureMessage.textContent = FAILURE_MESSAGES[err instanceof DonateError ? err.kind : "failed"];
            failure.hidden = false;
        } finally {
            busy = false;
            continueButton.disabled = false;
            status.textContent = "";
            turnstile?.reset();
        }
    });

    sync();
}
