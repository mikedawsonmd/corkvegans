/**
 * Shared behaviour for forms posted to a hosted form service (Formspree):
 * accessible validation with an error summary, submission as JSON, and a
 * success message that's only shown once the service confirms it.
 *
 * Markup contract (see VolunteerForm.astro / ContactForm.astro):
 *   form[action]                 the endpoint; no action = not configured
 *   [data-error-summary]         alert box, with [data-error-list] inside
 *   [data-form-status]           live "Sending…" text
 *   [data-submit]                the submit button
 *   [data-form-success]          sibling of the form, shown on success
 *   #<id>-error                  per-field error text for each field id
 */

export type FormErrors<K extends string> = Partial<Record<K, string>>;

export interface HostedFormOptions<K extends string> {
    /** Field ids by error key, in the order errors are listed. */
    fieldIds: Record<K, string>;
    validate: (data: FormData) => FormErrors<K>;
    /** The JSON sent to the service. */
    payload: (data: FormData) => Record<string, string>;
    /** Shown when sending fails, before any detail from the service. */
    failureMessage: string;
    /**
     * Return true to drop a submission silently (spam): the success message
     * is shown but nothing is sent.
     */
    discard?: (data: FormData) => boolean;
}

export function initHostedForm<K extends string>(form: HTMLFormElement, options: HostedFormOptions<K>) {
    const endpoint = form.getAttribute("action");
    if (!endpoint) return; // not configured — fieldset is disabled

    const container = form.parentElement!;
    const summary = form.querySelector<HTMLElement>("[data-error-summary]")!;
    const summaryList = form.querySelector<HTMLElement>("[data-error-list]")!;
    const status = form.querySelector<HTMLElement>("[data-form-status]")!;
    const submit = form.querySelector<HTMLButtonElement>("[data-submit]")!;
    const success = container.querySelector<HTMLElement>("[data-form-success]")!;

    function showErrors(errors: FormErrors<K>) {
        summaryList.replaceChildren();
        (Object.keys(options.fieldIds) as K[]).forEach((key) => {
            const id = options.fieldIds[key];
            const field = document.getElementById(id) as HTMLInputElement;
            const errorEl = document.getElementById(`${id}-error`)!;
            const message = errors[key];
            field.setAttribute("aria-invalid", message ? "true" : "false");
            errorEl.hidden = !message;
            errorEl.textContent = message ?? "";
            if (message) {
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = `#${id}`;
                a.textContent = message;
                a.className = "underline";
                a.addEventListener("click", (e) => {
                    e.preventDefault();
                    field.focus();
                });
                li.append(a);
                summaryList.append(li);
            }
        });
        const hasErrors = Object.keys(errors).length > 0;
        summary.hidden = !hasErrors;
        if (hasErrors) summary.focus();
    }

    function showSuccess() {
        form.hidden = true;
        success.hidden = false;
        success.focus();
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = new FormData(form);
        const errors = options.validate(data);
        showErrors(errors);
        if (Object.keys(errors).length > 0) return;

        if (options.discard?.(data)) {
            showSuccess();
            return;
        }

        submit.disabled = true;
        status.textContent = "Sending…";

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify(options.payload(data)),
            });
            if (!res.ok) {
                let detail = "";
                try {
                    const body = (await res.json()) as { errors?: { message?: string }[] };
                    detail = body.errors?.map((er) => er.message).filter(Boolean).join(" ") ?? "";
                } catch {
                    /* ignore */
                }
                throw new Error(detail || `HTTP ${res.status}`);
            }
            showSuccess();
        } catch (err) {
            status.textContent = "";
            summaryList.replaceChildren();
            const li = document.createElement("li");
            li.textContent =
                options.failureMessage + (err instanceof Error && err.message && !err.message.startsWith("HTTP") ? ` (${err.message})` : "");
            summaryList.append(li);
            summary.hidden = false;
            summary.focus();
        } finally {
            submit.disabled = false;
            if (status.textContent === "Sending…") status.textContent = "";
        }
    });
}
