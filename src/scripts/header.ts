/**
 * header.ts
 * Header scroll behaviour, smooth anchor scrolling and the mobile menu.
 */

const header = document.getElementById("siteHeader");
const headerInner = document.getElementById("headerInner");
const logo = document.getElementById("headerLogo");
const button = document.getElementById("headerButton");

// ── Sticky header state ───────────────────────────────────────────────────
// On scroll the header gains a shadow everywhere, but only shrinks on
// mobile; on larger screens it stays full height.
const mobile = window.matchMedia("(max-width: 767px)");

function setHeaderState() {
    if (!header || !headerInner || !logo || !button) return;
    const isScrolled = window.scrollY > 40;
    const compact = isScrolled && mobile.matches;

    header.classList.toggle("shadow-md", isScrolled);
    header.classList.toggle("bg-surface/95", isScrolled);
    header.classList.toggle("bg-surface/80", !isScrolled);

    headerInner.classList.toggle("py-sm", compact);
    headerInner.classList.toggle("py-lg", !compact);

    logo.classList.toggle("h-[36px]", compact);
    logo.classList.toggle("h-[48px]", !compact);

    button.classList.toggle("px-md", compact);
    button.classList.toggle("py-xs", compact);
    button.classList.toggle("px-lg", !compact);
    button.classList.toggle("py-sm", !compact);
}

window.addEventListener("scroll", setHeaderState, { passive: true });
mobile.addEventListener("change", setHeaderState);
setHeaderState();

// ── Smooth anchor scrolling (respects prefers-reduced-motion) ────────────
function scrollToHash(hash: string): boolean {
    let target: Element | null = null;
    try {
        target = document.querySelector(hash);
    } catch {
        return false;
    }
    if (!target) return false;

    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const targetTop = target.getBoundingClientRect().top + window.scrollY - headerHeight;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    window.scrollTo({ top: targetTop, behavior: prefersReducedMotion ? "auto" : "smooth" });
    return true;
}

document.querySelectorAll<HTMLAnchorElement>('a[href*="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (e) => {
        const url = new URL(anchor.href, window.location.href);
        // Only intercept links to a section on the current page.
        if (url.pathname !== window.location.pathname || !url.hash || url.hash === "#main") return;
        if (scrollToHash(url.hash)) {
            e.preventDefault();
            history.pushState(null, "", url.hash);
            closeMenu();
        }
    });
});

// ── Mobile menu ───────────────────────────────────────────────────────────
const menuButton = document.getElementById("menuButton");
const menu = document.getElementById("mobileMenu");
const menuIcon = menuButton?.querySelector("[data-menu-icon]");

function setMenu(open: boolean) {
    if (!menuButton || !menu) return;
    menuButton.setAttribute("aria-expanded", String(open));
    menu.hidden = !open;
    if (menuIcon) menuIcon.textContent = open ? "close" : "menu";
}

function closeMenu() {
    setMenu(false);
}

menuButton?.addEventListener("click", () => {
    setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

menu?.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) closeMenu();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuButton?.getAttribute("aria-expanded") === "true") {
        closeMenu();
        menuButton.focus();
    }
});

window.matchMedia("(min-width: 768px)").addEventListener("change", (e) => {
    if (e.matches) closeMenu();
});
