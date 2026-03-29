const TOPIC_BY_CATEGORY = {
    general: 'general',
    technology: 'technology',
    business: 'business',
    sports: 'sports',
    health: 'health',
    science: 'science',
    entertainment: 'entertainment'
};

async function upsertNewsCacheToSupabase(articles) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
    if (!Array.isArray(articles) || articles.length === 0) return;

    const rows = articles
        .filter(a => a?.title && a?.url)
        .map(a => ({
            title: a.title,
            description: a.description || null,
            content: a.content || null,
            url: a.url,
            image_url: a.image || null,
            published_at: a.publishedAt || null,
            source_name: a?.source?.name || 'News'
        }));

    if (rows.length === 0) return;

    const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/news_cache?on_conflict=url`;

    // Best-effort cache write; ignore errors.
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                Prefer: 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(rows)
        });

        if (!res.ok) {
            // Swallow error; caching should not break news.
            return;
        }
    } catch {
        return;
    }
}

export default async function handler(req, res) {
    const { q, category = 'general', country = 'in' } = req.query;
    const GNEWS_API_KEY = process.env.GNEWS_API_KEY;

    if (!GNEWS_API_KEY) {
        // Return a non-2xx so the client can fall back to the no-key headlines feed.
        // (Search requires server mode, so the client will display an empty result set.)
        return res.status(503).json({
            error: 'Server mode not configured: missing GNEWS_API_KEY',
            articles: []
        });
    }

    const normalizedCountry = (country === 'in' ? 'in' : 'us');
    const topic = TOPIC_BY_CATEGORY[category] || 'general';

    try {
        const url = q
            ? `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&token=${GNEWS_API_KEY}&lang=en&country=${normalizedCountry}&max=20&sortby=publishedAt`
            : `https://gnews.io/api/v4/top-headlines?token=${GNEWS_API_KEY}&lang=en&country=${normalizedCountry}&topic=${encodeURIComponent(topic)}&max=20`;

        const response = await fetch(url);
        if (!response.ok) {
            return res.status(502).json({ error: `GNews error: ${response.status}` });
        }

        const data = await response.json();
        const articles = Array.isArray(data.articles) ? data.articles : [];

        const standardized = articles
            .filter(a => a && a.title && a.url)
            .map(a => ({
                title: a.title,
                description: a.description || '',
                content: a.content || '',
                image: a.image || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&h=700&fit=crop',
                source: a.source || { name: 'News' },
                url: a.url,
                publishedAt: a.publishedAt || new Date().toISOString()
            }));

        await upsertNewsCacheToSupabase(standardized);

        return res.status(200).json({ articles: standardized });
    } catch (error) {
        return res.status(500).json({ error: error?.message || 'Unknown error' });
    }
}
