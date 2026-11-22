import { rateLimit, clamp } from './_lib/guard.js';
import { getHeadlines, TOPICS, LANGS } from './_lib/headlines.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    if (!rateLimit(req, res, { key: 'news', limit: 60, windowMs: 60_000 })) {
        return res.status(429).json({ error: 'Too many requests', articles: [] });
    }

    const q = clamp(req.query?.q, 100);
    const category = clamp(req.query?.category, 20);
    const region = clamp(req.query?.country, 10);
    const lang = LANGS.has(req.query?.lang) ? req.query.lang : 'en';

    // "world" = no country filter (true global feed), not US.
    const country = region === 'in' ? 'in' : '';
    const topic = TOPICS.has(category) ? category : 'general';

    const result = await getHeadlines({ lang, country, topic, q });
    if (!result) {
        // Non-2xx so the client can fall back and label the feed as archived.
        return res.status(502).json({ error: 'News temporarily unavailable', articles: [] });
    }

    // Shared CDN cache: identical feeds across users cost one upstream call.
    // Fallback (cached) responses expire quickly so the live feed returns soon.
    res.setHeader('Cache-Control', result.cached
        ? 'public, s-maxage=60'
        : 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json(result);
}
