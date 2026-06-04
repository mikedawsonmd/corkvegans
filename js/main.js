/**
 * main.js
 * Header scroll behaviour and smooth anchor scrolling.
 */

(function () {
    var header      = document.getElementById("siteHeader");
    var headerInner = document.getElementById("headerInner");
    var logo        = document.getElementById("headerLogo");
    var button      = document.getElementById("headerButton");

    // ── Sticky header state ───────────────────────────────────────────────────
    function setHeaderState() {
        var isScrolled = window.scrollY > 40;

        header.classList.toggle("shadow-md",      isScrolled);
        header.classList.toggle("bg-surface/95",  isScrolled);
        header.classList.toggle("bg-surface/80",  !isScrolled);

        headerInner.classList.toggle("py-sm", isScrolled);
        headerInner.classList.toggle("py-lg", !isScrolled);

        logo.classList.toggle("h-[36px]", isScrolled);
        logo.classList.toggle("h-[48px]", !isScrolled);

        button.classList.toggle("px-md", isScrolled);
        button.classList.toggle("py-xs", isScrolled);
        button.classList.toggle("px-lg", !isScrolled);
        button.classList.toggle("py-sm", !isScrolled);
    }

    window.addEventListener("scroll", setHeaderState, { passive: true });
    window.addEventListener("load",   setHeaderState);

    // ── Smooth anchor scrolling (respects prefers-reduced-motion) ────────────
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
        anchor.addEventListener("click", function (e) {
            var target = document.querySelector(this.getAttribute("href"));
            if (!target) return;

            e.preventDefault();

            var headerHeight = header ? header.getBoundingClientRect().height : 0;
            var targetTop = target.getBoundingClientRect().top + window.scrollY - headerHeight;
            var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

            window.scrollTo({
                top: targetTop,
                behavior: prefersReducedMotion ? "auto" : "smooth",
            });
        });
    });
})();