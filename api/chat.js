export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const { question, articles, context } = req.body || {};

    const q = (question || '').toString().trim();
    if (!q) return res.status(400).json({ answer: 'Missing question.' });

    const safeText = (v) => (v ?? '').toString().trim();

    const normalizedArticles = Array.isArray(articles)
        ? articles
            .map((a) => ({
                title: safeText(a?.title),
                description: safeText(a?.description),
                url: safeText(a?.url),
                source: safeText(a?.source || a?.sourceName || a?.source_name || 'News'),
                publishedAt: safeText(a?.publishedAt)
            }))
            .filter((a) => a.title && a.url)
        : [];

    const linesFromArticles = normalizedArticles
        .slice(0, 12)
        .map((a, i) => {
            const date = a.publishedAt ? ` — ${a.publishedAt}` : '';
            const descLine = a.description ? `\n${a.description}` : '';
            return `${i + 1}. ${a.title} (${a.source}${date})${descLine}\n${a.url}`;
        })
        .join('\n\n');

    const ctx = (context || '').toString().trim();
    const newsContext = [linesFromArticles, ctx].filter(Boolean).join('\n\n');

    const fallbackFromHeadlines = () => {
        const items = normalizedArticles.slice(0, 8);
        if (items.length === 0) {
            return `AI is temporarily unavailable, and I don't have headlines loaded yet.\n\nTry switching category/region or refresh to load headlines first.`;
        }

        const list = items
            .map((a, i) => `${i + 1}. ${a.title} (${a.source})\n${a.url}`)
            .join('\n\n');

        return `I can answer based on the headlines loaded on this page, but AI is temporarily unavailable.\n\nLatest headlines:\n\n${list}\n\nAsk: "summarize #2" or "details about #3".`;
    };

    const getArticleByIndex = (idx1Based) => {
        const i = Number(idx1Based) - 1;
        if (!Number.isFinite(i) || i < 0) return null;
        return normalizedArticles[i] || null;
    };

    const referenced = (() => {
        const m = q.match(/(?:^|\s)(?:#|no\.|number\s*)?(\d{1,2})(?:\s|$)/i);
        if (!m) return null;
        const n = Number.parseInt(m[1], 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
    })();

    const wantsRecentBrief = /\b(last\s*24\s*h|last\s*24h|today|latest\s+headlines|top\s+headlines|headlines)\b/i.test(q);

    const now = Date.now();
    const withinLast24h = (iso) => {
        if (!iso) return true;
        const t = Date.parse(iso);
        if (!Number.isFinite(t)) return true;
        return (now - t) <= (24 * 60 * 60 * 1000);
    };

    if (wantsRecentBrief) {
        const items = normalizedArticles.filter(a => withinLast24h(a.publishedAt)).slice(0, 8);
        if (items.length === 0) {
            return res.status(200).json({ answer: fallbackFromHeadlines() });
        }
        const list = items.map((a, i) => `${i + 1}. ${a.title} (${a.source})\n${a.url}`).join('\n\n');
        return res.status(200).json({
            answer: `Here are the most recent headlines I have loaded (up to ~last 24h when timestamps are available):\n\n${list}`
        });
    }

    if (referenced) {
        const a = getArticleByIndex(referenced);
        if (a) {
            const desc = a.description ? `\n${a.description}` : '';
            return res.status(200).json({
                answer: `#${referenced}: ${a.title}\n${a.source}${desc}\n${a.url}`
            });
        }
    }

    const keywordRankedHeadlines = () => {
        const items = normalizedArticles.slice(0, 12);
        if (items.length === 0) return null;

        const stop = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'from', 'at', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'these', 'those', 'as',
            'today', 'latest', 'headlines', 'news', 'india', 'world', 'last', 'hours', 'hour', '24h', '24'
        ]);

        const words = q
            .toLowerCase()
            .replace(/[^a-z0-9\s#]/g, ' ')
            .split(/\s+/)
            .map(w => w.trim())
            .filter(w => w.length >= 3 && !stop.has(w));

        if (words.length === 0) return items.slice(0, 5);

        const score = (a) => {
            const hay = `${a.title} ${a.description}`.toLowerCase();
            let s = 0;
            for (const w of words) {
                if (hay.includes(w)) s += 1;
            }
            return s;
        };

        const ranked = items
            .map((a, i) => ({ a, i, s: score(a) }))
            .sort((x, y) => y.s - x.s)
            .filter(x => x.s > 0);

        if (ranked.length === 0) return items.slice(0, 5);
        return ranked.slice(0, 5).map(x => x.a);
    };

    if (!GROQ_API_KEY) {
        const picks = keywordRankedHeadlines();
        if (!picks || picks.length === 0) {
            return res.status(200).json({
                answer: `I can answer from loaded headlines, but none are available yet.\n\nTry refresh or switch category/region to load headlines.`
            });
        }

        const list = picks
            .map((a, i) => `${i + 1}. ${a.title} (${a.source})\n${a.url}`)
            .join('\n\n');

        return res.status(200).json({
            answer: `Based on the headlines currently loaded on this page, the most relevant items are:\n\n${list}\n\nIf you want a deeper AI-written answer, set GROQ_API_KEY.`
        });
    }

    const prompt = `HEADLINES (numbered):\n${newsContext || '(no headlines/context provided)'}\n\nUSER QUESTION:\n${q}`;

    const modelCandidates = [
        safeText(process.env.GROQ_MODEL),
        'llama-3.3-70b-versatile',
        'llama-3.1-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768'
    ].filter(Boolean);

    const uniqueModels = [...new Set(modelCandidates)];

    const callGroq = async (model) => {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                temperature: 0.1,
                max_tokens: 320,
                messages: [
                    {
                        role: 'system',
                        content: [
                            'You are Khabri -NewsWala AI.',
                            'Answer using ONLY the provided headlines/context. Do not use outside knowledge.',
                            'Be concise and on-point (<= 6 lines).',
                            'If you cannot answer from the headlines, say so and suggest what to open/refresh.',
                            'When referencing a headline, cite it like [1] and include the URL on a new line if useful.',
                            'Never mention model names, providers, or internal errors.'
                        ].join(' ')
                    },
                    { role: 'user', content: prompt }
                ]
            })
        });

        let data;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {
            const msg = safeText(data?.error?.message) || `HTTP ${response.status}`;
            const retryableModelIssue = /decommissioned|model|not\s+supported|does\s+not\s+exist/i.test(msg);
            return { ok: false, retryableModelIssue, msg };
        }

        const answer = safeText(data?.choices?.[0]?.message?.content);
        if (!answer) return { ok: false, retryableModelIssue: false, msg: 'empty' };
        return { ok: true, answer };
    };

    try {
        for (const model of uniqueModels) {
            const out = await callGroq(model);
            if (out.ok) return res.status(200).json({ answer: out.answer });
            if (!out.retryableModelIssue) break;
            // eslint-disable-next-line no-console
            console.warn(`Groq chat failed for model ${model}: ${out.msg}`);
        }

        return res.status(200).json({ answer: fallbackFromHeadlines() });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Groq chat connection error', e);
        return res.status(200).json({ answer: fallbackFromHeadlines() });
    }
}
