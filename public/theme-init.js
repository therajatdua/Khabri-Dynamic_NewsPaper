// Runs before first paint (render-blocking, tiny) so the page never flashes
// the wrong theme. Kept as a file because the CSP blocks inline scripts.
(function () {
    try {
        var t = localStorage.getItem('khabri-newswala-theme');
        if (t !== 'dark' && t !== 'light') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
    } catch (e) { /* storage blocked: CSS default (light) */ }
})();
