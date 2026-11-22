// Khabri site-wide UI: theme, scroll progress, sticky header, back to top,
// cookie banner, UTM attribution, mobile menu, search extras, copy buttons,
// confirmation modals, contact form, pointer specular, motion helpers.
// Exposes window.KhabriUI for the feed code (script.js).
(() => {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const KEYS = {
        theme: 'khabri-newswala-theme',
        consent: 'khabri-consent-v1',
        utm: 'khabri-utm-v1',
        utmPending: 'khabri-utm-pending',
        recent: 'khabri-recent-searches-v1'
    };
    const store = {
        get(key, fallback, area = localStorage) {
            try { const raw = area.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
        },
        set(key, value, area = localStorage) {
            try { area.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
        },
        remove(key, area = localStorage) {
            try { area.removeItem(key); } catch { /* ignore */ }
        }
    };

    function announce(msg) {
        const live = $('#liveStatus');
        if (!live) return;
        live.textContent = '';
        requestAnimationFrame(() => { live.textContent = msg; });
    }

    // ------------------------------------------------------------------
    // Pointer tracking: dialogs/menus grow from where the user clicked
    // ------------------------------------------------------------------
    let lastPointer = null;
    document.addEventListener('pointerdown', (e) => {
        lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, true);

    function originPoint(fallbackEl) {
        if (lastPointer && Date.now() - lastPointer.t < 800) return lastPointer;
        const el = fallbackEl || document.activeElement;
        if (el && el.getBoundingClientRect) {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }

    function openDialog(dialog, fromEl) {
        if (!dialog) return;
        dialog.classList.remove('is-closing');
        if (!dialog.open) dialog.showModal();
        // transform-origin relative to the dialog box = the click point
        const p = originPoint(fromEl);
        const r = dialog.getBoundingClientRect();
        dialog.style.transformOrigin = `${Math.round(p.x - r.left)}px ${Math.round(p.y - r.top)}px`;
    }

    function closeDialog(dialog, returnValue) {
        if (!dialog || !dialog.open || dialog.classList.contains('is-closing')) return;
        if (reduceMotion()) { dialog.close(returnValue); return; }
        dialog.classList.add('is-closing');
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            dialog.removeEventListener('animationend', finish);
            if (dialog.classList.contains('is-closing')) {
                dialog.classList.remove('is-closing');
                dialog.close(returnValue);
            }
        };
        dialog.addEventListener('animationend', finish);
        setTimeout(finish, 260);
    }

    // Animated close for Esc too (cancel fires before close).
    document.addEventListener('cancel', (e) => {
        const d = e.target;
        if (d instanceof HTMLDialogElement && (d.classList.contains('pop-dialog') || d.classList.contains('sheet'))) {
            e.preventDefault();
            closeDialog(d, 'cancel');
        }
    }, true);

    // Click on the backdrop closes pop dialogs.
    document.addEventListener('click', (e) => {
        const d = e.target;
        if (d instanceof HTMLDialogElement && d.classList.contains('pop-dialog') && d.open) closeDialog(d, 'cancel');
    });

    // ------------------------------------------------------------------
    // Theme (origin-aware circular reveal via View Transitions)
    // ------------------------------------------------------------------
    const themeColor = { light: '#2F4A3A', dark: '#253A2D' }; // header colour per theme

    function currentTheme() {
        return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    }

    function paintTheme() {
        const dark = currentTheme() === 'dark';
        $$('[data-theme-toggle]').forEach(btn => {
            btn.setAttribute('aria-pressed', String(dark));
            btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
            btn.title = dark ? 'Light mode' : 'Dark mode';
            const label = btn.querySelector('[data-theme-label]');
            if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
        });
        const meta = $('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', themeColor[currentTheme()]);
    }

    function setTheme(next, point) {
        try { localStorage.setItem(KEYS.theme, next); } catch { /* ignore */ }
        const apply = () => { document.documentElement.dataset.theme = next; paintTheme(); };
        if (!document.startViewTransition || reduceMotion() || !point) { apply(); return; }
        const { x, y } = point;
        const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        const vt = document.startViewTransition(apply);
        vt.ready.then(() => {
            document.documentElement.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
                { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
            );
        }).catch(() => {});
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-theme-toggle]');
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const point = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        setTheme(currentTheme() === 'dark' ? 'light' : 'dark', point);
    });

    // Follow the OS setting until the user picks one.
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
        let saved = null;
        try { saved = localStorage.getItem(KEYS.theme); } catch { /* ignore */ }
        if (saved !== 'dark' && saved !== 'light') { document.documentElement.dataset.theme = e.matches ? 'dark' : 'light'; paintTheme(); }
    });

    // ------------------------------------------------------------------
    // Scroll: progress bar, header state, back to top (rAF-throttled)
    // ------------------------------------------------------------------
    const progress = $('#scrollProgress');
    const header = $('.site-header');
    const backTop = $('#backToTop');
    let ticking = false;

    function onScroll() {
        ticking = false;
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (progress) progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
        if (header) header.classList.toggle('is-scrolled', y > 8);
        if (backTop) {
            const show = y > window.innerHeight * 1.2;
            backTop.classList.toggle('is-visible', show);
            backTop.tabIndex = show ? 0 : -1;
            backTop.setAttribute('aria-hidden', String(!show));
        }
    }
    window.addEventListener('scroll', () => {
        if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    function scrollToTop() {
        window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
        // Keep keyboard users oriented: focus the start of the content.
        const target = $('#feed');
        if (target) {
            target.setAttribute('tabindex', '-1');
            setTimeout(() => target.focus({ preventScroll: true }), reduceMotion() ? 0 : 400);
        }
    }
    backTop?.addEventListener('click', scrollToTop);

    // ------------------------------------------------------------------
    // Pointer-following specular highlight on glass cards
    // ------------------------------------------------------------------
    if (window.matchMedia('(hover: hover)').matches) {
        let specTarget = null;
        let specEvent = null;
        let specQueued = false;
        document.addEventListener('pointermove', (e) => {
            specEvent = e;
            if (specQueued) return;
            specQueued = true;
            requestAnimationFrame(() => {
                specQueued = false;
                const el = specEvent.target.closest?.('.specular');
                if (!el) { specTarget = null; return; }
                specTarget = el;
                const r = el.getBoundingClientRect();
                el.style.setProperty('--mx', `${((specEvent.clientX - r.left) / r.width) * 100}%`);
                el.style.setProperty('--my', `${((specEvent.clientY - r.top) / r.height) * 100}%`);
            });
        }, { passive: true });
    }

    // ------------------------------------------------------------------
    // Secondary-action flourishes
    // ------------------------------------------------------------------
    function burst(el, color = '#FF886A') {
        if (!el || reduceMotion()) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        for (let i = 0; i < 8; i++) {
            const dot = document.createElement('span');
            dot.className = 'burst-dot';
            dot.style.left = `${cx}px`;
            dot.style.top = `${cy}px`;
            dot.style.background = i % 2 ? color : (currentTheme() === 'dark' ? '#F3EBD0' : '#2F4A3A');
            document.body.appendChild(dot);
            const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
            const dist = 22 + Math.random() * 12;
            dot.animate([
                { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist - 6}px) scale(0.4)`, opacity: 0 }
            ], { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }).onfinish = () => dot.remove();
        }
    }

    // Arc flight: x moves evenly while y eases in/out, so the path curves.
    function flyTo(fromEl, toEl, iconHref = '#i-bookmark') {
        if (!fromEl || !toEl) return Promise.resolve();
        const a = fromEl.getBoundingClientRect();
        const b = toEl.getBoundingClientRect();
        if (reduceMotion() || !b.width) return Promise.resolve();
        const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
        const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
        const outer = document.createElement('div');
        outer.className = 'fly-x';
        outer.innerHTML = `<div class="fly-y"><svg class="ic" aria-hidden="true"><use href="${escapeHtml(iconHref)}"/></svg></div>`;
        document.body.appendChild(outer);
        const inner = outer.firstElementChild;
        const lift = Math.min(y0, y1) - 90;
        const dur = 620;
        outer.animate([{ transform: `translateX(${x0}px)` }, { transform: `translateX(${x1}px)` }], { duration: dur, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'forwards' });
        const fly = inner.animate([
            { transform: `translateY(${y0}px) scale(0.6)`, offset: 0 },
            { transform: `translateY(${lift}px) scale(1.1)`, offset: 0.42, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
            { transform: `translateY(${y1}px) scale(0.5)`, offset: 1 }
        ], { duration: dur, easing: 'cubic-bezier(0, 0.55, 0.45, 1)', fill: 'forwards' });
        return fly.finished.then(() => outer.remove(), () => outer.remove());
    }

    // ------------------------------------------------------------------
    // Copy to clipboard ([data-copy]="text" or [data-copy-target]="#sel")
    // ------------------------------------------------------------------
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch { ok = false; }
            ta.remove();
            return ok;
        }
    }

    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-copy], [data-copy-target]');
        if (!btn) return;
        e.preventDefault();
        const text = btn.dataset.copy ?? $(btn.dataset.copyTarget)?.textContent?.trim() ?? '';
        if (!text) return;
        const ok = await copyText(text);
        const label = btn.querySelector('[data-copy-label]');
        const original = label?.textContent;
        if (ok) {
            btn.classList.add('is-copied');
            if (label) label.textContent = 'Copied';
            burst(btn, '#2F4A3A');
            announce(btn.dataset.copyMessage || 'Copied to clipboard');
            clearTimeout(btn._copyTimer);
            btn._copyTimer = setTimeout(() => {
                btn.classList.remove('is-copied');
                if (label) label.textContent = original;
            }, 1600);
        } else {
            announce('Copy failed. Select the text and copy it manually.');
        }
    });

    // ------------------------------------------------------------------
    // Confirmation modal: KhabriUI.confirm({...}) -> Promise<boolean>
    // ------------------------------------------------------------------
    function confirmModal({ title, body, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, from } = {}) {
        const dialog = $('#confirmDialog');
        if (!dialog) return Promise.resolve(window.confirm(`${title}\n\n${body || ''}`));
        $('#confirmTitle').textContent = title;
        $('#confirmText').textContent = body || '';
        const ok = $('#confirmOk');
        ok.textContent = confirmText;
        ok.classList.toggle('danger', !!danger);
        $('#confirmCancel').textContent = cancelText;
        dialog.returnValue = '';
        openDialog(dialog, from);
        $('#confirmCancel').focus(); // safer default for destructive actions
        return new Promise((resolve) => {
            dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
        });
    }
    $('#confirmOk')?.addEventListener('click', () => closeDialog($('#confirmDialog'), 'confirm'));
    $('#confirmCancel')?.addEventListener('click', () => closeDialog($('#confirmDialog'), 'cancel'));

    // ------------------------------------------------------------------
    // Infinity trail loader markup
    // ------------------------------------------------------------------
    const INF_PATH = 'M50 25 C60 10 90 10 90 25 C90 40 60 40 50 25 C40 10 10 10 10 25 C10 40 40 40 50 25 Z';
    const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function loader(label = 'Loading', { size = '', inline = false, delay = true } = {}) {
        const cls = ['infinity', size, inline ? 'inline' : '', delay ? 'loader-delay' : ''].filter(Boolean).join(' ');
        return `<span class="${cls}" role="status" aria-live="polite"><svg viewBox="0 0 100 50" aria-hidden="true">`
            + `<path class="inf-track" pathLength="100" d="${INF_PATH}"/>`
            + `<path class="inf-tail" pathLength="100" d="${INF_PATH}"/>`
            + `<path class="inf-mid" pathLength="100" d="${INF_PATH}"/>`
            + `<path class="inf-head" pathLength="100" d="${INF_PATH}"/>`
            + `</svg>${label ? `<span class="infinity-label">${escapeHtml(label)}</span>` : ''}</span>`;
    }

    // ------------------------------------------------------------------
    // Consent + UTM attribution (no cookies are used at all)
    // ------------------------------------------------------------------
    const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    const consent = () => store.get(KEYS.consent, null)?.choice || null; // 'all' | 'essential' | null

    function captureUtm() {
        let url;
        try { url = new URL(location.href); } catch { return; }
        const found = {};
        UTM_FIELDS.forEach(k => {
            const v = url.searchParams.get(k);
            if (v) found[k] = v.slice(0, 100);
            url.searchParams.delete(k);
        });
        if (!Object.keys(found).length) return;
        let refHost = '';
        try { refHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* ignore */ }
        const touch = { ...found, landing: url.pathname, referrer: refHost, at: new Date().toISOString() };
        if (consent() === 'all') saveTouch(touch);
        else if (consent() !== 'essential') store.set(KEYS.utmPending, touch, sessionStorage);
        // Keep shareable URLs clean.
        try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch { /* ignore */ }
    }

    function saveTouch(touch) {
        const prev = store.get(KEYS.utm, {});
        store.set(KEYS.utm, { first: prev.first || touch, last: touch });
    }

    function attribution() {
        if (consent() !== 'all') return null;
        return store.get(KEYS.utm, null);
    }

    // Outbound links say where the reader came from (publishers see referral traffic).
    function outbound(href) {
        try {
            const u = new URL(href);
            if (!/^https?:$/.test(u.protocol) || u.hostname.endsWith('news.google.com') || u.searchParams.has('utm_source')) return href;
            u.searchParams.set('utm_source', 'khabri.therajatdua.com');
            u.searchParams.set('utm_medium', 'referral');
            return u.toString();
        } catch {
            return href;
        }
    }

    function initCookieBanner() {
        const banner = $('#cookieBanner');
        if (!banner || consent()) return;
        setTimeout(() => { banner.hidden = false; }, 1200);
        banner.addEventListener('click', (e) => {
            const choice = e.target.closest('[data-consent]')?.dataset.consent;
            if (!choice) return;
            store.set(KEYS.consent, { choice, at: new Date().toISOString() });
            const pending = store.get(KEYS.utmPending, null, sessionStorage);
            if (choice === 'all' && pending) saveTouch(pending);
            store.remove(KEYS.utmPending, sessionStorage);
            if (choice === 'essential') store.remove(KEYS.utm);
            banner.classList.add('is-leaving');
            setTimeout(() => { banner.hidden = true; banner.classList.remove('is-leaving'); }, reduceMotion() ? 0 : 210);
            announce(choice === 'all' ? 'Preferences saved. Thanks!' : 'Only essential storage will be used.');
        });
    }

    // Footer "Privacy choices" link re-opens the banner.
    document.addEventListener('click', (e) => {
        if (!e.target.closest('[data-action="privacy-choices"]')) return;
        store.remove(KEYS.consent);
        const banner = $('#cookieBanner');
        if (banner) banner.hidden = false;
    });

    // ------------------------------------------------------------------
    // Mobile menu + mobile search toggle
    // ------------------------------------------------------------------
    const menu = $('#mobileMenu');
    $('#menuBtn')?.addEventListener('click', (e) => {
        if (menu.open) { closeDialog(menu); return; }
        openDialog(menu, e.currentTarget);
        $('#menuBtn').setAttribute('aria-expanded', 'true');
    });
    menu?.addEventListener('close', () => $('#menuBtn')?.setAttribute('aria-expanded', 'false'));
    menu?.addEventListener('click', (e) => {
        // Any action inside the menu closes it (Hick: one decision, done).
        if (e.target.closest('.menu-item:not([data-keep-open])')) closeDialog(menu);
    });

    $('#searchToggle')?.addEventListener('click', () => {
        const open = !header.classList.contains('search-open');
        header.classList.toggle('search-open', open);
        $('#searchToggle').setAttribute('aria-expanded', String(open));
        if (open) $('#searchInput')?.focus();
    });

    // ------------------------------------------------------------------
    // Search extras: clear button, recent searches (combobox), Cmd/Ctrl+K
    // ------------------------------------------------------------------
    const searchForm = $('#searchForm');
    const searchInput = $('#searchInput');
    const pop = $('#searchPop');
    let activeIdx = -1;

    const recent = {
        list: () => store.get(KEYS.recent, []).filter(s => typeof s === 'string').slice(0, 5),
        add(q) {
            const v = (q || '').trim();
            if (!v) return;
            store.set(KEYS.recent, [v, ...recent.list().filter(s => s.toLowerCase() !== v.toLowerCase())].slice(0, 5));
        },
        clear: () => store.remove(KEYS.recent)
    };

    function syncSearchValue() {
        searchForm?.classList.toggle('has-value', !!searchInput.value);
        const clear = $('#searchClear');
        if (clear) clear.hidden = !searchInput.value;
    }

    function renderPop() {
        const items = recent.list();
        if (!pop || !items.length || searchInput.value) { closePop(); return; }
        activeIdx = -1;
        pop.innerHTML = `<div class="search-pop-head"><span>Recent</span><button type="button" class="link-btn" data-clear-recent>Clear</button></div>`
            + items.map((s, i) => `<button type="button" class="search-opt" role="option" id="recent-${i}" data-recent="${i}" aria-selected="false"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-clock"/></svg><span></span></button>`).join('');
        pop.querySelectorAll('[data-recent] span').forEach((span, i) => { span.textContent = items[i]; });
        pop.hidden = false;
        searchInput.setAttribute('aria-expanded', 'true');
    }

    function closePop() {
        if (!pop) return;
        pop.hidden = true;
        activeIdx = -1;
        searchInput?.setAttribute('aria-expanded', 'false');
        searchInput?.removeAttribute('aria-activedescendant');
    }

    function moveActive(delta) {
        const opts = $$('.search-opt', pop);
        if (!opts.length) return;
        activeIdx = (activeIdx + delta + opts.length) % opts.length;
        opts.forEach((o, i) => {
            o.classList.toggle('is-active', i === activeIdx);
            o.setAttribute('aria-selected', String(i === activeIdx));
        });
        searchInput.setAttribute('aria-activedescendant', opts[activeIdx].id);
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => { syncSearchValue(); renderPop(); });
        searchInput.addEventListener('focus', renderPop);
        searchInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== searchInput) closePop(); }, 150));
        searchInput.addEventListener('keydown', (e) => {
            if (pop && !pop.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                moveActive(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Enter' && pop && !pop.hidden && activeIdx >= 0) {
                e.preventDefault();
                $$('.search-opt', pop)[activeIdx]?.click();
            } else if (e.key === 'Escape') {
                if (pop && !pop.hidden) closePop();
                else if (header.classList.contains('search-open')) { header.classList.remove('search-open'); $('#searchToggle')?.focus(); }
            }
        });
        // Empty submit: a small shake says "type something" (exaggerated feedback).
        searchForm.addEventListener('submit', () => {
            if (!searchInput.value.trim()) {
                searchForm.classList.remove('shake');
                void searchForm.offsetWidth;
                searchForm.classList.add('shake');
            } else {
                recent.add(searchInput.value);
            }
            closePop();
        });
        pop?.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
        pop?.addEventListener('click', (e) => {
            if (e.target.closest('[data-clear-recent]')) { recent.clear(); closePop(); return; }
            const opt = e.target.closest('[data-recent]');
            if (!opt) return;
            searchInput.value = recent.list()[Number(opt.dataset.recent)] || '';
            syncSearchValue();
            searchForm.requestSubmit();
        });
        $('#searchClear')?.addEventListener('click', () => {
            searchInput.value = '';
            syncSearchValue();
            searchInput.focus();
            searchForm.dispatchEvent(new CustomEvent('search-clear', { bubbles: true }));
        });
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                if (getComputedStyle($('.search')).display === 'none') $('#searchToggle')?.click();
                searchInput.focus();
                searchInput.select();
            }
        });
        syncSearchValue();
    }

    // ------------------------------------------------------------------
    // Contact form (validation, error + success states)
    // ------------------------------------------------------------------
    const contact = $('#contactDialog');
    const contactForm = $('#contactForm');
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    function openContact(from) {
        if (!contact) return;
        resetContact();
        openDialog(contact, from);
        setTimeout(() => contactForm?.querySelector('input:not(.hp-field input)')?.focus(), 30);
    }

    function resetContact() {
        if (!contactForm) return;
        contactForm.hidden = false;
        $('#contactSuccess').hidden = true;
        $('#contactAlert').hidden = true;
        contactForm.dataset.submitted = '';
        $$('.field', contactForm).forEach(f => setFieldState(f, null));
    }

    function setFieldState(field, error) {
        const input = field.querySelector('input, textarea, select');
        const msg = field.querySelector('.field-error span');
        field.classList.toggle('is-invalid', !!error);
        field.classList.toggle('is-valid', error === '' && !!input?.value);
        if (input) input.setAttribute('aria-invalid', String(!!error));
        if (msg) msg.textContent = error || '';
    }

    function validateField(input) {
        const v = input.value.trim();
        switch (input.name) {
            case 'email':
                if (!v) return 'Please enter your email so we can reply.';
                if (!EMAIL_RE.test(v)) return 'That email doesn’t look right. Check for typos.';
                return '';
            case 'message':
                if (!v) return 'Please write a message.';
                if (v.length < 10) return `A little more detail, please (${10 - v.length} more characters).`;
                return '';
            case 'name':
                return v.length > 80 ? 'Please keep your name under 80 characters.' : '';
            default:
                return '';
        }
    }

    function validateAll() {
        let firstBad = null;
        $$('[name="name"], [name="email"], [name="message"]', contactForm).forEach(input => {
            const err = validateField(input);
            setFieldState(input.closest('.field'), err);
            if (err && !firstBad) firstBad = input;
        });
        return firstBad;
    }

    if (contactForm) {
        // Validate on blur, and live once the user has tried to submit.
        contactForm.addEventListener('focusout', (e) => {
            if (e.target.matches('[name="email"], [name="message"], [name="name"]') && (e.target.value || contactForm.dataset.submitted)) {
                setFieldState(e.target.closest('.field'), validateField(e.target));
            }
        });
        contactForm.addEventListener('input', (e) => {
            if (contactForm.dataset.submitted && e.target.matches('[name]')) setFieldState(e.target.closest('.field'), validateField(e.target));
            const counter = $('#messageCount');
            if (counter && e.target.name === 'message') counter.textContent = `${e.target.value.length} / 2000`;
        });

        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            contactForm.dataset.submitted = '1';
            $('#contactAlert').hidden = true;
            const bad = validateAll();
            if (bad) {
                contactForm.classList.remove('form-shake');
                void contactForm.offsetWidth;
                contactForm.classList.add('form-shake');
                bad.focus();
                announce('Please fix the highlighted fields.');
                return;
            }
            const btn = $('#contactSubmit');
            const label = btn.querySelector('.btn-label');
            btn.classList.add('is-loading');
            btn.disabled = true;
            label.textContent = 'Sending';
            btn.insertAdjacentHTML('afterbegin', loader('', { size: 'sm', delay: false }));

            const data = Object.fromEntries(new FormData(contactForm).entries());
            let res = null;
            let json = null;
            try {
                res = await fetch('/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...data, page: location.pathname, attribution: attribution() })
                });
                json = await res.json().catch(() => null);
            } catch { res = null; }

            btn.querySelector('.infinity')?.remove();
            btn.classList.remove('is-loading');
            btn.disabled = false;
            label.textContent = 'Send message';

            if (res && res.ok) {
                contactForm.reset();
                const counter = $('#messageCount');
                if (counter) counter.textContent = '0 / 2000';
                contactForm.hidden = true;
                const success = $('#contactSuccess');
                success.hidden = false;
                // Re-trigger the check animation (peak-end: make the ending feel good).
                success.querySelectorAll('.check-badge, .check-badge path').forEach(el => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
                success.querySelector('button')?.focus();
                announce('Message sent. Thank you!');
                return;
            }
            if (res && res.status === 422 && json?.errors) {
                Object.entries(json.errors).forEach(([name, msg]) => {
                    const input = contactForm.querySelector(`[name="${name}"]`);
                    if (input) setFieldState(input.closest('.field'), String(msg));
                });
                contactForm.querySelector('.is-invalid input, .is-invalid textarea')?.focus();
                return;
            }
            const alert = $('#contactAlert');
            alert.querySelector('span').textContent = !res
                ? 'You seem to be offline. Your message is still here. Try again when you’re connected.'
                : res.status === 429
                    ? 'Too many messages in a short time. Please wait a few minutes and try again.'
                    : (json?.error || 'Something went wrong on our side. Your message is still here. Please try again.');
            alert.hidden = false;
            announce(alert.textContent);
        });
    }

    document.addEventListener('click', (e) => {
        const t = e.target.closest('[data-action="open-contact"]');
        if (t) { e.preventDefault(); openContact(t); return; }
        if (e.target.closest('[data-action="close-contact"]')) closeDialog(contact);
        if (e.target.closest('[data-action="back-to-top"]')) scrollToTop();
    });

    // ------------------------------------------------------------------
    // Password visibility toggle ([data-password-toggle] next to an input)
    // ------------------------------------------------------------------
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-password-toggle]');
        if (!btn) return;
        const input = btn.parentElement.querySelector('input');
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
        input.focus({ preventScroll: true });
        const len = input.value.length;
        try { input.setSelectionRange(len, len); } catch { /* ignore */ }
    });

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    paintTheme();
    captureUtm();
    initCookieBanner();
    onScroll();

    window.KhabriUI = {
        announce, openDialog, closeDialog, confirm: confirmModal, copyText, burst, flyTo, loader,
        outbound, attribution, recent, setTheme, scrollToTop
    };
})();
