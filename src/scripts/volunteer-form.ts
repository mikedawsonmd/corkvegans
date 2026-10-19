/**
 * Volunteer form: accessible client-side validation and submission to the
 * hosted form endpoint (see hosted-form.ts). Success is only shown when the
 * service confirms it.
 */

import { initHostedForm, type FormErrors } from "./hosted-form.ts";

export interface VolunteerInput {
    name: string;
    email: string;
    privacy: boolean;
}

export type VolunteerErrors = FormErrors<keyof VolunteerInput>;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateVolunteer(input: VolunteerInput): VolunteerErrors {
    const errors: VolunteerErrors = {};
    if (!input.name.trim()) errors.name = "Enter your name.";
    else if (input.name.trim().length > 100) errors.name = "Name must be 100 characters or fewer.";

    if (!input.email.trim()) errors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(input.email.trim())) errors.email = "Enter an email address in the format name@example.com.";

    if (!input.privacy) errors.privacy = "Tick the box to confirm you've read how we use your details.";
    return errors;
}

export function initVolunteerForm(form: HTMLFormElement) {
    initHostedForm(form, {
        fieldIds: { name: "vf-name", email: "vf-email", privacy: "vf-privacy" },
        validate: (data) =>
            validateVolunteer({
                name: String(data.get("name") ?? ""),
                email: String(data.get("email") ?? ""),
                privacy: data.get("privacy") === "acknowledged",
            }),
        payload: (data) => ({
            name: String(data.get("name") ?? "").trim(),
            email: String(data.get("email") ?? "").trim(),
            interests: data.getAll("interests").map(String).join(", "),
            message: String(data.get("message") ?? "").trim(),
            privacy: "acknowledged",
            _gotcha: String(data.get("_gotcha") ?? ""),
            _subject: String(data.get("_subject") ?? ""),
        }),
        failureMessage:
            "Sorry, your enquiry couldn't be sent. Please check your connection and try again, or message us on Facebook or Instagram.",
    });
}
