// Headline source shared by /api/news, /api/brief and /api/ingest.
//
// Read path (getHeadlines):
//   memo (5 min, per instance)
//   -> Supabase, if the ingest job refreshed this feed recently (has AI summaries)
//   -> live publisher RSS feeds (saved to Supabase as we go)
//   -> GNews (optional backup)
//   -> older Supabase rows (labelled as cached)
import { clamp, isHttpUrl } from './guard.js';
import { getRssHeadlines, feedKey, interleave } from './rss.js';
import { db, rpc, dbConfigured } from './db.js';

export const TOPICS = new Set(['general', 'technology', 'business', 'sports', 'health', 'science', 'entertainment', 'world', 'nation']);
export const LANGS = new Set(['en', 'hi']);

const memo = new Map();
const MEMO_MS = 5 * 60 * 1000;
// Stored feed counts as live if the ingest job touched it this recently.
const DB_FRESH_MS = 20 * 60 * 1000;
// Fewer than this from a source -> try the next one.
const MIN_ARTICLES = 5;

export function standardize(articles) {
    return (Array.isArray(articles) ? articles : [])
        .filter(a => a && a.title && isHttpUrl(a.url))
        .map(a => ({
            title: clamp(a.title, 300),
            description: clamp(a.description, 600),
            content: clamp(a.content, 1200),
            image: isHttpUrl(a.image) ? a.image : '',
            source: { name: clamp(a.source?.name, 80) || 'News' },
            url: a.url,
            publishedAt: a.publishedAt || null,
            summary: clamp(a.summary, 700)
        }));
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/**
 * Save stories and their feed membership. `groups` = [{ feed, articles }]
 * (feed may be null for search results: stored, but not listed in a feed).
 * Never overwrites existing AI summaries (summary is not in the payload).
 */
export async function saveArticles(groups, { timeoutMs = 1500 } = {}) {
    if (!dbConfigured()) return { stories: 0, links: 0 };
    const byUrl = new Map();
    const links = [];
    const now = new Date().toISOString();
    for (const { feed, articles } of groups) {
        for (const a of articles) {
            if (!byUrl.has(a.url)) {
                byUrl.set(a.url, {
                    title: a.title,
                    description: a.description || null,
                    content: a.content || null,
                    url: a.url,
                    image_url: a.image || null,
                    published_at: a.publishedAt || null,
                    source_name: a.source?.name || 'News'
                });
            }
            if (feed) links.push({ feed, url: a.url, published_at: a.publishedAt || null, seen_at: now });
        }
    }
    const stories = [...byUrl.values()];
    if (!stories.length) return { stories: 0, links: 0 };

    const upsert = (table, rows, conflict) => db(`${table}?on_conflict=${conflict}`, {
        method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal', timeoutMs
    });
    const s = await upsert('news_cache', stories, 'url');
    if (!s.ok) return { stories: 0, links: 0 };
    // Links reference news_cache(url), so they go second.
    const uniqLinks = [...new Map(links.map(l => [`${l.feed}\u0000${l.url}`, l])).values()];
    const l = uniqLinks.length ? await upsert('feed_items', uniqLinks, 'feed,url') : { ok: true };
    return { stories: stories.length, links: l.ok ? uniqLinks.length : 0 };
}

/** Stored stories for a feed, newest first, plus when the feed was last refreshed. */
async function readFeed(feed) {
    const r = await rpc('get_feed', { p_feed: feed, p_limit: 60 }, { timeoutMs: 2500 });
    if (!r.ok || !Array.isArray(r.data)) return { articles: [], seenAt: 0 };
    let seenAt = 0;
    const articles = standardize(r.data.map(row => {
        const t = Date.parse(row.seen_at);
        if (t > seenAt) seenAt = t;
        return {
            title: row.title,
            description: row.description,
            url: row.url,
            image: row.image_url,
            source: { name: row.source_name },
            publishedAt: row.published_at,
            summary: row.summary
        };
    }));
    return { articles, seenAt };
}

// Search fallback when Google News RSS is unavailable.
async function searchStored(q) {
    const term = q.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().slice(0, 60).replace(/\s+/g, '*');
    if (!term) return [];
    const params = new URLSearchParams({
        select: 'title,description,url,image_url,published_at,source_name,summary',
        or: `(title.ilike.*${term}*,description.ilike.*${term}*)`,
        order: 'published_at.desc.nullslast',
        limit: '30'
    });
    const r = await db(`news_cache?${params}`, { timeoutMs: 2500 });
    if (!r.ok || !Array.isArray(r.data)) return [];
    return standardize(r.data.map(row => ({ ...row, image: row.image_url, source: { name: row.source_name }, publishedAt: row.published_at })));
}

// ---------------------------------------------------------------------------
// GNews (optional backup)
// ---------------------------------------------------------------------------
async function fetchGNews(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (response.status === 429 && attempt === 0) {
            await new Promise(r => setTimeout(r, 1200));
            continue;
        }
        return response;
    }
}

