/**
 * Membership join form: asks the Worker for a Checkout Session, then mounts
 * Stripe Embedded Checkout in a modal. After payment the modal welcomes the
 * new member and shows their code once the Worker has made it. Also runs the
 * "Lost your code?" form. Stripe.js (and Turnstile, when a site key is
 * configured) load only on pages that include the form.
 */

import { DEFAULT_AMOUNT, amountHint, formatAmount, parseAmount, type Frequency } from "../lib/membership.ts";
import { saveMemberCode } from "./member-code.ts";
import { CARD_TOKEN, saveCardToken } from "./member-card.ts";
import { loadScript, setupTurnstile } from "./turnstile.ts";

const STRIPE_JS = "https://js.stripe.com/endive/stripe.js";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EmbeddedCheckout {
    mount(target: HTMLElement): void;
    destroy(): void;
}
interface StripeInstance {
    createEmbeddedCheckoutPage(options: { fetchClientSecret: () => Promise<string>; onComplete?: () => void }): Promise<EmbeddedCheckout>;
}
declare global {
    interface Window {
        Stripe?: (publishableKey: string) => StripeInstance;
    }
}

export class MembershipError extends Error {
    constructor(readonly kind: "rate_limited" | "failed") {
        super(kind);
    }
}

const FAILURE_MESSAGES: Record<MembershipError["kind"], string> = {
    failed: "Sorry, the membership form couldn't load just now.",
    rate_limited: "You've tried a few times in a row, so we've paused things for a minute.",
};

export interface JoinRequest {
    frequency: Frequency;
    amount: number;
    firstName: string;
    lastName: string;
    email: string;
    heardAbout: string;
    updates: boolean;
    terms: true;
    turnstileToken?: string;
}

async function post(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> | null }> {
    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
        });
    } catch {
        throw new MembershipError("failed");
    }
    if (res.status === 429) throw new MembershipError("rate_limited");
    return { status: res.status, data: await res.json().catch(() => null) };
}

/** POSTs the join details to the Worker and returns the Checkout Session client secret. */
export async function requestClientSecret(endpoint: string, body: JoinRequest): Promise<string> {
    const { status, data } = await post(`${endpoint}/membership/session`, body);
    if (status !== 200 || typeof data?.clientSecret !== "string") throw new MembershipError("failed");
    return data.clientSecret;
}

/**
 * The new member's code and card token. The Worker makes the code when
 * Stripe confirms the payment, usually within a few seconds, so this checks
 * a few times. Resolves null if it isn't ready in time (it's in the welcome email).
 */
