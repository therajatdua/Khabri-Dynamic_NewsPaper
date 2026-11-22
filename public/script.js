(() => {
    'use strict';

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------
    const CATEGORIES = {
        general: 'Top',
        technology: 'Tech',
        business: 'Business',
        sports: 'Sports',
        health: 'Health',
        science: 'Science',
        entertainment: 'Entertainment',
        nation: 'India',
        world: 'World'
    };
    const PICKABLE_TOPICS = ['nation', 'world', 'technology', 'business', 'sports', 'entertainment', 'health', 'science'];
    const VIEWS = new Set(['foryou', 'saved', ...Object.keys(CATEGORIES)]);
    const PAGE_SIZE = 12;
    const MAX_FOLLOWS = 5;
    const CLIENT_CACHE_MS = 10 * 60 * 1000;
    const AUTO_REFRESH_MS = 10 * 60 * 1000;
    const FALLBACK_IMG = '/fallback.svg';
    const STORE = {
        theme: 'khabri-newswala-theme',
        prefs: 'khabri-prefs-v1',
        signals: 'khabri-signals-v1',
        saved: 'khabri-saved-v1',
        read: 'khabri-read-v1',
        visit: 'khabri-visit-v1',
        brief: 'khabri-brief-v1'
    };
    const BRIEF_CACHE_MS = 30 * 60 * 1000;

    // ------------------------------------------------------------------
    // Safe storage
    // ------------------------------------------------------------------
    const store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch { /* ignore */ }
        }
    };

    const defaultPrefs = () => ({ onboarded: false, dismissed: false, topics: [], follows: [], region: 'in', lang: 'en', muted: [] });

    function loadPrefs() {
        const p = { ...defaultPrefs(), ...store.get(STORE.prefs, {}) };
        p.topics = Array.isArray(p.topics) ? p.topics.filter(t => PICKABLE_TOPICS.includes(t)) : [];
        p.follows = Array.isArray(p.follows) ? p.follows.map(f => safeText(f).slice(0, 40)).filter(Boolean).slice(0, MAX_FOLLOWS) : [];
        p.muted = Array.isArray(p.muted) ? p.muted.map(m => safeText(m)).filter(Boolean) : [];
        p.region = p.region === 'world' ? 'world' : 'in';
        p.lang = p.lang === 'hi' ? 'hi' : 'en';
        return p;
    }

    function loadSignals() {
        const s = store.get(STORE.signals, null) || { cat: {}, src: {}, ts: Date.now() };
        // Decay old interests ~3%/day so the feed follows current taste.
        const days = Math.max(0, (Date.now() - (s.ts || Date.now())) / 86_400_000);
        if (days > 0.5) {
            const f = Math.pow(0.97, days);
            for (const k of Object.keys(s.cat || {})) s.cat[k] *= f;
            for (const k of Object.keys(s.src || {})) s.src[k] *= f;
            s.ts = Date.now();
        }
        s.cat = s.cat || {};
        s.src = s.src || {};
        return s;
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    const visit = store.get(STORE.visit, {});
    const state = {
        view: 'foryou',
        region: 'in',
        query: '',
        prefs: loadPrefs(),
        signals: loadSignals(),
        saved: store.get(STORE.saved, []),
        read: store.get(STORE.read, {}),
        prevVisit: Number(visit.last) || 0,
        list: [],          // ranked list for current view
        shown: 0,          // how many of list are rendered
        byId: new Map(),   // id -> article (all seen this session)
        pending: null,     // newer list waiting behind the "new stories" pill
        archived: false,
        fetchedAt: null,
        refreshTimer: null,
        summaries: new Map(),
        brief: [],
        lastFocus: null
    };
    state.region = state.prefs.region;
    if (!Array.isArray(state.saved)) state.saved = [];
    if (!state.read || typeof state.read !== 'object') state.read = {};

    const $ = (id) => document.getElementById(id);
    const els = {
        brandLogo: $('brandLogo'),
        searchForm: $('searchForm'),
        searchInput: $('searchInput'),
        regionIndia: $('regionIndia'),
        regionWorld: $('regionWorld'),
        themeToggle: $('themeToggle'),
        prefsBtn: $('prefsBtn'),
        categoryNav: $('categoryNav'),
        savedCount: $('savedCount'),
        newPill: $('newPill'),
        newPillText: $('newPillText'),
        liveStatus: $('liveStatus'),
        archivedBanner: $('archivedBanner'),
        sinceBanner: $('sinceBanner'),
        onboardCard: $('onboardCard'),
        regionGroup: $('regionGroup'),
        menuRegion: $('menuRegion'),
        clearSavedBtn: $('clearSavedBtn'),
        feedEnd: $('feedEnd'),
        footerUpdated: $('footerUpdated'),
        briefCard: $('briefCard'),
        briefKicker: $('briefKicker'),
        briefList: $('briefList'),
        briefFoot: $('briefFoot'),
        briefListenBtn: $('briefListenBtn'),
        skeleton: $('skeleton'),
        hero: $('hero'),
        grid: $('grid'),
        emptyState: $('emptyState'),
        loadMoreBtn: $('loadMoreBtn'),
        quick: $('quick'),
        interestChips: $('interestChips'),
        refreshBtn: $('refreshBtn'),
        followQueryBtn: $('followQueryBtn'),
        sectionTitle: $('sectionTitle'),
        lastUpdated: $('lastUpdated'),
        storySheet: $('storySheet'),
        sheetContent: $('sheetContent'),
        prefsDialog: $('prefsDialog'),
        prefsForm: $('prefsForm'),
        topicPicker: $('topicPicker'),
        followInput: $('followInput'),
        followAddBtn: $('followAddBtn'),
        followChips: $('followChips'),
        prefRegion: $('prefRegion'),
        prefLang: $('prefLang'),
        mutedField: $('mutedField'),
        mutedChips: $('mutedChips'),
        resetPrefsBtn: $('resetPrefsBtn'),
        botToggle: $('botToggle'),
        bot: $('bot'),
        botClose: $('botClose'),
        botMessages: $('botMessages'),
        botForm: $('botForm'),
        botInput: $('botInput'),
        readBriefBtn: $('readBriefBtn'),
        toast: $('toast')
    };

    // ------------------------------------------------------------------
    // Utils
    // ------------------------------------------------------------------
    function safeText(value) {
        return (value ?? '').toString().trim();
    }

    function escapeHtml(str) {
        return safeText(str)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    // Only allow http(s) URLs into the DOM (blocks javascript:, data:, etc).
    const UI = () => window.KhabriUI || null;
    const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
    const outbound = (url) => (UI() ? UI().outbound(url) : url);
    const loaderHtml = (label, opts) => (UI() ? UI().loader(label, opts) : escapeHtml(label));

    function safeUrl(value) {
        try {
            const u = new URL(safeText(value));
            return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
        } catch {
            return '';
        }
    }

    function hashId(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return 'a' + (h >>> 0).toString(36);
    }

    function relTime(iso) {
        const t = Date.parse(iso);
        if (!Number.isFinite(t)) return '';
        const diff = Date.now() - t;
        const m = Math.round(diff / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.round(m / 60);
        if (h < 24) return `${h}h ago`;
        const d = Math.round(h / 24);
        if (d < 7) return `${d}d ago`;
        return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function clockTime(ts) {
        const d = new Date(ts);
        const sameDay = d.toDateString() === new Date().toDateString();
        const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return sameDay ? time : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
    }

    function ageHours(a) {
        const t = Date.parse(a.publishedAt);
        return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 3_600_000) : 48;
    }

    const STOP = new Set('the a an and or but to of in on for with from at by is are was were be been it this that these those as after over into amid says said new news its his her their will can how why what who live updates update today vs'.split(' '));
    function tokens(text) {
        return safeText(text).toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP.has(w));
    }

    // Same story from different outlets: >= 3 shared words covering at least
    // half of the shorter headline (outlets word headlines very differently).
    function sameStory(a, b) {
        if (a.size < 3 || b.size < 3) return false;
        let inter = 0;
        for (const w of a) if (b.has(w)) inter++;
        return inter >= 3 && inter / Math.min(a.size, b.size) >= 0.5;
    }

    function jaccard(a, b) {
        if (!a.size || !b.size) return 0;
        let inter = 0;
        for (const x of a) if (b.has(x)) inter++;
        return inter / (a.size + b.size - inter);
    }

    function announce(msg) {
        els.liveStatus.textContent = '';
        requestAnimationFrame(() => { els.liveStatus.textContent = msg; });
    }

    let toastTimer = null;
    function toast(msg) {
        els.toast.textContent = msg;
        els.toast.hidden = false;
        els.toast.style.animation = 'none';
        void els.toast.offsetWidth;
        els.toast.style.animation = '';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
    }

    // ------------------------------------------------------------------
    // Article model
    // ------------------------------------------------------------------
    function normalizeArticle(raw, meta = {}) {
        const url = safeUrl(raw?.url);
        const title = safeText(raw?.title);
        if (!url || !title) return null;
        const id = hashId(url);
        const existing = state.byId.get(id);
        const a = existing || {
            id,
            url,
            title,
            description: safeText(raw?.description),
            content: safeText(raw?.content),
            summary: safeText(raw?.summary),
            image: safeUrl(raw?.image || raw?.urlToImage),
            publishedAt: safeText(raw?.publishedAt),
            sourceName: safeText(raw?.source?.name || raw?.source_name || raw?.sourceName || raw?.source) || 'News',
            cat: meta.cat || 'general',
            follow: meta.follow || '',
            sources: []
        };
        if (meta.follow && !a.follow) a.follow = meta.follow;
        if (!a.summary && raw?.summary) a.summary = safeText(raw.summary);
        if (meta.cat && meta.cat !== 'general' && a.cat === 'general') a.cat = meta.cat;
        state.byId.set(id, a);
        return a;
    }

    // Group near-duplicate headlines from different outlets into one story.
    function cluster(articles) {
        const out = [];
        for (const a of articles) {
            a._tok = a._tok || new Set(tokens(a.title));
            const dup = out.find(o => o.url === a.url || sameStory(o._tok, a._tok));
            if (dup) {
                if (dup.url !== a.url && !dup.sources.some(s => s.url === a.url)) {
                    dup.sources.push({ name: a.sourceName, url: a.url });
                }
                if (!dup.image && a.image) dup.image = a.image;
                if (a.follow && !dup.follow) dup.follow = a.follow;
                continue;
            }
            a.sources = [];
            out.push(a);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Fetching
    // ------------------------------------------------------------------
    async function fetchFeed({ category = 'general', query = '', region, lang }) {
        const key = `kh_feed_${region}_${lang}_${category}_${query.toLowerCase()}`;
        try {
            const cached = JSON.parse(sessionStorage.getItem(key));
            if (cached && Date.now() - cached.ts < CLIENT_CACHE_MS) return cached.data;
        } catch { /* ignore */ }

        const qs = new URLSearchParams({ category, country: region, lang });
        if (query) qs.set('q', query);

        let data = null;
        try {
            const res = await fetch(`/api/news?${qs}`);
            if (!res.ok) throw new Error(`news ${res.status}`);
            const json = await res.json();
            if (!Array.isArray(json.articles)) throw new Error('bad payload');
            // `cached` = served from the Supabase fallback, not live: label it.
            data = { articles: json.articles, fetchedAt: json.fetchedAt || null, archived: !!json.cached };
        } catch {
            data = await fetchArchived({ category, query, region, lang });
        }

        if (data.articles.length && !data.archived) {
            try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch { /* ignore */ }
        }
        return data;
    }

    // Static snapshot used only when the live API is down. Clearly labelled.
    async function fetchArchived({ category, query, region, lang }) {
        const empty = { articles: [], fetchedAt: null, archived: true };
        if (lang !== 'en') return empty;
        const cat = ['nation', 'world'].includes(category) ? 'general' : category;
        const country = region === 'in' ? 'in' : 'us';
        try {
            const res = await fetch(`https://saurav.tech/NewsAPI/top-headlines/category/${encodeURIComponent(cat)}/${country}.json`);
            if (!res.ok) return empty;
            const json = await res.json();
            let articles = Array.isArray(json.articles) ? json.articles : [];
            if (query) {
                const q = query.toLowerCase();
                articles = articles.filter(a => `${a.title} ${a.description}`.toLowerCase().includes(q));
            }
            return { articles, fetchedAt: null, archived: true };
        } catch {
            return empty;
        }
    }

    function withoutMuted(list) {
        const muted = new Set(state.prefs.muted.map(m => m.toLowerCase()));
        return list.filter(a => !muted.has(a.sourceName.toLowerCase()));
    }

    async function buildView(view) {
        const { region } = state;
        const lang = state.prefs.lang;

        if (view === 'saved') {
            const list = state.saved.map(s => normalizeArticle(s, { cat: s.cat })).filter(Boolean);
            return { list, archived: false, fetchedAt: null };
        }

        if (state.query) {
            const r = await fetchFeed({ query: state.query, region, lang });
            const list = cluster(r.articles.map(a => normalizeArticle(a, { follow: '' })).filter(Boolean));
            return { list: withoutMuted(list).sort(byNewest), archived: r.archived, fetchedAt: r.fetchedAt };
        }

        if (view !== 'foryou') {
            const r = await fetchFeed({ category: view, region, lang });
            const list = cluster(r.articles.map(a => normalizeArticle(a, { cat: view })).filter(Boolean));
            return { list: withoutMuted(list).sort(byNewest), archived: r.archived, fetchedAt: r.fetchedAt };
        }

        // For You: top stories + chosen topics + followed keywords, ranked.
        const jobs = [{ category: 'general' }];
        state.prefs.topics.slice(0, 4).forEach(t => jobs.push({ category: t }));
        // Also include the user's strongest learned category if not already chosen.
        const learned = Object.entries(state.signals.cat)
            .filter(([c, v]) => v > 2 && CATEGORIES[c] && !jobs.some(j => j.category === c))
            .sort((a, b) => b[1] - a[1])[0];
        if (learned) jobs.push({ category: learned[0] });
        state.prefs.follows.forEach(f => jobs.push({ query: f, follow: f }));

        const results = await limitedAll(jobs.map(j => () => fetchFeed({ category: j.category || 'general', query: j.query || '', region, lang })), 2);
        let all = [];
        let archived = true;
        let fetchedAt = null;
        results.forEach((r, i) => {
            if (r.status !== 'fulfilled') return;
            const job = jobs[i];
            if (!r.value.archived) archived = false;
            if (r.value.fetchedAt && (!fetchedAt || r.value.fetchedAt > fetchedAt)) fetchedAt = r.value.fetchedAt;
            r.value.articles.forEach(raw => {
                const a = normalizeArticle(raw, { cat: job.category || 'general', follow: job.follow || '' });
                if (a) all.push(a);
            });
        });
        if (!all.length) archived = results.some(r => r.status === 'fulfilled' && r.value.archived);
        const list = rankForYou(withoutMuted(cluster(all)));
        return { list, archived, fetchedAt };
    }

    // Like Promise.allSettled, but runs at most `n` tasks at once (gentle on API rate limits).
    async function limitedAll(tasks, n) {
        const results = new Array(tasks.length);
        let next = 0;
        const worker = async () => {
            while (next < tasks.length) {
                const i = next++;
                try { results[i] = { status: 'fulfilled', value: await tasks[i]() }; }
                catch (reason) { results[i] = { status: 'rejected', reason }; }
            }
        };
        await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
        return results;
    }

    function byNewest(a, b) {
        return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
    }

    // ------------------------------------------------------------------
    // Personal ranking
    // ------------------------------------------------------------------
    const affinity = (x) => (x || 0) / (Math.abs(x || 0) + 5); // -1..1

    function scoreArticle(a) {
        // Followed-keyword results come from search and run older, so decay them slower.
        const recency = Math.exp(-ageHours(a) / (a.follow ? 24 : 10));
        const chosen = state.prefs.topics.includes(a.cat) ? 0.6 : 0;
        const topicW = Math.max(0.3, 1 + chosen + 0.5 * affinity(state.signals.cat[a.cat]));
        const srcW = Math.max(0.5, 1 + 0.3 * affinity(state.signals.src[a.sourceName]));
        const followW = a.follow ? 1.6 : 1;
        const readW = state.read[a.id] ? 0.3 : 1;
        const clusterW = 1 + 0.15 * Math.min(4, a.sources.length);
        return recency * topicW * srcW * followW * readW * clusterW;
    }

    function rankForYou(list) {
        const scored = list.map(a => ({ a, s: scoreArticle(a) })).sort((x, y) => y.s - x.s);
        // Diversity: avoid long runs of the same category.
        const out = [];
        const pool = scored.slice();
        while (pool.length) {
            const recent = out.slice(-3).map(a => a.follow || a.cat);
            let bestIdx = 0;
            let best = -1;
            for (let i = 0; i < Math.min(pool.length, 8); i++) {
                const penalty = recent.filter(c => c === (pool[i].a.follow || pool[i].a.cat)).length;
                const s = pool[i].s * Math.pow(0.75, penalty);
                if (s > best) { best = s; bestIdx = i; }
            }
            out.push(pool.splice(bestIdx, 1)[0].a);
        }
        return out;
    }

    function bump(article, weight) {
        const s = state.signals;
        s.cat[article.cat] = Math.max(-8, Math.min(40, (s.cat[article.cat] || 0) + weight));
        s.src[article.sourceName] = Math.max(-8, Math.min(40, (s.src[article.sourceName] || 0) + weight));
        s.ts = s.ts || Date.now();
        store.set(STORE.signals, s);
    }

    function markRead(article) {
        state.read[article.id] = Date.now();
        const ids = Object.keys(state.read);
        if (ids.length > 600) {
            ids.sort((a, b) => state.read[a] - state.read[b]).slice(0, ids.length - 600).forEach(id => delete state.read[id]);
        }
        store.set(STORE.read, state.read);
        document.querySelectorAll(`[data-card="${article.id}"]`).forEach(el => el.classList.add('is-read'));
    }

    // ------------------------------------------------------------------
    // Saved
    // ------------------------------------------------------------------
    const isSaved = (id) => state.saved.some(s => s.id === id);

    function toggleSave(article, fromBtn) {
        const wasSaved = isSaved(article.id);
        if (wasSaved) {
            state.saved = state.saved.filter(s => s.id !== article.id);
            toast('Removed from saved');
        } else {
            const { id, url, title, description, image, publishedAt, sourceName, cat } = article;
            state.saved.unshift({ id, url, title, description, image, publishedAt, sourceName, cat, savedAt: Date.now() });
            state.saved = state.saved.slice(0, 200);
            bump(article, 2);
            toast('Saved — find it under 🔖 Saved');
        }
        store.set(STORE.saved, state.saved);
        document.querySelectorAll(`[data-save="${article.id}"]`).forEach(btn => {
            const on = isSaved(article.id);
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-pressed', String(on));
            btn.setAttribute('aria-label', on ? 'Remove from saved' : 'Save story');
        });
        if (!wasSaved && fromBtn) {
            // Exaggerated pop + burst on the button, then the bookmark arcs to the Saved tab.
            fromBtn.classList.remove('pop');
            void fromBtn.offsetWidth;
            fromBtn.classList.add('pop');
            UI()?.burst(fromBtn);
            const target = document.querySelector('.cat-saved');
            const r = target?.getBoundingClientRect();
            const visible = r && r.width && r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight && !els.storySheet.open;
            const fly = visible && UI() ? UI().flyTo(fromBtn, target) : Promise.resolve();
            fly.then(() => { updateSavedCount(); bumpSavedCount(); });
        } else {
            updateSavedCount();
        }
        if (state.view === 'saved') refresh();
    }

    function bumpSavedCount() {
        els.savedCount.classList.remove('bump');
        void els.savedCount.offsetWidth;
        els.savedCount.classList.add('bump');
    }

    function updateSavedCount() {
        const n = state.saved.length;
        els.savedCount.hidden = n === 0;
        els.savedCount.textContent = String(n);
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    function badges(a) {
        const out = [];
        if (ageHours(a) < 1) out.push('<span class="badge badge-live">LIVE</span>');
        else if (state.prevVisit && Date.parse(a.publishedAt) > state.prevVisit && !state.read[a.id]) out.push('<span class="badge badge-new">NEW</span>');
        if (a.follow) out.push(`<span class="badge badge-follow">${escapeHtml(a.follow)}</span>`);
        if (a.sources.length) out.push(`<span class="badge">${a.sources.length + 1} sources</span>`);
        return out.join('');
    }

    function metaLine(a) {
        const t = relTime(a.publishedAt);
        return `<span class="source">${escapeHtml(a.sourceName)}</span>${t ? `<span aria-hidden="true">•</span><time datetime="${escapeHtml(a.publishedAt)}">${escapeHtml(t)}</time>` : ''}`;
    }

    function saveBtn(a, extraClass = '') {
        const on = isSaved(a.id);
        return `<button class="icon-btn save-btn ${extraClass} ${on ? 'is-on' : ''}" type="button" data-save="${a.id}" aria-pressed="${on}" aria-label="${on ? 'Remove from saved' : 'Save story'}">${icon('bookmark')}</button>`;
    }

    function renderHero(a) {
        els.hero.dataset.card = a.id;
        els.hero.classList.toggle('is-read', !!state.read[a.id]);
        els.hero.innerHTML = `
            <div class="hero-img-wrapper">
                <img class="hero-img" src="${escapeHtml(a.image || FALLBACK_IMG)}" alt="" fetchpriority="high" />
            </div>
            <div class="hero-body">
                <div class="meta">${metaLine(a)} ${badges(a)}</div>
                <h2 class="hero-title"><a href="${escapeHtml(outbound(a.url))}" data-src="${escapeHtml(a.url)}" data-open="${a.id}" class="stretched">${escapeHtml(a.title)}</a></h2>
                <p class="hero-desc">${escapeHtml(a.description)}</p>
                <div class="hero-actions">
                    <button class="btn" type="button" data-open="${a.id}">${icon('sparkle', 'ic ic-sm')}AI summary</button>
                    ${saveBtn(a, 'on-dark')}
                    <button class="icon-btn" type="button" data-share="${a.id}" aria-label="Share story">${icon('share')}</button>
                </div>
            </div>`;
    }

    function cardHtml(a, i = 0) {
        return `
            <article class="card specular enter ${state.read[a.id] ? 'is-read' : ''}" data-card="${a.id}" style="--i:${Math.min(i, 8)}">
                <div class="card-img-wrapper">
                    <img class="card-img" src="${escapeHtml(a.image || FALLBACK_IMG)}" alt="" loading="lazy" decoding="async" />
                </div>
                <div class="card-body">
                    <div class="meta">${metaLine(a)}</div>
                    <div class="badges">${badges(a)}</div>
                    <h3 class="card-title"><a href="${escapeHtml(outbound(a.url))}" data-src="${escapeHtml(a.url)}" data-open="${a.id}" class="stretched">${escapeHtml(a.title)}</a></h3>
                    <p class="card-desc">${escapeHtml(a.description)}</p>
                    <div class="card-actions">
                        <button class="btn" type="button" data-open="${a.id}">${icon('sparkle', 'ic ic-sm')}Summary</button>
                        ${saveBtn(a)}
                        <button class="icon-btn" type="button" data-share="${a.id}" aria-label="Share story">${icon('share')}</button>
                    </div>
                </div>
            </article>`;
    }

    function renderMore() {
        const next = state.list.slice(state.shown, state.shown + PAGE_SIZE);
        els.grid.insertAdjacentHTML('beforeend', next.map((a, i) => cardHtml(a, i)).join(''));
        state.shown += next.length;
        els.loadMoreBtn.hidden = state.shown >= state.list.length;
        updateFeedEnd();
    }

    // Peak-end: a clear, satisfying ending instead of a dead stop.
    function updateFeedEnd() {
        const done = state.list.length > 0 && state.shown >= state.list.length && state.view !== 'saved';
        els.feedEnd.hidden = !done;
        if (!done) { els.feedEnd.innerHTML = ''; return; }
        if (els.feedEnd.dataset.count === String(state.list.length) && els.feedEnd.innerHTML) return;
        els.feedEnd.dataset.count = String(state.list.length);
        const outlets = new Set(state.list.map(a => a.sourceName)).size;
        els.feedEnd.innerHTML = `
            <div class="check-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>
            <h3>You’re all caught up</h3>
            <p>${state.list.length} stories from ${outlets} ${outlets === 1 ? 'outlet' : 'outlets'}. New stories arrive every few minutes.</p>
            <div class="feed-end-actions">
                <button class="btn subtle lg" type="button" data-action="back-to-top">${icon('arrow-up', 'ic ic-sm')}Back to top</button>
                ${state.view !== 'foryou' || state.query ? `<button class="btn lg" type="button" data-action="go-foryou">${icon('sparkle', 'ic ic-sm')}Your For You feed</button>` : `<button class="btn lg" type="button" data-action="open-prefs">${icon('sliders', 'ic ic-sm')}Tune your feed</button>`}
            </div>`;
    }

    // Relative times tick so "Updated 3m ago" never goes stale.
    function tickTimes() {
        document.querySelectorAll('#feed time[datetime], #footerUpdated[datetime], #lastUpdated[datetime]').forEach(t => {
            const iso = t.getAttribute('datetime');
            const rel = relTime(iso);
            if (rel) t.textContent = rel;
        });
    }

    function setUpdated(iso, archived) {
        [els.lastUpdated, els.footerUpdated].forEach(t => {
            if (!t) return;
            if (iso) {
                t.setAttribute('datetime', iso);
                t.textContent = relTime(iso) || 'just now';
                t.title = new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
            } else {
                t.removeAttribute('datetime');
                t.textContent = archived ? 'from saved copy' : '—';
                t.removeAttribute('title');
            }
        });
    }

    function renderQuick(list) {
        const top = list.slice().sort((a, b) => b.sources.length - a.sources.length || byNewest(a, b)).slice(0, 8);
        els.quick.innerHTML = top.length
            ? top.map(a => `<li><a href="${escapeHtml(a.url)}" data-open="${a.id}">${escapeHtml(a.title)}</a><span class="quick-meta">${escapeHtml(a.sourceName)} · ${escapeHtml(relTime(a.publishedAt))}</span></li>`).join('')
            : '<li class="muted">No headlines yet.</li>';
    }

    function renderInterests() {
        const p = state.prefs;
        const chips = [
            ...p.topics.map(t => `<span class="chip">${escapeHtml(CATEGORIES[t])}</span>`),
            ...p.follows.map(f => `<span class="chip chip-follow">${escapeHtml(f)}<button type="button" data-unfollow="${escapeHtml(f)}" aria-label="Unfollow ${escapeHtml(f)}">×</button></span>`)
        ];
        els.interestChips.innerHTML = chips.length
            ? chips.join('')
            : '<p class="hint">No interests yet — <button class="link-btn" type="button" data-action="open-prefs">pick a few</button> and For You gets smarter.</p>';
    }

    function renderSince(list) {
        if (!state.prevVisit || state.view === 'saved' || state.query) { els.sinceBanner.hidden = true; return; }
        const n = list.filter(a => Date.parse(a.publishedAt) > state.prevVisit && !state.read[a.id]).length;
        if (!n) { els.sinceBanner.hidden = true; return; }
        els.sinceBanner.innerHTML = `<strong>${n} new ${n === 1 ? 'story' : 'stories'}</strong> since your last visit (${escapeHtml(clockTime(state.prevVisit))}). Look for the <span class="badge badge-new">NEW</span> tag.`;
        els.sinceBanner.hidden = false;
    }

    function sectionTitle() {
        if (state.query) return `Results for “${state.query}”`;
        if (state.view === 'foryou') return state.prefs.onboarded ? 'For You' : 'For You · Top picks';
        if (state.view === 'saved') return 'Saved stories';
        return CATEGORIES[state.view] || 'Latest';
    }

    function renderEmpty() {
        let html;
        if (state.view === 'saved') {
            html = '<h3>Nothing saved yet</h3><p>Tap 🔖 on any story to read it later — saved stories stay on this device.</p>';
        } else if (state.query) {
            html = `<h3>No stories found for “${escapeHtml(state.query)}”</h3><p>Try a broader keyword, or switch region.</p>`;
        } else {
            html = '<h3>Couldn’t load news</h3><p>Check your connection and try again.</p><button class="btn" type="button" data-action="retry">Try again</button>';
        }
        els.emptyState.innerHTML = html;
        els.emptyState.hidden = false;
    }

    function render(result) {
        state.list = result.list;
        state.archived = result.archived;
        state.fetchedAt = result.fetchedAt;
        state.shown = 0;

        els.skeleton.hidden = true;
        els.sectionTitle.textContent = sectionTitle();
        els.archivedBanner.hidden = !(result.archived && result.list.length && state.view !== 'saved');
        els.followQueryBtn.hidden = !state.query || state.prefs.follows.some(f => f.toLowerCase() === state.query.toLowerCase());
        els.followQueryBtn.textContent = `＋ Follow “${state.query}”`;
        els.onboardCard.hidden = state.prefs.onboarded || state.prefs.dismissed || state.view !== 'foryou' || !!state.query;

        setUpdated(result.fetchedAt, result.archived);
        els.lastUpdated.parentElement.hidden = state.view === 'saved';
        els.clearSavedBtn.hidden = !(state.view === 'saved' && state.saved.length);
        els.refreshBtn.hidden = state.view === 'saved';
        els.feedEnd.dataset.count = '';

        els.grid.innerHTML = '';
        els.emptyState.hidden = true;

        if (!state.list.length) {
            els.hero.hidden = true;
            els.grid.hidden = true;
            els.loadMoreBtn.hidden = true;
            renderEmpty();
        } else if (state.view === 'saved') {
            els.hero.hidden = true;
            els.grid.hidden = false;
            renderMore();
        } else {
            // Prefer a hero with an image among the top 3.
            const heroIdx = Math.max(0, state.list.slice(0, 3).findIndex(a => a.image));
            const [hero] = state.list.splice(heroIdx, 1);
            state.list.unshift(hero);
            renderHero(hero);
            els.hero.hidden = false;
            els.grid.hidden = false;
            state.shown = 1;
            renderMore();
        }

        if (state.view !== 'saved') renderQuick(result.list);
        renderSince(result.list);
        renderInterests();
        loadBrief();
        announce(`${sectionTitle()}: ${state.list.length} stories loaded`);
    }

    // ------------------------------------------------------------------
    // Daily briefing (For You only, hideable until tomorrow)
    // ------------------------------------------------------------------
    let briefSeq = 0;
    const todayKey = () => new Date().toLocaleDateString('en-CA');

    function briefGreeting() {
        const h = new Date().getHours();
        if (h < 12) return '☀ Morning briefing';
        if (h < 17) return '🌤 Afternoon briefing';
        return '🌙 Evening briefing';
    }

    async function loadBrief() {
        const seq = ++briefSeq;
        const show = state.view === 'foryou' && !state.query && store.get(STORE.brief, {}).hidden !== todayKey();
        if (!show) { hideBrief(); return; }

        const region = state.region;
        const lang = state.prefs.lang;
        const key = `kh_brief_${region}_${lang}`;
        let data = null;
        try {
            const cached = JSON.parse(sessionStorage.getItem(key));
            if (cached && Date.now() - cached.ts < BRIEF_CACHE_MS) data = cached.data;
        } catch { /* ignore */ }

        if (!data) {
            try {
                const res = await fetch(`/api/brief?${new URLSearchParams({ country: region, lang })}`);
                if (!res.ok) throw new Error(`brief ${res.status}`);
                data = await res.json();
                if (data.ai) {
                    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch { /* ignore */ }
                }
            } catch {
                data = null;
            }
        }
        if (seq !== briefSeq) return; // view changed while loading

        const items = (data?.items || [])
            .map(it => ({ text: safeText(it.text), a: normalizeArticle(it.article, { cat: 'general' }) }))
            .filter(it => it.text && it.a && !state.prefs.muted.some(m => m.toLowerCase() === it.a.sourceName.toLowerCase()));
        if (items.length < 3) { hideBrief(); return; }

        state.brief = items;
        els.briefKicker.textContent = briefGreeting();
        els.briefList.innerHTML = items.map(({ text, a }) => `
            <li><a class="brief-item${state.read[a.id] ? ' is-read' : ''}" href="${escapeHtml(a.url)}" data-open="${a.id}" data-card="${a.id}">
                <span class="brief-text">${escapeHtml(text)}</span>
                <span class="brief-src">${escapeHtml(a.sourceName)}${a.publishedAt ? ` · ${escapeHtml(relTime(a.publishedAt))}` : ''}</span>
            </a></li>`).join('');
        const when = data.generatedAt ? ` · updated ${clockTime(Date.parse(data.generatedAt))}` : '';
        els.briefFoot.textContent = data.ai
            ? `Picked and summarised by AI from today’s top headlines${when}. Tap a story for details.`
            : `Today’s top headlines${when}.`;
        els.briefCard.hidden = false;
    }

    function hideBrief() {
        els.briefCard.hidden = true;
        if (els.briefCard.classList.contains('is-speaking')) stopSpeaking();
    }

    // ------------------------------------------------------------------
    // Refresh + new stories pill
    // ------------------------------------------------------------------
    let refreshSeq = 0;

    async function refresh({ silent = false } = {}) {
        const seq = ++refreshSeq;
        if (!silent) {
            els.skeleton.hidden = false;
            els.hero.hidden = true;
            els.grid.hidden = true;
            els.emptyState.hidden = true;
            els.loadMoreBtn.hidden = true;
            els.feedEnd.hidden = true;
            els.newPill.hidden = true;
            state.pending = null;
        }
        let result;
        try {
            result = await buildView(state.view);
        } catch {
            result = { list: [], archived: false, fetchedAt: null };
        }
        if (seq !== refreshSeq) return; // a newer refresh superseded this one

        if (silent) {
            const current = new Set(state.list.map(a => a.id));
            const fresh = result.list.filter(a => !current.has(a.id));
            if (fresh.length) {
                state.pending = result;
                els.newPillText.textContent = `${fresh.length} new ${fresh.length === 1 ? 'story' : 'stories'}`;
                els.newPill.hidden = false;
            }
            return;
        }
        render(result);
    }

    function applyPending() {
        if (!state.pending) return;
        render(state.pending);
        state.pending = null;
        els.newPill.hidden = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function scheduleAutoRefresh() {
        clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible' && state.view !== 'saved') {
                clearFeedCache();
                refresh({ silent: true });
            }
        }, AUTO_REFRESH_MS);
    }

    function clearFeedCache() {
        try {
            Object.keys(sessionStorage).filter(k => k.startsWith('kh_feed_')).forEach(k => sessionStorage.removeItem(k));
        } catch { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // URL state (shareable, back button works)
    // ------------------------------------------------------------------
    function readUrl() {
        const p = new URLSearchParams(location.search);
        const cat = p.get('cat');
        state.view = VIEWS.has(cat) ? cat : 'foryou';
        const region = p.get('region');
        if (region === 'in' || region === 'world') state.region = region;
        state.query = safeText(p.get('q') || p.get('search')).slice(0, 100);
    }

    function writeUrl(replace = false) {
        const p = new URLSearchParams();
        if (state.view !== 'foryou') p.set('cat', state.view);
        if (state.region !== state.prefs.region) p.set('region', state.region);
        if (state.query) p.set('q', state.query);
        const url = `${location.pathname}${p.toString() ? `?${p}` : ''}`;
        if (url === `${location.pathname}${location.search}`) return;
        history[replace ? 'replaceState' : 'pushState']({}, '', url);
    }

    function syncControls() {
        els.regionIndia.classList.toggle('is-active', state.region === 'in');
        els.regionWorld.classList.toggle('is-active', state.region !== 'in');
        els.regionIndia.setAttribute('aria-pressed', String(state.region === 'in'));
        els.regionWorld.setAttribute('aria-pressed', String(state.region !== 'in'));
        const regionValue = state.region === 'in' ? 'in' : 'world';
        [els.regionGroup, els.menuRegion].forEach(g => { if (g) g.dataset.value = regionValue; });
        els.menuRegion?.querySelectorAll('[data-region]').forEach(b => {
            const on = b.dataset.region === regionValue;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', String(on));
        });
        els.categoryNav.querySelectorAll('.cat').forEach(btn => {
            const on = !state.query && btn.dataset.cat === state.view;
            btn.classList.toggle('is-active', on);
            if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
        });
        els.searchInput.value = state.query;
        document.documentElement.lang = state.prefs.lang === 'hi' ? 'hi' : 'en';
    }

    function navigate(changes) {
        Object.assign(state, changes);
        syncControls();
        writeUrl();
        refresh();
    }

    // ------------------------------------------------------------------
    // Story sheet
    // ------------------------------------------------------------------
    function localSummary(a) {
        const base = safeText(a.description || a.content || a.title);
        const sentences = base.split(/(?<=[.!?।])\s+/).filter(Boolean);
        return sentences.slice(0, 2).join(' ') || a.title;
    }

    async function getSummary(a) {
        if (state.summaries.has(a.id)) return state.summaries.get(a.id);
        if (a.summary) return a.summary; // pre-written by the ingest job
        let summary = '';
        try {
            const res = await fetch('/api/summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: a.title, description: a.description, content: a.content, url: a.url })
            });
            if (res.ok) summary = safeText((await res.json())?.summary);
        } catch { /* ignore */ }
        summary = summary || localSummary(a);
        state.summaries.set(a.id, summary);
        return summary;
    }

    function related(a) {
        const tok = a._tok || new Set(tokens(a.title));
        return [...state.byId.values()]
            .filter(o => o.id !== a.id && !a.sources.some(s => s.url === o.url))
            .map(o => ({ o, s: jaccard(tok, o._tok || (o._tok = new Set(tokens(o.title)))) + (o.cat === a.cat ? 0.05 : 0) }))
            .filter(x => x.s > 0.12)
            .sort((x, y) => y.s - x.s)
            .slice(0, 3)
            .map(x => x.o);
    }

    function openStory(a, opener) {
        state.lastFocus = opener || document.activeElement;
        markRead(a);
        bump(a, 1);

        const rel = related(a);
        const sources = a.sources.length
            ? `<div class="sheet-section"><div class="sheet-label">Also covered by</div><ul class="source-list">${a.sources.map(s => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)} ↗</a></li>`).join('')}</ul></div>`
            : '';
        const relHtml = rel.length
            ? `<div class="sheet-section"><div class="sheet-label">Related stories</div><ul class="related-list">${rel.map(r => `<li><a href="${escapeHtml(r.url)}" data-open="${r.id}">${escapeHtml(r.title)}</a><span class="quick-meta">${escapeHtml(r.sourceName)} · ${escapeHtml(relTime(r.publishedAt))}</span></li>`).join('')}</ul></div>`
            : '';

        const href = escapeHtml(outbound(a.url));
        els.sheetContent.innerHTML = `
            <div class="sheet-grip" aria-hidden="true"></div>
            <div class="sheet-head">
                <button class="icon-btn" type="button" data-action="print-story" aria-label="Print story">${icon('printer', 'ic ic-sm')}</button>
                <button class="icon-btn" type="button" data-close-sheet aria-label="Close story">${icon('close', 'ic ic-sm')}</button>
            </div>
            <div class="sheet-scroll">
                <img class="sheet-img" src="${escapeHtml(a.image || FALLBACK_IMG)}" alt="" />
                <div class="sheet-body">
                    <div class="meta">${metaLine(a)} ${badges(a)}</div>
                    <h2 class="sheet-title" id="sheetTitle">${escapeHtml(a.title)}</h2>
                    <div class="ai-box">
                        <div class="sheet-label"><span>✦ AI summary</span>
                            <button class="icon-btn copy-btn" type="button" data-copy-target="#sheetSummary" data-copy-message="Summary copied" aria-label="Copy summary" hidden>${icon('copy', 'ic ic-sm ic-copy')}${icon('check', 'ic ic-sm ic-check')}</button>
                        </div>
                        <div id="sheetSummary" class="ai-text is-loading">${loaderHtml('Summarizing', { size: 'sm', inline: true })}</div>
                        <p class="ai-note">AI-generated from the publisher’s headline and description. It can make mistakes.</p>
                    </div>
                    ${a.description ? `<p class="sheet-desc">${escapeHtml(a.description)}</p>` : ''}
                    <div class="sheet-actions">
                        <a class="btn lg" href="${href}" target="_blank" rel="noopener noreferrer">Read at ${escapeHtml(a.sourceName)} ${icon('external', 'ic ic-sm')}</a>
                        ${saveBtn(a)}
                        <button class="icon-btn" type="button" data-share="${a.id}" aria-label="Share story">${icon('share')}</button>
                        <button class="icon-btn copy-btn" type="button" data-copy="${escapeHtml(a.url)}" data-copy-message="Link copied" aria-label="Copy link">${icon('link', 'ic ic-copy')}${icon('check', 'ic ic-check')}</button>
                    </div>
                    ${sources}
                    ${relHtml}
                    <div class="sheet-feedback">
                        <button class="link-btn" type="button" data-less="${a.id}">Show less like this</button>
                        <button class="link-btn" type="button" data-mute="${a.id}">Hide stories from ${escapeHtml(a.sourceName)}</button>
                    </div>
                </div>
            </div>`;

        els.storySheet.classList.remove('is-closing');
        els.storySheet.style.transform = '';
        if (!els.storySheet.open) els.storySheet.showModal();
        els.sheetContent.querySelector('.sheet-scroll').scrollTop = 0;
        els.sheetContent.querySelector('[data-close-sheet]').focus();

        getSummary(a).then(text => {
            const node = $('sheetSummary');
            if (node && els.storySheet.open && $('sheetTitle')?.textContent === a.title) {
                node.textContent = text; // always text, never HTML
                node.classList.remove('is-loading');
                const copy = els.sheetContent.querySelector('.ai-box .copy-btn');
                if (copy) copy.hidden = !text;
            }
        });
    }

    function closeStory() {
        if (!els.storySheet.open) return;
        if (UI()) UI().closeDialog(els.storySheet);
        else els.storySheet.close();
    }

    // Phones: the sheet follows the finger; past the top it rubber-bands,
    // dragged down far (or flicked) it dismisses, otherwise it springs back.
    function enableSheetDrag() {
        const sheet = els.storySheet;
        let startY = 0, lastY = 0, lastT = 0, velocity = 0, dragging = false, dy = 0;
        const rubber = (d, limit = 120) => (1 - 1 / ((d * 0.55) / limit + 1)) * limit;
        const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

        sheet.addEventListener('pointerdown', (e) => {
            if (!isPhone() || !e.target.closest('.sheet-grip, .sheet-img')) return;
            dragging = true;
            startY = lastY = e.clientY;
            lastT = performance.now();
            velocity = 0;
            dy = 0;
            sheet.classList.remove('is-settling');
            sheet.classList.add('is-dragging');
            sheet.setPointerCapture?.(e.pointerId);
        });
        sheet.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const now = performance.now();
            velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
            lastY = e.clientY;
            lastT = now;
            const raw = e.clientY - startY;
            dy = raw >= 0 ? raw : -rubber(-raw);
            sheet.style.transform = `translateY(${dy}px)`;
        });
        const end = () => {
            if (!dragging) return;
            dragging = false;
            sheet.classList.remove('is-dragging');
            // The pointerup after a drag can land on the backdrop and fire a
            // "click outside"; remember the drag so that click is ignored.
            if (Math.abs(dy) > 4) sheet.dataset.draggedAt = String(Date.now());
            if (dy > 120 || velocity > 0.7) {
                sheet.classList.add('is-settling');
                sheet.style.transform = 'translateY(100%)';
                setTimeout(() => { sheet.classList.remove('is-settling'); sheet.close(); sheet.style.transform = ''; }, 220);
            } else {
                sheet.classList.add('is-settling');
                sheet.style.transform = '';
                setTimeout(() => sheet.classList.remove('is-settling'), 380);
            }
        };
        sheet.addEventListener('pointerup', end);
        sheet.addEventListener('pointercancel', end);
    }

    async function share(a) {
        const text = `${a.title} — via Khabri -NewsWala`;
        if (navigator.share) {
            try { await navigator.share({ title: a.title, text, url: a.url }); return; } catch { return; }
        }
        try {
            await navigator.clipboard.writeText(`${text}\n${a.url}`);
            toast('Link copied');
        } catch {
            window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${a.url}`)}`, '_blank', 'noopener');
        }
    }

    // ------------------------------------------------------------------
    // Preferences dialog
    // ------------------------------------------------------------------
    let draft = null;

    function openPrefs() {
        draft = JSON.parse(JSON.stringify(state.prefs));
        els.topicPicker.innerHTML = PICKABLE_TOPICS.map(t => `
            <label class="pick"><input type="checkbox" value="${t}" ${draft.topics.includes(t) ? 'checked' : ''}/><span>${escapeHtml(CATEGORIES[t])}</span></label>`).join('');
        els.prefRegion.value = draft.region;
        els.prefLang.value = draft.lang;
        renderDraftChips();
        if (UI()) UI().openDialog(els.prefsDialog);
        else els.prefsDialog.showModal();
    }

    function renderDraftChips() {
        els.followChips.innerHTML = draft.follows.map(f => `<span class="chip chip-follow">${escapeHtml(f)}<button type="button" data-draft-unfollow="${escapeHtml(f)}" aria-label="Remove ${escapeHtml(f)}">×</button></span>`).join('');
        els.followAddBtn.disabled = draft.follows.length >= MAX_FOLLOWS;
        els.mutedField.hidden = draft.muted.length === 0;
        els.mutedChips.innerHTML = draft.muted.map(m => `<span class="chip">${escapeHtml(m)}<button type="button" data-draft-unmute="${escapeHtml(m)}" aria-label="Unhide ${escapeHtml(m)}">×</button></span>`).join('');
    }

    function addDraftFollow() {
        const v = safeText(els.followInput.value).slice(0, 40);
        if (!v) return;
        if (draft.follows.length >= MAX_FOLLOWS) { toast(`You can follow up to ${MAX_FOLLOWS} keywords`); return; }
        if (!draft.follows.some(f => f.toLowerCase() === v.toLowerCase())) draft.follows.push(v);
        els.followInput.value = '';
        renderDraftChips();
        els.followInput.focus();
    }

    function savePrefs(next) {
        const regionChanged = next.region !== state.prefs.region;
        const langChanged = next.lang !== state.prefs.lang;
        state.prefs = { ...next, onboarded: true };
        store.set(STORE.prefs, state.prefs);
        if (regionChanged) state.region = state.prefs.region;
        if (langChanged) clearFeedCache();
        navigate({ view: 'foryou', query: '' });
        toast('Your feed is updated');
    }

    function follow(keyword) {
        const k = safeText(keyword).slice(0, 40);
        if (!k) return;
        if (state.prefs.follows.length >= MAX_FOLLOWS) { toast(`You can follow up to ${MAX_FOLLOWS} keywords — remove one first`); return; }
        if (!state.prefs.follows.some(f => f.toLowerCase() === k.toLowerCase())) state.prefs.follows.push(k);
        state.prefs.onboarded = true;
        store.set(STORE.prefs, state.prefs);
        els.followQueryBtn.hidden = true;
        renderInterests();
        toast(`Following “${k}” — it’ll show up in For You`);
    }

    function unfollow(keyword) {
        state.prefs.follows = state.prefs.follows.filter(f => f !== keyword);
        store.set(STORE.prefs, state.prefs);
        renderInterests();
        if (state.view === 'foryou') refresh();
    }

    // ------------------------------------------------------------------
    // Theme
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // AI assistant
    // ------------------------------------------------------------------
    function botMsg(text, who) {
        const div = document.createElement('div');
        div.className = `msg ${who}`;
        div.innerHTML = linkify(text);
        els.botMessages.appendChild(div);
        els.botMessages.scrollTop = els.botMessages.scrollHeight;
        return div;
    }

    // Escape first, then turn plain URLs into links. Never trusts HTML.
    function linkify(text) {
        return escapeHtml(text)
            .replace(/https?:\/\/[^\s<]+/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m.length > 48 ? `${m.slice(0, 45)}…` : m}</a>`)
            .replaceAll('\n', '<br>');
    }

    function onScreen() {
        return (state.list.length ? state.list : [...state.byId.values()]).slice(0, 12);
    }

    function buildLocalAnswer(question) {
        const q = safeText(question).toLowerCase();
        const items = onScreen();
        if (!items.length) return 'No headlines are loaded yet. Try refreshing.';
        if (/summar|brief|top|latest/.test(q)) {
            return `Here’s the quick brief:\n\n${items.slice(0, 5).map((a, i) => `${i + 1}. ${a.title}`).join('\n')}`;
        }
        const qt = new Set(tokens(q));
        const top = items.map(a => ({ a, s: jaccard(qt, new Set(tokens(`${a.title} ${a.description}`))) })).filter(x => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 3);
        if (!top.length) return 'I couldn’t match that to the loaded headlines. Try “summarize”, or search for the topic first.';
        return `Most relevant stories right now:\n\n${top.map((x, i) => `${i + 1}. ${x.a.title}\n${x.a.url}`).join('\n\n')}`;
    }

    async function askBot(question) {
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question,
                    articles: onScreen().map(a => ({ title: a.title, description: a.description, url: a.url, source: a.sourceName, publishedAt: a.publishedAt }))
                })
            });
            const json = await res.json().catch(() => null);
            if (json?.answer) return json.answer;
        } catch { /* ignore */ }
        return buildLocalAnswer(question);
    }

    function openBot() {
        els.bot.hidden = false;
        els.botToggle.setAttribute('aria-expanded', 'true');
        if (!els.botMessages.dataset.greeted) {
            botMsg('Hi! I can brief you on the headlines on screen and answer specific questions. Try “summarize” or “what’s new in Indian tech?”', 'ai');
            els.botMessages.dataset.greeted = '1';
        }
        els.botInput.focus();
    }

    function closeBot() {
        els.bot.hidden = true;
        els.botToggle.setAttribute('aria-expanded', 'false');
    }

    // One utterance at a time; `owner` is the button that started it.
    let speechOwner = null;
    let speechUtterance = null;

    function resetSpeechUi() {
        els.readBriefBtn.textContent = 'Listen';
        els.briefListenBtn.textContent = '▶ Listen';
        els.briefListenBtn.setAttribute('aria-pressed', 'false');
        els.briefCard.classList.remove('is-speaking');
        speechOwner = null;
    }

    function stopSpeaking() {
        speechUtterance = null;
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        resetSpeechUi();
    }

    function speak(text, owner) {
        if (!('speechSynthesis' in window)) { toast('Audio isn’t supported in this browser'); return; }
        const wasOwner = speechOwner === owner;
        stopSpeaking();
        if (wasOwner) return; // second press = stop
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.03;
        u.lang = state.prefs.lang === 'hi' ? 'hi-IN' : 'en-IN';
        // Only the current utterance may reset the UI (cancel() fires late errors).
        u.onend = u.onerror = () => { if (speechUtterance === u) { speechUtterance = null; resetSpeechUi(); } };
        // Set the playing UI first: some browsers fire `error` synchronously in speak().
        speechOwner = owner;
        speechUtterance = u;
        if (owner === els.briefListenBtn) {
            owner.textContent = '■ Stop';
            owner.setAttribute('aria-pressed', 'true');
            els.briefCard.classList.add('is-speaking');
        } else {
            owner.textContent = 'Stop';
        }
        speechSynthesis.speak(u);
    }

    function speakBrief() {
        const top = onScreen().slice(0, 5);
        const text = top.length ? `Here are your top headlines. ${top.map((a, i) => `${i + 1}. ${a.title}.`).join(' ')}` : 'No headlines loaded yet.';
        speak(text, els.readBriefBtn);
    }

    function speakDailyBrief() {
        const items = state.brief || [];
        if (!items.length) return;
        const intro = state.prefs.lang === 'hi' ? 'आज की पाँच बड़ी ख़बरें।' : `${briefGreeting().replace(/^\S+\s/, '')}. Five stories to know right now.`;
        speak(`${intro} ${items.map((it, i) => `${i + 1}. ${it.text}`).join(' ')}`, els.briefListenBtn);
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    function articleFrom(attr, el) {
        return state.byId.get(el.getAttribute(attr));
    }

    function bindEvents() {
        els.prefsBtn.addEventListener('click', openPrefs);

        els.regionIndia.addEventListener('click', () => navigate({ region: 'in' }));
        els.regionWorld.addEventListener('click', () => navigate({ region: 'world' }));

        els.categoryNav.addEventListener('click', (e) => {
            const btn = e.target.closest('.cat');
            if (btn) navigate({ view: btn.dataset.cat, query: '' });
        });

        els.searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const q = safeText(els.searchInput.value).slice(0, 100);
            navigate({ query: q, view: state.view === 'saved' ? 'foryou' : state.view });
            els.searchInput.blur();
        });

        els.brandLogo.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            navigate({ view: 'foryou', query: '', region: state.prefs.region });
        });

        els.refreshBtn.addEventListener('click', () => {
            els.refreshBtn.classList.remove('is-spinning');
            void els.refreshBtn.offsetWidth;
            els.refreshBtn.classList.add('is-spinning');
            clearFeedCache();
            refresh();
        });
        els.refreshBtn.addEventListener('animationend', () => els.refreshBtn.classList.remove('is-spinning'));
        els.searchForm.addEventListener('search-clear', () => { if (state.query) navigate({ query: '' }); });
        enableSheetDrag();
        els.loadMoreBtn.addEventListener('click', renderMore);
        els.newPill.addEventListener('click', applyPending);
        els.followQueryBtn.addEventListener('click', () => follow(state.query));

        window.addEventListener('popstate', () => {
            readUrl();
            syncControls();
            refresh();
        });

        // Image fallback without inline handlers (and without retry loops).
        document.addEventListener('error', (e) => {
            const img = e.target;
            if (img instanceof HTMLImageElement && !img.dataset.fb) {
                img.dataset.fb = '1';
                img.src = FALLBACK_IMG;
            }
        }, true);

        document.addEventListener('click', async (e) => {
            const t = e.target;

            const region = t.closest('[data-region]');
            if (region) { navigate({ region: region.dataset.region === 'world' ? 'world' : 'in' }); return; }

            const open = t.closest('[data-open]');
            if (open) {
                // Let Cmd/Ctrl/middle-click open the source in a new tab.
                if (open.tagName === 'A' && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
                const a = articleFrom('data-open', open);
                if (a) { e.preventDefault(); openStory(a, open); }
                return;
            }

            const save = t.closest('[data-save]');
            if (save) { const a = articleFrom('data-save', save); if (a) toggleSave(a, save); return; }

            const sh = t.closest('[data-share]');
            if (sh) { const a = articleFrom('data-share', sh); if (a) share(a); return; }

            const less = t.closest('[data-less]');
            if (less) {
                const a = articleFrom('data-less', less);
                if (a) { bump(a, -4); toast('Got it — fewer stories like this'); closeStory(); }
                return;
            }

            const mute = t.closest('[data-mute]');
            if (mute) {
                const a = articleFrom('data-mute', mute);
                if (a && !state.prefs.muted.includes(a.sourceName)) {
                    const ok = UI() ? await UI().confirm({ title: `Hide ${a.sourceName}?`, body: `You won’t see stories from ${a.sourceName} anymore. You can undo this in Personalize.`, confirmText: 'Hide source', from: mute }) : true;
                    if (!ok) return;
                    state.prefs.muted.push(a.sourceName);
                    store.set(STORE.prefs, state.prefs);
                    toast(`Hidden: ${a.sourceName}. Undo in Personalize.`);
                    closeStory();
                    refresh();
                }
                return;
            }

            if (t.closest('[data-close-sheet]')) { closeStory(); return; }

            const unf = t.closest('[data-unfollow]');
            if (unf) { unfollow(unf.getAttribute('data-unfollow')); return; }

            const dUnf = t.closest('[data-draft-unfollow]');
            if (dUnf) { draft.follows = draft.follows.filter(f => f !== dUnf.getAttribute('data-draft-unfollow')); renderDraftChips(); return; }

            const dUnm = t.closest('[data-draft-unmute]');
            if (dUnm) { draft.muted = draft.muted.filter(m => m !== dUnm.getAttribute('data-draft-unmute')); renderDraftChips(); return; }

            const action = t.closest('[data-action]')?.getAttribute('data-action');
            if (action === 'open-prefs') openPrefs();
            else if (action === 'dismiss-onboard') {
                state.prefs.dismissed = true;
                store.set(STORE.prefs, state.prefs);
                els.onboardCard.hidden = true;
            } else if (action === 'expand-brief') {
                els.briefCard.classList.add('is-expanded');
            } else if (action === 'dismiss-brief') {
                store.set(STORE.brief, { hidden: todayKey() });
                hideBrief();
                toast('Briefing hidden until tomorrow');
            } else if (action === 'retry') { clearFeedCache(); refresh(); }
            else if (action === 'go-saved') navigate({ view: 'saved', query: '' });
            else if (action === 'go-foryou') navigate({ view: 'foryou', query: '' });
            else if (action === 'clear-saved') {
                const ok = UI()
                    ? await UI().confirm({ title: 'Clear all saved stories?', body: `${state.saved.length} saved ${state.saved.length === 1 ? 'story' : 'stories'} will be removed from this device. This can’t be undone.`, confirmText: 'Clear all', danger: true, from: t.closest('button') })
                    : window.confirm('Clear all saved stories?');
                if (!ok) return;
                state.saved = [];
                store.set(STORE.saved, state.saved);
                updateSavedCount();
                refresh();
                toast('Saved stories cleared');
            } else if (action === 'print-page') {
                window.print();
            } else if (action === 'print-story') {
                document.body.classList.add('printing-story');
                window.addEventListener('afterprint', () => document.body.classList.remove('printing-story'), { once: true });
                window.print();
            }
        });

        // Clicking the dim backdrop closes the sheet.
        els.storySheet.addEventListener('click', (e) => {
            if (e.target !== els.storySheet) return;
            if (Date.now() - Number(els.storySheet.dataset.draggedAt || 0) < 400) return; // end of a drag, not a tap
            closeStory();
        });
        els.storySheet.addEventListener('close', () => {
            els.sheetContent.innerHTML = '';
            state.lastFocus?.focus?.();
        });

        // Preferences form
        els.followAddBtn.addEventListener('click', addDraftFollow);
        els.followInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addDraftFollow(); }
        });
        els.prefsForm.addEventListener('submit', (e) => {
            const submitter = e.submitter;
            if (!submitter || submitter.value !== 'save') return;
            draft.topics = [...els.topicPicker.querySelectorAll('input:checked')].map(i => i.value);
            draft.region = els.prefRegion.value === 'world' ? 'world' : 'in';
            draft.lang = els.prefLang.value === 'hi' ? 'hi' : 'en';
            if (safeText(els.followInput.value)) addDraftFollow();
            savePrefs(draft);
        });
        els.resetPrefsBtn.addEventListener('click', async () => {
            const ok = UI()
                ? await UI().confirm({ title: 'Reset personalization?', body: 'Your topics, followed keywords, hidden sources and reading history will be cleared. Saved stories stay.', confirmText: 'Reset', danger: true, from: els.resetPrefsBtn })
                : window.confirm('Reset topics, follows, hidden sources and reading history?');
            if (!ok) return;
            [STORE.prefs, STORE.signals, STORE.read].forEach(k => store.remove(k));
            state.prefs = defaultPrefs();
            state.signals = loadSignals();
            state.read = {};
            els.prefsDialog.close('cancel');
            navigate({ view: 'foryou', query: '', region: 'in' });
            toast('Personalization reset');
        });

        // Keyboard: "/" focuses search; Esc closes the assistant.
        document.addEventListener('keydown', (e) => {
            const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
            if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
                e.preventDefault();
                els.searchInput.focus();
            } else if (e.key === 'Escape' && !els.bot.hidden && !document.querySelector('dialog[open]')) {
                closeBot();
                els.botToggle.focus();
            }
        });

        els.botToggle.addEventListener('click', () => (els.bot.hidden ? openBot() : closeBot()));
        els.botClose.addEventListener('click', closeBot);
        els.botForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const q = safeText(els.botInput.value);
            if (!q) return;
            els.botInput.value = '';
            botMsg(q, 'user');
            const ph = botMsg('', 'ai');
            ph.classList.add('thinking');
            ph.innerHTML = loaderHtml('Thinking', { size: 'sm', inline: true, delay: false });
            const answer = await askBot(q);
            ph.classList.remove('thinking');
            ph.innerHTML = linkify(answer);
            els.botMessages.scrollTop = els.botMessages.scrollHeight;
        });
        els.readBriefBtn.addEventListener('click', speakBrief);
        els.briefListenBtn.addEventListener('click', speakDailyBrief);

        // Remember the visit time when the user leaves, for "since your last visit".
        const saveVisit = () => store.set(STORE.visit, { last: Date.now() });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') saveVisit();
            else if (state.view !== 'saved') {
                // Coming back to a stale tab: check quietly for new stories.
                const age = state.fetchedAt ? Date.now() - Date.parse(state.fetchedAt) : Infinity;
                if (age > AUTO_REFRESH_MS) { clearFeedCache(); refresh({ silent: true }); }
            }
        });
        window.addEventListener('pagehide', saveVisit);
    }

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------
    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return; // keep dev fresh
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ });
        });
    }

    function start() {
        const yearEl = $('currentYear');
        if (yearEl) yearEl.textContent = String(new Date().getFullYear());


        // Keep the sticky category bar right under the sticky header.
        const header = document.querySelector('.site-header');
        if (header && 'ResizeObserver' in window) {
            new ResizeObserver(() => {
                const sticky = getComputedStyle(header).position === 'sticky';
                document.documentElement.style.setProperty('--header-h', sticky ? `${header.offsetHeight}px` : '0px');
            }).observe(header);
        }

        readUrl();
        syncControls();
        writeUrl(true);
        updateSavedCount();
        bindEvents();
        refresh();
        scheduleAutoRefresh();
        setInterval(tickTimes, 60_000);
        registerServiceWorker();
    }

    start();
})();