async function fromGNews({ lang, country, topic, q }) {
    const apiKey = process.env.GNEWS_API_KEY;
    if (!apiKey) return [];
    const params = new URLSearchParams({ token: apiKey, lang, max: '10' });
    if (country) params.set('country', country);
    let url;
    if (q) {
        params.set('q', q);
        params.set('sortby', 'publishedAt');
        url = `https://gnews.io/api/v4/search?${params}`;
    } else {
        params.set('topic', topic);
        url = `https://gnews.io/api/v4/top-headlines?${params}`;
    }
    try {
        const response = await fetchGNews(url);
        if (response.ok) return standardize((await response.json()).articles);
        console.warn(`GNews error ${response.status}`);
    } catch (error) {
        console.warn('GNews request failed', error?.message);
    }
    return [];
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------
function remember(memoKey, body) {
    memo.set(memoKey, { ts: Date.now(), body });
    if (memo.size > 300) memo.delete(memo.keys().next().value);
    return body;
}

/**
 * Returns { articles, fetchedAt, cached, source } or null when nothing is available.
 * `cached: true` = older stored rows served because every live source failed.
 */
export async function getHeadlines({ lang = 'en', country = '', topic = 'general', q = '' }) {
    const feed = q ? null : feedKey({ lang, country, topic });
    const memoKey = q ? `${lang}|${country}|q:${q.toLowerCase()}` : feed;
    const hit = memo.get(memoKey);
    if (hit && Date.now() - hit.ts < MEMO_MS) return hit.body;

    // 1. Stored feed kept fresh by the ingest job (includes AI summaries).
    const stored = feed ? await readFeed(feed) : { articles: [], seenAt: 0 };
    if (stored.articles.length >= MIN_ARTICLES && Date.now() - stored.seenAt < DB_FRESH_MS) {
        return remember(memoKey, {
            articles: interleave(stored.articles, 30),
            fetchedAt: new Date(stored.seenAt).toISOString(),
            cached: false,
            source: 'db'
        });
    }

    // 2. Live feeds, then GNews.
    let articles = standardize(await getRssHeadlines({ lang, country, topic, q }));
    let source = 'rss';
    if (articles.length < MIN_ARTICLES) {
        const backup = await fromGNews({ lang, country, topic, q });
        if (backup.length > articles.length) { articles = backup; source = 'gnews'; }
    }

    if (articles.length) {
        // Reuse summaries we already have for these stories.
        const summaries = new Map(stored.articles.filter(a => a.summary).map(a => [a.url, a.summary]));
        articles.forEach(a => { if (!a.summary && summaries.has(a.url)) a.summary = summaries.get(a.url); });
        await saveArticles([{ feed, articles }]);
        return remember(memoKey, { articles, fetchedAt: new Date().toISOString(), cached: false, source });
    }

    // 3. Everything live failed: older stored rows, clearly labelled.
    const fallback = stored.articles.length ? interleave(stored.articles, 30) : q ? await searchStored(q) : [];
    if (fallback.length) return { articles: fallback, fetchedAt: null, cached: true, source: 'db-stale' };
    return null;
}
