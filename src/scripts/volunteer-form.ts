/**
 * Volunteer form: accessible client-side validation and submission to the
 * hosted form endpoint. Success is only shown when the service confirms it.
 */

export interface VolunteerInput {
    name: string;
    email: string;
    privacy: boolean;
}

export type VolunteerErrors = Partial<Record<keyof VolunteerInput, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateVolunteer(input: VolunteerInput): VolunteerErrors {
    const errors: VolunteerErrors = {};
    if (!input.name.trim()) errors.name = "Enter your name.";
    else if (input.name.trim().length > 100) errors.name = "Name must be 100 characters or fewer.";

    if (!input.email.trim()) errors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(input.email.trim())) errors.email = "Enter an email address in the format name@example.com.";

    if (!input.privacy) errors.privacy = "Tick the box to confirm you've read how we use your details.";
    return errors;
}

const FIELD_IDS: Record<keyof VolunteerInput, string> = {
    name: "vf-name",
    email: "vf-email",
    privacy: "vf-privacy",
};

export function initVolunteerForm(form: HTMLFormElement) {
    const endpoint = form.getAttribute("action");
    if (!endpoint) return; // not configured — fieldset is disabled

    const container = form.parentElement!;
    const summary = form.querySelector<HTMLElement>("[data-error-summary]")!;
    const summaryList = form.querySelector<HTMLElement>("[data-error-list]")!;
    const status = form.querySelector<HTMLElement>("[data-form-status]")!;
    const submit = form.querySelector<HTMLButtonElement>("[data-submit]")!;
    const success = container.querySelector<HTMLElement>("[data-form-success]")!;

    function showErrors(errors: VolunteerErrors) {
        summaryList.replaceChildren();
        (Object.keys(FIELD_IDS) as (keyof VolunteerInput)[]).forEach((key) => {
            const field = document.getElementById(FIELD_IDS[key]) as HTMLInputElement;
            const errorEl = document.getElementById(`${FIELD_IDS[key]}-error`)!;
            const message = errors[key];
            field.setAttribute("aria-invalid", message ? "true" : "false");
            errorEl.hidden = !message;
            errorEl.textContent = message ?? "";
            if (message) {
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = `#${FIELD_IDS[key]}`;
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

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = new FormData(form);
        const input: VolunteerInput = {
            name: String(data.get("name") ?? ""),
            email: String(data.get("email") ?? ""),
            privacy: data.get("privacy") === "acknowledged",
        };
        const errors = validateVolunteer(input);
        showErrors(errors);
        if (Object.keys(errors).length > 0) return;

        submit.disabled = true;
        status.textContent = "Sending…";

        const payload = {
            name: input.name.trim(),
            email: input.email.trim(),
            interests: data.getAll("interests").map(String).join(", "),
            message: String(data.get("message") ?? "").trim(),
            privacy: "acknowledged",
            _gotcha: String(data.get("_gotcha") ?? ""),
            _subject: String(data.get("_subject") ?? ""),
        };

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify(payload),
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
            form.hidden = true;
            success.hidden = false;
            success.focus();
        } catch (err) {
            status.textContent = "";
            summaryList.replaceChildren();
            const li = document.createElement("li");
            li.textContent =
                "Sorry, your enquiry couldn't be sent. Please check your connection and try again, or message us on Facebook or Instagram." +
                (err instanceof Error && err.message && !err.message.startsWith("HTTP") ? ` (${err.message})` : "");
            summaryList.append(li);
            summary.hidden = false;
            summary.focus();
        } finally {
            submit.disabled = false;
            if (status.textContent === "Sending…") status.textContent = "";
        }
    });
}
