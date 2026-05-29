/**
 * meetup-events.js
 * Fetches upcoming Cork Vegans events from the Cloudflare Worker
 * and renders them into #meetup-events.
 */

(function () {
    var WORKER_URL = "https://red-wave-4e83.mikedawsonmd.workers.dev/events";
    var container  = document.getElementById("meetup-events");

    if (!container) return;

    // ── XSS-safe HTML escaper ─────────────────────────────────────────────────
    function esc(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // ── Build a single event card ─────────────────────────────────────────────
    function buildCard(ev) {
        var dt    = new Date(ev.dateISO);
        var month = ev.month || dt.toLocaleDateString("en-IE", { month: "short", timeZone: "Europe/Dublin" }).toUpperCase();
        var day   = ev.day   || dt.toLocaleDateString("en-IE", { day: "2-digit", timeZone: "Europe/Dublin" });

        return '<a href="' + esc(ev.url) + '" target="_blank" rel="noopener noreferrer"'
            + ' class="group flex flex-col md:flex-row bg-surface border border-surface-variant rounded-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"'
            + ' aria-label="' + esc(ev.title) + '">'

            // Left: logo panel with date badge
            + '<div class="md:w-1/3 h-48 md:h-auto relative overflow-hidden flex items-center justify-center" style="background:#ffffff">'
            +   '<img alt="Cork Vegans" class="w-32 h-auto object-contain transition-transform duration-500 group-hover:scale-110 opacity-80" src="images/logo.png" />'
            +   '<div class="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-md py-sm rounded-lg text-center shadow-md">'
            +     '<span class="block font-label-bold text-label-sm text-secondary uppercase">' + esc(month) + '</span>'
            +     '<span class="block font-headline-md text-headline-md text-on-surface">' + esc(day) + '</span>'
            +   '</div>'
            + '</div>'

            // Right: event details
            + '<div class="md:w-2/3 p-lg flex flex-col justify-between">'
            +   '<div>'
            +     '<h3 class="font-headline-md text-headline-md text-on-surface mb-sm">' + esc(ev.title) + '</h3>'
            +     '<div class="flex items-center gap-xs text-on-surface-variant">'
            +       '<span class="material-symbols-outlined text-[20px]">schedule</span>'
            +       '<span class="text-label-sm">' + esc(ev.date) + ' · ' + esc(ev.time) + '</span>'
            +     '</div>'
            +   '</div>'
            +   '<div class="mt-lg flex justify-end">'
            +     '<span class="bg-primary text-on-primary px-lg py-sm rounded-full font-label-bold text-label-bold">View on Meetup</span>'
            +   '</div>'
            + '</div>'

            + '</a>';
    }

    // ── Empty / error state ───────────────────────────────────────────────────
    function showEmpty() {
        container.innerHTML =
            '<div class="flex flex-col items-center justify-center gap-lg py-xl text-center bg-surface border border-surface-variant rounded-lg">'
            + '<div class="w-20 h-20 rounded-full bg-surface-container-low flex items-center justify-center text-4xl">🌿</div>'
            + '<div class="flex flex-col gap-sm max-w-sm">'
            +   '<h3 class="font-headline-md text-headline-md text-on-surface">No upcoming events right now</h3>'
            +   '<p class="font-body-md text-body-md text-on-surface-variant">We\'re busy planning the next one — check back soon or follow us on Meetup to get notified the moment something is scheduled.</p>'
            + '</div>'
            + '<a href="https://www.meetup.com/corkvegans/" target="_blank" rel="noopener noreferrer"'
            + ' class="bg-primary text-on-primary px-xl py-sm rounded-full font-label-bold text-label-bold hover:bg-surface-tint transition-all active:scale-95">Follow us on Meetup</a>'
            + '</div>';
    }

    // ── Fetch and render ──────────────────────────────────────────────────────
    fetch(WORKER_URL)
        .then(function (res) {
            if (!res.ok) throw new Error("Worker returned " + res.status);
            return res.json();
        })
        .then(function (data) {
            if (!data.events || data.events.length === 0) {
                showEmpty();
                return;
            }
            container.innerHTML = data.events.map(buildCard).join("");
        })
        .catch(function (err) {
            console.error("[Meetup embed]", err);
            showEmpty();
        });
})();
