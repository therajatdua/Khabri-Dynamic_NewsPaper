(() => {
    const state = {
        region: 'in',
        category: 'general',
        query: '',
        articles: [],
        quickArticles: [],
        autoRefreshMs: 15 * 60 * 1000,
        refreshTimer: null
    };

    const els = {
        searchForm: document.getElementById('searchForm'),
        searchInput: document.getElementById('searchInput'),
        regionIndia: document.getElementById('regionIndia'),
        regionWorld: document.getElementById('regionWorld'),
        themeToggle: document.getElementById('themeToggle'),
        categoryNav: document.getElementById('categoryNav'),
        skeleton: document.getElementById('skeleton'),
        hero: document.getElementById('hero'),
        grid: document.getElementById('grid'),
        quick: document.getElementById('quick'),
        refreshBtn: document.getElementById('refreshBtn'),
        sectionTitle: document.getElementById('sectionTitle'),
        lastUpdated: document.getElementById('lastUpdated'),

        summaryModal: document.getElementById('summaryModal'),
        summaryStory: document.getElementById('summaryStory'),
        summaryText: document.getElementById('summaryText'),

        botToggle: document.getElementById('botToggle'),
        bot: document.getElementById('bot'),
        botClose: document.getElementById('botClose'),
        botMessages: document.getElementById('botMessages'),
        botForm: document.getElementById('botForm'),
        botInput: document.getElementById('botInput'),
        readBriefBtn: document.getElementById('readBriefBtn'),

        iframeModal: document.getElementById('iframeModal'),
        iframeTitle: document.getElementById('iframeTitle'),
        iframeExternalLink: document.getElementById('iframeExternalLink'),
        newsIframe: document.getElementById('newsIframe'),
        brandLogo: document.getElementById('brandLogo')
    };

    const FALLBACK_NEWSAPI_REGION = {
        in: 'in',
        world: 'us'
    };

    function safeText(value) {
        return (value || '').toString().trim();
    }

    function escapeHtml(str) {
        return safeText(str)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function formatTime(iso) {
        try {
            const date = new Date(iso);
            return date.toLocaleString(undefined, {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return '—';
        }
    }

    function normalizeArticle(raw) {
        const title = safeText(raw?.title);
        const url = safeText(raw?.url);
        const description = safeText(raw?.description);
        const content = safeText(raw?.content);
        const image = safeText(raw?.image || raw?.urlToImage);
        const publishedAt = safeText(raw?.publishedAt);
        const sourceName = safeText(raw?.source?.name || raw?.source_name || raw?.source || raw?.sourceName);

        return {
            id: url || `${title}-${publishedAt}`,
            title,
            url,
            description,
            content,
            image,
            publishedAt,
            sourceName: sourceName || 'News'
        };
    }

    function showLoading() {
        els.skeleton.hidden = false;
        els.hero.hidden = true;
        els.grid.hidden = true;
    }

    function showContent() {
        els.skeleton.hidden = true;
        els.hero.hidden = false;
        els.grid.hidden = false;
    }

    function setUpdatedNow() {
        const now = new Date();
        els.lastUpdated.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        els.lastUpdated.setAttribute('datetime', now.toISOString());
    }

    async function cleanupServiceWorkers() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        } catch {
            // ignore
        }
    }

    const THEME_STORAGE_KEY = 'khabri-newswala-theme';

    function getPreferredTheme() {
        let saved = '';
        try {
            saved = safeText(localStorage.getItem(THEME_STORAGE_KEY));
        } catch {
            saved = '';
        }
        if (saved === 'dark' || saved === 'light') return saved;

        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        if (els.themeToggle) {
            els.themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
            els.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
        }
    }

    function toggleTheme() {
        const current = document.documentElement.dataset.theme || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
            // ignore
        }
        applyTheme(next);
    }

    async function fetchNewsFromApi({ category, region, query }) {
        const cacheKey = `news_cache_${category}_${region}_${query}`;
        try {
            const cached = JSON.parse(sessionStorage.getItem(cacheKey));
            if (cached && cached.timestamp && (Date.now() - cached.timestamp < 15 * 60 * 1000)) {
                return cached.articles;
            }
        } catch { /* ignore */ }

        const qs = new URLSearchParams();
        if (category) qs.set('category', category);
        if (region) qs.set('country', region);
        if (query) qs.set('q', query);

        let finalArticles = [];

        try {
            const res = await fetch(`/api/news?${qs.toString()}`);
            if (!res.ok) throw new Error('api/news not available');
            const json = await res.json();
            const articles = Array.isArray(json) ? json : json.articles;
            if (!Array.isArray(articles)) throw new Error('Invalid /api/news response');
            finalArticles = articles.map(normalizeArticle).filter(a => a.title && a.url);
        } catch {
            const country = region === 'in' ? FALLBACK_NEWSAPI_REGION.in : FALLBACK_NEWSAPI_REGION.world;
            const url = `https://saurav.tech/NewsAPI/top-headlines/category/${encodeURIComponent(category)}/${encodeURIComponent(country)}.json`;
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error('Static fallback failed');
                const json = await res.json();
                let articles = (json.articles || []).map(normalizeArticle).filter(a => a.title && a.url);
                if (query) {
                    const qLower = query.toLowerCase();
                    articles = articles.filter(a => 
                        a.title.toLowerCase().includes(qLower) || 
                        a.description.toLowerCase().includes(qLower)
                    );
                }
                finalArticles = articles;
            } catch {
                finalArticles = [];
            }
        }

        if (finalArticles.length > 0) {
            try {
                sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), articles: finalArticles }));
            } catch { /* ignore */ }
        }

        return finalArticles;
    }

    function pickHero(articles) {
        const withImage = articles.filter(a => a.image);
        return withImage[0] || articles[0] || null;
    }

    function localTwoSentenceSummary(article) {
        const base = safeText(article.description || article.content || article.title);
        const sentences = base.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
        const first = sentences[0] || article.title;
        const second = sentences[1] || (sentences[0] ? '' : base);
        const combined = [first, second].filter(Boolean).join(' ');
        return combined.length ? combined : article.title;
    }

    async function getAiSummary(article) {
        try {
            const res = await fetch('/api/summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: article.title,
                    description: article.description,
                    content: article.content,
                    url: article.url
                })
            });
            if (!res.ok) throw new Error('summary failed');
            const json = await res.json();
            if (json?.summary) return json.summary;
        } catch {
            // ignore
        }

        return localTwoSentenceSummary(article);
    }

    function renderHero(article) {
        const published = article.publishedAt ? formatTime(article.publishedAt) : '—';
        const desc = article.description || article.content || '';
        const img = article.image || 'https://via.placeholder.com/1200x700?text=Khabri-NewsWala';

        els.hero.innerHTML = `
            <div class="hero-img-wrapper">
                <img class="hero-img" src="${img}" alt="" loading="lazy" onerror="this.src='https://via.placeholder.com/1200x700?text=Khabri-NewsWala'" data-action="open-iframe" data-url="${article.url}" data-title="${escapeHtml(article.title)}" style="cursor:pointer;" />
            </div>
            <div class="hero-body">
                <div class="meta">
                    <span class="source">${escapeHtml(article.sourceName)}</span>
                    <span>•</span>
                    <span>${escapeHtml(published)}</span>
                </div>
                <h1 class="hero-title"><a href="${article.url}" data-action="open-iframe" data-title="${escapeHtml(article.title)}" onclick="event.preventDefault()">${escapeHtml(article.title)}</a></h1>
                <p class="hero-desc">${escapeHtml(desc)}</p>
                <div class="hero-actions">
                    <button class="btn subtle" type="button" data-action="open-iframe" data-url="${article.url}" data-title="${escapeHtml(article.title)}">Read</button>
                    <button class="btn" type="button" data-action="summarize" data-id="${article.id}">Summarize</button>
                </div>
            </div>
        `;
    }

    function renderGrid(articles) {
        els.grid.innerHTML = articles.map(a => {
            const published = a.publishedAt ? formatTime(a.publishedAt) : '—';
            const desc = a.description || a.content || '';
            const img = a.image || 'https://via.placeholder.com/800x500?text=Khabri-NewsWala';
            return `
                <article class="card" data-action="open-iframe" data-url="${a.url}" data-title="${escapeHtml(a.title)}">
                    <div class="card-img-wrapper">
                        <img class="card-img" src="${img}" alt="" loading="lazy" onerror="this.src='https://via.placeholder.com/800x500?text=Khabri-NewsWala'" />
                    </div>
                    <div class="card-body">
                        <div class="meta">
                            <span class="source">${escapeHtml(a.sourceName)}</span>
                            <span>•</span>
                            <span>${escapeHtml(published)}</span>
                        </div>
                        <h3 class="card-title"><a href="${a.url}" data-action="open-iframe" data-title="${escapeHtml(a.title)}" onclick="event.preventDefault()">${escapeHtml(a.title)}</a></h3>
                        <p class="card-desc">${escapeHtml(desc)}</p>
                        <div class="card-actions">
                            <button class="btn subtle" type="button" data-action="summarize" data-id="${a.id}">Summarize</button>
                            <button class="btn subtle" type="button" data-action="open-iframe" data-url="${a.url}" data-title="${escapeHtml(a.title)}">Open</button>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderQuick(articles) {
        if (!state.query && state.category === 'general') {
            state.quickArticles = articles.slice(0, 10);
        }
        const quick = state.quickArticles.length ? state.quickArticles : articles.slice(0, 10);
        els.quick.innerHTML = quick.map(a => {
            return `<li><a href="${a.url}" data-action="open-iframe" data-title="${escapeHtml(a.title)}" onclick="event.preventDefault()">${escapeHtml(a.title)}</a></li>`;
        }).join('');
    }

    function openSummaryModal(article) {
        els.summaryModal.classList.add('is-open');
        els.summaryModal.setAttribute('aria-hidden', 'false');
        els.summaryStory.textContent = `${article.sourceName} • ${article.publishedAt ? formatTime(article.publishedAt) : '—'}`;
        els.summaryText.textContent = 'Loading...';

        getAiSummary(article)
            .then(summary => {
                if (typeof summary === 'string' && summary.includes('<')) {
                    els.summaryText.innerHTML = summary;
                } else {
                    els.summaryText.textContent = summary;
                }
            })
            .catch(() => {
                els.summaryText.textContent = localTwoSentenceSummary(article);
            });
    }

    function closeSummaryModal() {
        els.summaryModal.classList.remove('is-open');
        els.summaryModal.setAttribute('aria-hidden', 'true');
    }

    function botMsg(textHtml, who) {
        const div = document.createElement('div');
        div.className = `msg ${who}`;
        div.innerHTML = textHtml;
        els.botMessages.appendChild(div);
        els.botMessages.scrollTop = els.botMessages.scrollHeight;
    }

    function buildLocalAnswer(question) {
        const q = safeText(question).toLowerCase();
        const tokens = q.split(/\W+/).filter(t => t.length >= 2);

        const scored = state.articles
            .map(a => {
                const hay = `${a.title} ${a.description} ${a.sourceName}`.toLowerCase();
                let score = 0;
                for (const t of tokens) {
                    if (hay.includes(t)) score += 1;
                }
                return { a, score };
            })
            .sort((x, y) => y.score - x.score);

        const top = scored.filter(s => s.score > 0).slice(0, 3).map(s => s.a);

        if (q.includes('summar') || q.includes('brief') || q.includes('top') || q.includes('latest')) {
            const items = state.articles.slice(0, 5);
            return `Here’s the quick brief:\n\n${items.map((a, i) => `${i + 1}. ${a.title}`).join('\n')}\n\nAsk “details about #2” or paste a keyword.`;
        }

        if (top.length === 0) {
            return `I couldn’t match that to today’s loaded headlines. Try: “summarize”, “latest tech in India”, or switch category first.`;
        }

        return `Most relevant stories right now:\n\n${top.map((a, i) => `${i + 1}. ${a.title}\n${a.url}`).join('\n\n')}\n\nTell me which one you want details on (e.g., “details about 1”).`;
    }

    async function askBot(question) {
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question,
                    articles: state.articles.slice(0, 12).map(a => ({
                        title: a.title,
                        description: a.description,
                        url: a.url,
                        source: a.sourceName,
                        publishedAt: a.publishedAt
                    }))
                })
            });
            if (!res.ok) throw new Error('chat failed');
            const json = await res.json();
            if (json?.answer) return json.answer;
        } catch {
            // ignore
        }

        return buildLocalAnswer(question);
    }

    function toHtmlLines(text) {
        return escapeHtml(text).replaceAll('\n', '<br>');
    }

    async function refresh({ silent } = { silent: false }) {
        if (!silent) showLoading();

        let articles = [];
        try {
            articles = await fetchNewsFromApi({
                category: state.category,
                region: state.region,
                query: state.query
            });
        } catch {
            articles = [];
        }

        state.articles = articles;
        setUpdatedNow();

        const hero = pickHero(articles);
        if (!hero) {
            els.hero.hidden = false;
            const title = state.query ? 'No stories found' : 'Unable to load news';
            const desc = state.query
                ? 'Try a different category or clear search.'
                : 'Check your internet connection, or set GNEWS_API_KEY to enable server mode.';
            els.hero.innerHTML = `<div class="hero-body"><div class="meta"><span class="source">Khabri -NewsWala</span></div><h1 class="hero-title">${escapeHtml(title)}</h1><p class="hero-desc">${escapeHtml(desc)}</p></div>`;
            els.grid.innerHTML = '';
            renderQuick([]);
            showContent();
            return;
        }

        const rest = articles.filter(a => a.id !== hero.id).slice(0, 12);
        renderHero(hero);
        renderGrid(rest);
        renderQuick(articles);
        showContent();
    }

    function setRegion(next) {
        state.region = next;
        els.regionIndia.classList.toggle('is-active', next === 'in');
        els.regionWorld.classList.toggle('is-active', next !== 'in');
    }

    function setCategory(next) {
        state.category = next;
        [...els.categoryNav.querySelectorAll('.cat')].forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.cat === next);
        });
        els.sectionTitle.textContent = state.query ? 'Results' : 'Latest';
    }

    function openBot() {
        els.bot.hidden = false;
        if (!els.botMessages.dataset.greeted) {
            botMsg(
                'Hi — I can summarize any story and answer specific questions using the current headlines. Try: <b>“summarize”</b> or <b>“what’s new in Indian tech?”</b>.',
                'ai'
            );
            els.botMessages.dataset.greeted = '1';
        }
    }

    function closeBot() {
        els.bot.hidden = true;
    }

    function speak(text) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.03;
        window.speechSynthesis.speak(u);
    }

    function bindEvents() {
        if (els.themeToggle) {
            els.themeToggle.addEventListener('click', toggleTheme);
        }

        els.regionIndia.addEventListener('click', async () => {
            setRegion('in');
            state.query = '';
            els.searchInput.value = '';
            await refresh();
        });
        els.regionWorld.addEventListener('click', async () => {
            setRegion('world');
            state.query = '';
            els.searchInput.value = '';
            await refresh();
        });

        els.categoryNav.addEventListener('click', async (e) => {
            const btn = e.target.closest('.cat');
            if (!btn) return;
            setCategory(btn.dataset.cat);
            state.query = '';
            els.searchInput.value = '';
            await refresh();
        });

        els.searchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const q = safeText(els.searchInput.value);
            state.query = q;
            els.sectionTitle.textContent = q ? 'Results' : 'Latest';
            await refresh();

            if (q && state.articles.length === 0) {
                els.hero.hidden = false;
                els.hero.innerHTML = `<div class="hero-body"><div class="meta"><span class="source">Search</span></div><h1 class="hero-title">Search needs server mode</h1><p class="hero-desc">Search works on Vercel via <code>/api/news</code>. In local static mode, you can search only within loaded headlines.</p></div>`;
            }
        });

        els.refreshBtn.addEventListener('click', () => refresh());
        
        if (els.brandLogo) {
            els.brandLogo.addEventListener('click', async () => {
                setRegion('in');
                setCategory('general');
                state.query = '';
                els.searchInput.value = '';
                await refresh();
            });
        }

        document.addEventListener('click', (e) => {
            const close = e.target.closest('[data-close="true"]');
            if (close) closeSummaryModal();
            
            const closeIframe = e.target.closest('[data-close-iframe="true"]');
            if (closeIframe) {
                els.iframeModal.classList.remove('is-open');
                els.iframeModal.setAttribute('aria-hidden', 'true');
                els.newsIframe.src = 'about:blank';
            }

            const iframeAction = e.target.closest('[data-action="open-iframe"]');
            if (iframeAction) {
                const targetUrl = iframeAction.getAttribute('data-url') || iframeAction.getAttribute('href');
                const title = iframeAction.getAttribute('data-title') || 'Full News';
                if (targetUrl) {
                    els.iframeTitle.textContent = title;
                    els.iframeExternalLink.href = targetUrl;
                    els.newsIframe.src = targetUrl;
                    els.iframeModal.classList.add('is-open');
                    els.iframeModal.setAttribute('aria-hidden', 'false');
                }
            }

            const summarizeBtn = e.target.closest('[data-action="summarize"]');
            if (summarizeBtn) {
                e.stopPropagation();
                const id = summarizeBtn.getAttribute('data-id');
                const article = state.articles.find(a => a.id === id);
                if (article) openSummaryModal(article);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeSummaryModal();
                closeBot();
                if (els.iframeModal && els.iframeModal.classList.contains('is-open')) {
                    els.iframeModal.classList.remove('is-open');
                    els.iframeModal.setAttribute('aria-hidden', 'true');
                    els.newsIframe.src = 'about:blank';
                }
            }
        });

        els.botToggle.addEventListener('click', () => {
            if (els.bot.hidden) openBot();
            else closeBot();
        });
        els.botClose.addEventListener('click', closeBot);

        els.botForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const q = safeText(els.botInput.value);
            if (!q) return;
            els.botInput.value = '';
            botMsg(escapeHtml(q), 'user');

            const placeholderId = `p-${Math.random().toString(36).slice(2)}`;
            const ph = document.createElement('div');
            ph.className = 'msg ai';
            ph.id = placeholderId;
            ph.textContent = 'Thinking...';
            els.botMessages.appendChild(ph);
            els.botMessages.scrollTop = els.botMessages.scrollHeight;

            const answer = await askBot(q);
            const node = document.getElementById(placeholderId);
            if (node) node.innerHTML = toHtmlLines(answer);
        });

        els.readBriefBtn.addEventListener('click', () => {
            if (window.speechSynthesis && window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
                els.readBriefBtn.textContent = 'Listen';
                return;
            }
            
            const top = state.articles.slice(0, 5);
            const brief = top.length
                ? `Here are the top headlines: ${top.map((a, i) => `${i + 1}. ${a.title}`).join(' ')}.`
                : 'No headlines loaded yet.';
            speak(brief);
            els.readBriefBtn.textContent = 'Stop';
            
            // Revert text if possible (using a timeout rough estimate or interval, since utterance events can be unreliable across browsers)
            const checkEnd = setInterval(() => {
                if (!window.speechSynthesis.speaking) {
                    els.readBriefBtn.textContent = 'Listen';
                    clearInterval(checkEnd);
                }
            }, 1000);
        });
    }

    async function start() {
        applyTheme(getPreferredTheme());
        await cleanupServiceWorkers();
        bindEvents();
        setRegion('in');
        setCategory('general');
        showLoading();
        await refresh();

        if (state.refreshTimer) clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(() => refresh({ silent: true }), state.autoRefreshMs);
    }

    start();
})();
