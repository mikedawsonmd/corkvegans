/**
 * Contact form (About page, #contact): questions, event and story ideas,
 * recommendations and more, sent to the organisers through Formspree.
 * Links such as /about/?topic=event#contact open it with a topic chosen.
 *
 * Spam protection, on top of Formspree's own filtering: a hidden field bots
 * fill in, dropping anything sent within a few seconds of opening the page,
 * and limits on length and links. Dropped messages still see "thank you".
 */

import { initHostedForm, type FormErrors } from "./hosted-form.ts";
import { EMAIL_PATTERN } from "./volunteer-form.ts";

export interface ContactTopic {
    id: string; // used in links: /about/?topic=<id>#contact
    label: string;
    hint: string; // shown under the message box
}

export const CONTACT_TOPICS: ContactTopic[] = [
    { id: "question", label: "A question", hint: "Ask us anything about Cork Vegans, our events or getting involved." },
    { id: "event", label: "Suggest an event", hint: "What's the idea, and roughly where and when? Happy to help organise it?" },
    { id: "story", label: "Story or blog idea", hint: "What would you like to read about, or write? Event recaps, reviews and personal stories are all welcome." },
    {
        id: "recommend",
        label: "Recommend a business, restaurant or product",
        hint: "What is it, where can we find it, and what do you like about it? Add a link below if there is one.",
    },
    {
        id: "partner",
        label: "Discount partnership",
        hint: "Tell us about your business, where you are, and the discount you'd like to offer Cork Vegans members.",
    },
    { id: "collaborate", label: "Collaboration", hint: "Tell us about your business or organisation and what you have in mind." },
    { id: "press", label: "Press or media", hint: "Who you're writing for, what it's about, and any deadline." },
    { id: "feedback", label: "Website feedback", hint: "What did you notice, and on which page? Something broken, confusing or missing?" },
    { id: "other", label: "Something else", hint: "Tell us what's on your mind." },
];

export const MESSAGE_MIN_LENGTH = 10;
export const MESSAGE_MAX_LENGTH = 3000;
export const MESSAGE_MAX_LINKS = 3;
/** Faster than this (ms from opening the page) can only be a bot. */
export const MIN_FILL_TIME_MS = 5000;

export interface ContactInput {
    name: string;
    email: string;
    message: string;
    link: string;
    privacy: boolean;
}

export type ContactErrors = FormErrors<keyof ContactInput>;

/** Counts web links (http://, https:// or www.) in a piece of text. */
export function countLinks(text: string): number {
    return (text.match(/\bhttps?:\/\/|\bwww\./gi) ?? []).length;
}

/** The topic chosen by ?topic=… in a link, or the first topic. */
export function topicFromQuery(search: string): ContactTopic {
    const id = new URLSearchParams(search).get("topic")?.trim().toLowerCase();
    return CONTACT_TOPICS.find((t) => t.id === id) ?? CONTACT_TOPICS[0];
}

export function validateContact(input: ContactInput): ContactErrors {
    const errors: ContactErrors = {};
    if (!input.name.trim()) errors.name = "Enter your name.";
    else if (input.name.trim().length > 100) errors.name = "Name must be 100 characters or fewer.";

    if (!input.email.trim()) errors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(input.email.trim())) errors.email = "Enter an email address in the format name@example.com.";

    const message = input.message.trim();
    if (!message) errors.message = "Enter your message.";
    else if (message.length < MESSAGE_MIN_LENGTH) errors.message = "Tell us a little more.";
    else if (message.length > MESSAGE_MAX_LENGTH) errors.message = `Your message must be ${MESSAGE_MAX_LENGTH} characters or fewer.`;
    else if (countLinks(message) > MESSAGE_MAX_LINKS) errors.message = `Please include no more than ${MESSAGE_MAX_LINKS} links.`;

    const link = input.link.trim();
    if (link && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(link)) errors.link = "Enter a web address, e.g. corkvegans.ie, or leave this empty.";

    if (!input.privacy) errors.privacy = "Tick the box to confirm you've read how we use your details.";
    return errors;
}

/** True for submissions that can only have come from a bot. */
export function looksAutomated(input: { gotcha: string; elapsedMs: number }): boolean {
    return input.gotcha.trim() !== "" || input.elapsedMs < MIN_FILL_TIME_MS;
}

export function initContactForm(form: HTMLFormElement) {
    const openedAt = performance.now();
    const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
    const topicSelect = form.querySelector<HTMLSelectElement>("[name=topic]")!;
    const hint = form.querySelector<HTMLElement>("[data-topic-hint]")!;

    // A link like /about/?topic=event#contact chooses the topic.
    if (new URLSearchParams(location.search).has("topic")) topicSelect.value = topicFromQuery(location.search).id;
    const showHint = () => (hint.textContent = (CONTACT_TOPICS.find((t) => t.id === topicSelect.value) ?? CONTACT_TOPICS[0]).hint);
    topicSelect.addEventListener("change", showHint);
    showHint();

    initHostedForm(form, {
        fieldIds: { name: "cf-name", email: "cf-email", message: "cf-message", link: "cf-link", privacy: "cf-privacy" },
        validate: (data) =>
            validateContact({
                name: text(data, "name"),
                email: text(data, "email"),
                message: text(data, "message"),
                link: text(data, "link"),
                privacy: data.get("privacy") === "acknowledged",
            }),
        discard: (data) => looksAutomated({ gotcha: text(data, "_gotcha"), elapsedMs: performance.now() - openedAt }),
        payload: (data) => {
            const topic = CONTACT_TOPICS.find((t) => t.id === text(data, "topic")) ?? CONTACT_TOPICS[CONTACT_TOPICS.length - 1];
            return {
                name: text(data, "name"),
                email: text(data, "email"),
                topic: topic.label,
                message: text(data, "message"),
                link: text(data, "link"),
                privacy: "acknowledged",
                _gotcha: text(data, "_gotcha"),
                _subject: `Contact: ${topic.label}`,
            };
        },
        failureMessage: "Sorry, your message couldn't be sent. Please check your connection and try again. Your message is still in the form.",
    });
}