export async function waitForMemberCode(
    endpoint: string,
    clientSecret: string,
    { attempts = 10, interval = 2_000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<{ code: string; cardToken: string | null } | null> {
    for (let i = 0; i < attempts; i++) {
        try {
            const { status, data } = await post(`${endpoint}/membership/code`, { clientSecret });
            if (status === 200 && data?.status === "ready" && typeof data.code === "string") {
                return { code: data.code, cardToken: typeof data.cardToken === "string" && CARD_TOKEN.test(data.cardToken) ? data.cardToken : null };
            }
            if (status === 404 || status === 400) return null;
        } catch {
            // Rate limited or offline: keep trying until the attempts run out.
        }
        if (i < attempts - 1) await sleep(interval);
    }
    return null;
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

export function initMembershipForm(root: HTMLElement) {
    const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const form = $<HTMLFormElement>("[data-membership-form]");
    const otherWrap = $("[data-other-wrap]");
    const otherInput = $<HTMLInputElement>("#mf-other");
    const otherHint = $("#mf-other-hint");
    const amountError = $("[data-amount-error]");
    const failure = $("[data-membership-error]");
    const failureMessage = $("[data-membership-error-message]");
    const joinButton = $<HTMLButtonElement>("[data-join]");
    const status = $("[data-membership-status]");
    const dialog = $<HTMLDialogElement>("[data-membership-dialog]");
    const dialogTitle = $("[data-dialog-title]");
    const mountPoint = $("[data-checkout]");
    const success = $("[data-membership-success]");
    const codeLoading = $("[data-code-loading]");
    const codeReady = $("[data-code-ready]");
    const codeLater = $("[data-code-later]");
    const codeText = $("[data-member-code]");
    const copyButton = $<HTMLButtonElement>("[data-copy-code]");
    const copyStatus = $("[data-copy-status]");
    const cardLink = $<HTMLAnchorElement>("[data-card-link]");

    const { publishableKey = "", endpoint = "", turnstileSitekey } = root.dataset;
    const stripeReady = loadScript(STRIPE_JS).then(() => {
        if (!window.Stripe) throw new MembershipError("failed");
        return window.Stripe(publishableKey);
    });
    stripeReady.catch(() => {}); // reported when the visitor presses Join
    const turnstile = turnstileSitekey ? setupTurnstile($("[data-turnstile]"), turnstileSitekey) : null;

    let checkout: EmbeddedCheckout | null = null;
    let completed = false;
    let unlockScroll: (() => void) | null = null;
    let busy = false;

    const frequency = () => (form.querySelector<HTMLInputElement>('input[name="frequency"]:checked')?.value ?? "monthly") as Frequency;
    const selectedAmount = () => form.querySelector<HTMLInputElement>(`input[name="amount-${frequency()}"]:checked`);
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;

    function setError(input: HTMLInputElement, message: string) {
        const error = root.querySelector<HTMLElement>(`#${input.id}-error`)!;
        error.textContent = message;
        error.hidden = !message;
        if (message) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
    }

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
        otherHint.textContent = amountHint(frequency());
        clearAmountError();
    }

    /** The amount, or null after showing why it isn't valid. */
    function amount(): number | null {
        if (selectedAmount()?.value !== "other") return Number(selectedAmount()?.value ?? DEFAULT_AMOUNT[frequency()]);
        const result = parseAmount(otherInput.value, frequency());
        if ("error" in result) {
            amountError.textContent = result.error;
            otherInput.setAttribute("aria-invalid", "true");
            return null;
        }
        return result.amount;
    }

    /** Checks the details; shows inline errors and returns the first invalid field. */
    function checkDetails(): HTMLInputElement | null {
        const checks: [HTMLInputElement, string][] = [
            [field("firstName"), field("firstName").value.trim() ? "" : "Enter your first name."],
            [field("lastName"), field("lastName").value.trim() ? "" : "Enter your last name."],
            [field("email"), !field("email").value.trim() ? "Enter your email address." : EMAIL.test(field("email").value.trim()) ? "" : "Enter an email address in the right format, like name@example.ie."],
            [field("terms"), field("terms").checked ? "" : "Tick the box to agree to the membership terms."],
        ];
        checks.forEach(([input, message]) => setError(input, message));
        return checks.find(([, message]) => message)?.[0] ?? null;
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

    function showCode(ready: { code: string; cardToken: string | null } | null) {
        codeLoading.hidden = true;
        if (ready) {
            codeText.textContent = ready.code;
            codeReady.hidden = false;
            saveMemberCode(ready.code);
            if (ready.cardToken) {
                saveCardToken(ready.cardToken);
                cardLink.href = `/membership/card/#${ready.cardToken}`;
                cardLink.hidden = false;
            }
        } else {
            codeLater.hidden = false;
        }
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
        joinButton.focus({ preventScroll: true });
    });
    $("[data-dialog-close]").addEventListener("click", () => dialog.close());
    $("[data-dialog-done]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
        // The <dialog> is a full-screen layer, so clicks around the panel land on it.
        if (event.target === dialog && !completed) dialog.close();
    });

    copyButton.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(codeText.textContent ?? "");
            copyStatus.textContent = "Copied";
        } catch {
            getSelection()?.selectAllChildren(codeText);
            copyStatus.textContent = "Press Ctrl+C (or ⌘C) to copy";
        }
    });

    form.addEventListener("change", (event) => {
        const name = (event.target as HTMLInputElement).name;
        if (name === "frequency" || name.startsWith("amount-")) sync();
    });
    // Errors clear while typing (or ticking), not on leaving the field: that
    // would move the Join button out from under the click that leaves it.
    form.addEventListener("input", (event) => {
        const target = event.target as HTMLInputElement;
        if (target === otherInput) clearAmountError();
        else if (target.getAttribute("aria-invalid")) setError(target, "");
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        failure.hidden = true;

        const freq = frequency();
        const value = amount();
        const invalid = checkDetails();
        if (value === null) return otherInput.focus();
        if (invalid) return invalid.focus();

        busy = true;
        joinButton.disabled = true;
        status.textContent = "Loading secure checkout…";
        try {
            const turnstileToken = turnstile ? await turnstile.token() : undefined;
            const details: JoinRequest = {
                frequency: freq,
                amount: value,
                firstName: field("firstName").value.trim(),
                lastName: field("lastName").value.trim(),
                email: field("email").value.trim(),
                heardAbout: field("heardAbout").value.trim(),
                updates: field("updates").checked,
                terms: true,
                ...(turnstileToken ? { turnstileToken } : {}),
            };
            const [stripe, clientSecret] = await Promise.all([stripeReady, requestClientSecret(endpoint, details)]);
            closeCheckout(); // Stripe allows one embedded checkout at a time
            checkout = await stripe.createEmbeddedCheckoutPage({
                fetchClientSecret: () => Promise.resolve(clientSecret),
                onComplete: () => {
                    completed = true;
                    closeCheckout();
                    mountPoint.hidden = true;
                    dialogTitle.textContent = "Welcome!";
                    codeLoading.hidden = false;
                    codeReady.hidden = true;
                    codeLater.hidden = true;
                    cardLink.hidden = true;
                    copyStatus.textContent = "";
                    success.hidden = false;
                    success.focus();
                    waitForMemberCode(endpoint, clientSecret).then(showCode);
                },
            });
            openDialog(`Join for ${formatAmount(value, freq)}`);
            checkout.mount(mountPoint);
        } catch (err) {
            closeCheckout();
            if (dialog.open) dialog.close();
            failureMessage.textContent = FAILURE_MESSAGES[err instanceof MembershipError ? err.kind : "failed"];
            failure.hidden = false;
        } finally {
            busy = false;
            joinButton.disabled = false;
            status.textContent = "";
            turnstile?.reset();
        }
    });

    initLookup(root, endpoint, turnstile);
    sync();
}

