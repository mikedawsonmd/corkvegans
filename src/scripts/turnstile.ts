/**
 * Loads third-party scripts once, and Cloudflare Turnstile for the membership
 * forms: invisible unless Cloudflare needs the visitor to tick a box.
 */

const TURNSTILE_JS = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface Turnstile {
    render(container: HTMLElement, options: Record<string, unknown>): string;
    reset(widgetId: string): void;
}
declare global {
    interface Window {
        turnstile?: Turnstile;
    }
}

export class ScriptLoadError extends Error {}

const scripts = new Map<string, Promise<void>>();
export function loadScript(src: string): Promise<void> {
    if (!scripts.has(src)) {
        scripts.set(
            src,
            new Promise((resolve, reject) => {
                const el = document.createElement("script");
                el.src = src;
                el.async = true;
                el.onload = () => resolve();
                el.onerror = () => reject(new ScriptLoadError(src));
                document.head.append(el);
            }),
        );
    }
    return scripts.get(src)!;
}

export interface TurnstileWidget {
    /** A fresh token. Tokens are single use: call reset() after each request. */
    token(timeoutMs?: number): Promise<string>;
    reset(): void;
}

export function setupTurnstile(container: HTMLElement, sitekey: string): TurnstileWidget {
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
        async token(timeoutMs = 15_000) {
            await ready;
            if (token) return token;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new ScriptLoadError("turnstile timed out")), timeoutMs);
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