/** "Lost your code?": the same neutral answer whether or not the email belongs to a member. */
function initLookup(root: HTMLElement, endpoint: string, turnstile: ReturnType<typeof setupTurnstile> | null) {
    const form = root.querySelector<HTMLFormElement>("[data-lookup-form]");
    if (!form) return;
    const input = form.querySelector<HTMLInputElement>("#mf-lookup-email")!;
    const error = form.querySelector<HTMLElement>("#mf-lookup-email-error")!;
    const result = form.querySelector<HTMLElement>("[data-lookup-result]")!;
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = input.value.trim();
        const message = !email ? "Enter your email address." : EMAIL.test(email) ? "" : "Enter an email address in the right format, like name@example.ie.";
        error.textContent = message;
        error.hidden = !message;
        result.textContent = "";
        if (message) {
            input.setAttribute("aria-invalid", "true");
            return input.focus();
        }
        input.removeAttribute("aria-invalid");
        button.disabled = true;
        try {
            const turnstileToken = turnstile ? await turnstile.token() : undefined;
            const { status } = await post(`${endpoint}/membership/resend`, { email, ...(turnstileToken ? { turnstileToken } : {}) });
            if (status !== 200) throw new MembershipError("failed");
            result.textContent = "If there's an active membership for that email, we've sent the code. It can take a few minutes to arrive.";
        } catch (err) {
            result.textContent =
                err instanceof MembershipError && err.kind === "rate_limited"
                    ? FAILURE_MESSAGES.rate_limited
                    : "Sorry, that didn't go through. Please try again in a minute.";
        } finally {
            button.disabled = false;
            turnstile?.reset();
        }
    });
}
