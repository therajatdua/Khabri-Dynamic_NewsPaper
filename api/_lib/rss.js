// Publisher RSS feeds: free, keyless, real-time headlines.
// Each feed is fetched at most once per FEED_TTL per server instance and
// shared across every topic that lists it.
import { clamp, isHttpUrl } from './guard.js';

const UA = 'Mozilla/5.0 (compatible; KhabriNewsBot/1.0)';
const FEED_TTL = 5 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const PER_FEED = 15;

const gnTopic = (topic, lang) => lang === 'hi'
    ? `https://news.google.com/rss/headlines/section/topic/${topic}?hl=hi&gl=IN&ceid=IN:hi`
    : `https://news.google.com/rss/headlines/section/topic/${topic}?hl=en-IN&gl=IN&ceid=IN:en`;

const F = {
    hinduNational: 'https://www.thehindu.com/news/national/feeder/default.rss',
    hinduIntl: 'https://www.thehindu.com/news/international/feeder/default.rss',
    hinduBusiness: 'https://www.thehindu.com/business/feeder/default.rss',
    hinduSport: 'https://www.thehindu.com/sport/feeder/default.rss',
    hinduTech: 'https://www.thehindu.com/sci-tech/technology/feeder/default.rss',
    hinduScience: 'https://www.thehindu.com/sci-tech/science/feeder/default.rss',
    hinduHealth: 'https://www.thehindu.com/sci-tech/health/feeder/default.rss',
    hinduEnt: 'https://www.thehindu.com/entertainment/feeder/default.rss',
    ieIndia: 'https://indianexpress.com/section/india/feed/',
    ieBusiness: 'https://indianexpress.com/section/business/feed/',
    ieSports: 'https://indianexpress.com/section/sports/feed/',
    ieTech: 'https://indianexpress.com/section/technology/feed/',
    ieHealth: 'https://indianexpress.com/section/lifestyle/health/feed/',
    ieEnt: 'https://indianexpress.com/section/entertainment/feed/',
    ieWorld: 'https://indianexpress.com/section/world/feed/',
    ndtvTop: 'https://feeds.feedburner.com/ndtvnews-top-stories',
    ndtvIndia: 'https://feeds.feedburner.com/ndtvnews-india-news',
    ndtvSports: 'https://feeds.feedburner.com/ndtvsports-latest',
    gadgets360: 'https://feeds.feedburner.com/gadgets360-latest',
    toiIndia: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
    toiBusiness: 'https://timesofindia.indiatimes.com/rssfeeds/1898055.cms',
    toiSports: 'https://timesofindia.indiatimes.com/rssfeeds/4719148.cms',
    toiEnt: 'https://timesofindia.indiatimes.com/rssfeeds/1081479906.cms',
    toiWorld: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms',
    toiScience: 'https://timesofindia.indiatimes.com/rssfeeds/-2128672765.cms',
    mintNews: 'https://www.livemint.com/rss/news',
    mintTech: 'https://www.livemint.com/rss/technology',
    mintMarkets: 'https://www.livemint.com/rss/markets',
    bbcTop: 'https://feeds.bbci.co.uk/news/rss.xml',
    bbcWorld: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    bbcTech: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    bbcBusiness: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    bbcHealth: 'https://feeds.bbci.co.uk/news/health/rss.xml',
    bbcScience: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    bbcEnt: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
    bbcSport: 'https://feeds.bbci.co.uk/sport/rss.xml',
    aljazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
    guardianWorld: 'https://www.theguardian.com/world/rss',
    guardianTech: 'https://www.theguardian.com/technology/rss',
    guardianBusiness: 'https://www.theguardian.com/business/rss',
    guardianSport: 'https://www.theguardian.com/sport/rss',
    guardianScience: 'https://www.theguardian.com/science/rss',
    guardianHealth: 'https://www.theguardian.com/society/health/rss',
    guardianCulture: 'https://www.theguardian.com/culture/rss',
    nprTop: 'https://feeds.npr.org/1001/rss.xml',
    bbcHindi: 'https://feeds.bbci.co.uk/hindi/rss.xml',
    ndtvKhabar: 'https://feeds.feedburner.com/ndtvkhabar-latest',
    amarUjala: 'https://www.amarujala.com/rss/breaking-news.xml'
};

// Feed name -> display name, for feeds whose <channel> title is noisy.
const SOURCE_NAMES = {
    hindu: 'The Hindu', ie: 'The Indian Express', ndtv: 'NDTV', gadgets360: 'Gadgets 360',
    toi: 'The Times of India', mint: 'Mint', bbcHindi: 'BBC Hindi', bbc: 'BBC News',
    aljazeera: 'Al Jazeera', guardian: 'The Guardian', npr: 'NPR', ndtvKhabar: 'NDTV India', amarUjala: 'Amar Ujala'
};

const INDIA = {
    general: ['ndtvTop', 'toiIndia', 'hinduNational', 'ieIndia', 'mintNews'],
    nation: ['toiIndia', 'ndtvIndia', 'hinduNational', 'ieIndia'],
    world: ['ieWorld', 'hinduIntl', 'toiWorld', 'bbcWorld'],
    business: ['ieBusiness', 'hinduBusiness', 'toiBusiness', 'mintMarkets'],
    technology: ['gadgets360', 'ieTech', 'hinduTech', 'mintTech'],
    sports: ['ndtvSports', 'ieSports', 'hinduSport', 'toiSports'],
    health: ['ieHealth', 'hinduHealth', 'bbcHealth'],
    science: ['hinduScience', 'toiScience', 'bbcScience'],
    entertainment: ['ieEnt', 'hinduEnt', 'toiEnt']
};

const GLOBAL = {
    general: ['bbcTop', 'guardianWorld', 'aljazeera', 'nprTop'],
    nation: ['bbcTop', 'guardianWorld', 'aljazeera', 'nprTop'],
    world: ['bbcWorld', 'guardianWorld', 'aljazeera'],
    business: ['bbcBusiness', 'guardianBusiness'],
    technology: ['guardianTech', 'bbcTech'],
    sports: ['bbcSport', 'guardianSport'],
    health: ['guardianHealth', 'bbcHealth'],
    science: ['guardianScience', 'bbcScience'],
    entertainment: ['bbcEnt', 'guardianCulture']
};

const HINDI_GENERAL = ['bbcHindi', 'ndtvKhabar', 'amarUjala'];
const GN_TOPICS = {
    nation: 'NATION', world: 'WORLD', business: 'BUSINESS', technology: 'TECHNOLOGY',
    sports: 'SPORTS', health: 'HEALTH', science: 'SCIENCE', entertainment: 'ENTERTAINMENT'
};

/** Returns [{ name, url }] for a feed request. */
export function feedsFor({ lang, country, topic }) {
    if (lang === 'hi') {
        if (topic === 'general') return HINDI_GENERAL.map(name => ({ name, url: F[name] }));
        return [{ name: 'google', url: gnTopic(GN_TOPICS[topic] || 'NATION', 'hi') }];
    }
    const table = country === 'in' ? INDIA : GLOBAL;
    return (table[topic] || table.general).map(name => ({ name, url: F[name] }));
}

// Google News "Top stories": ranked by importance across thousands of outlets.
export function topStoriesFeed({ lang, country }) {
    const ed = lang === 'hi' ? 'hl=hi&gl=IN&ceid=IN:hi'
        : country === 'in' ? 'hl=en-IN&gl=IN&ceid=IN:en' : 'hl=en-US&gl=US&ceid=US:en';
    return { name: 'google', url: `https://news.google.com/rss?${ed}` };
}

/** Top-stories headlines in Google's ranked order (titles only), or [] on failure. */
export async function getTopStoryTitles({ lang, country }) {
    return (await loadFeed(topStoriesFeed({ lang, country }))).map(a => a.title);
}

export function searchFeed({ lang, country, q }) {
    const ed = lang === 'hi' ? 'hl=hi&gl=IN&ceid=IN:hi'
        : country === 'in' ? 'hl=en-IN&gl=IN&ceid=IN:en' : 'hl=en-US&gl=US&ceid=US:en';
    return { name: 'google', url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&${ed}` };
}

// ---------------------------------------------------------------------------
// Parsing (RSS 2.0 + Atom, no dependencies)
// ---------------------------------------------------------------------------
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
            const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
        }
        return NAMED[e.toLowerCase()] ?? m;
    });
}

// Text of the first <tag>…</tag>, with CDATA unwrapped and entities decoded.
function text(block, tag) {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!m) return '';
    let v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    // Some feeds double-encode HTML inside descriptions.
    v = decode(v);
    return v;
}

function plain(html) {
    return decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attr(tagHtml, name) {
    const m = tagHtml.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return m ? decode(m[1]) : '';
}

function pickImage(block, descHtml) {
    let best = '';
    let bestW = -1;
    for (const tag of block.match(/<media:(?:content|thumbnail)\b[^>]*>/gi) || []) {
        const url = attr(tag, 'url');
        const medium = attr(tag, 'medium');
        const type = attr(tag, 'type');
        if (!url || (medium && medium !== 'image') || (type && !type.startsWith('image'))) continue;
        const w = Number(attr(tag, 'width')) || 0;
        if (w > bestW) { best = url; bestW = w; }
    }
    if (!best) {
        const enc = (block.match(/<enclosure\b[^>]*>/gi) || []).find(t => /image/i.test(attr(t, 'type')) || /\.(jpe?g|png|webp)/i.test(attr(t, 'url')));
        if (enc) best = attr(enc, 'url');
    }
    if (!best) {
        const img = descHtml.match(/<img\b[^>]*>/i);
        if (img) best = attr(img[0], 'src');
    }
    // BBC serves tiny 240px thumbnails in RSS; the same image exists at 800px.
    best = best.replace(/(ichef\.bbci\.co\.uk\/(?:ace\/)?(?:ws|standard))\/240\//, '$1/800/');
    return isHttpUrl(best) ? best : '';
}

export function parseFeed(xml, feedName) {
    const channelTitle = plain(text(xml.split(/<(?:item|entry)[\s>]/i)[0] || '', 'title'));
    const fallbackSource = SOURCE_NAMES[feedName]
        || SOURCE_NAMES[Object.keys(SOURCE_NAMES).find(k => feedName.startsWith(k)) || '']
        || channelTitle || 'News';

    const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
    const out = [];
    for (const block of blocks.slice(0, 60)) {
        let title = plain(text(block, 'title'));
        let link = plain(text(block, 'link'));
        if (!link) link = attr(block.match(/<link\b[^>]*>/i)?.[0] || '', 'href'); // Atom
        if (!link) {
            const guid = plain(text(block, 'guid'));
            if (/^https?:/.test(guid)) link = guid;
        }
        link = link.replace(/#publisher=newsstand$/, '');
        if (!title || !isHttpUrl(link)) continue;

        const descHtml = text(block, 'description') || text(block, 'summary') || text(block, 'content:encoded');
        let description = plain(descHtml).replace(/\s*Continue reading\.{0,3}$/i, '');
        let source = fallbackSource;

        if (feedName === 'google') {
            // Google News: "Headline - Publisher", description is just links.
            const src = plain(text(block, 'source'));
            if (src) {
                source = src;
                if (title.endsWith(` - ${src}`)) title = title.slice(0, -(src.length + 3));
            }
            description = '';
            // Topic hub pages ("X Latest News, Updates in Hindi") are not stories.
            if (/latest news,? (and )?updates/i.test(title)) continue;
        }

        const dateRaw = plain(text(block, 'pubDate') || text(block, 'published') || text(block, 'updated') || text(block, 'dc:date'));
        const ts = Date.parse(dateRaw);

        out.push({
            title: clamp(title, 300),
            description: clamp(description, 600),
            content: '',
            image: pickImage(block, descHtml),
            source: { name: clamp(source, 80) },
            url: link,
            publishedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------
const feedCache = new Map();

async function loadFeed({ name, url }) {
    const hit = feedCache.get(url);
    if (hit && Date.now() - hit.ts < FEED_TTL) return hit.items;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = parseFeed(await res.text(), name);
        feedCache.set(url, { ts: Date.now(), items });
        if (feedCache.size > 200) feedCache.delete(feedCache.keys().next().value);
        return items;
    } catch (error) {
        console.warn(`feed ${name} failed: ${error?.message}`);
        // Serve the last good copy rather than nothing.
        return hit?.items || [];
    }
}

const timeOf = (a) => (a.publishedAt ? Date.parse(a.publishedAt) : 0);

export const ALL_TOPICS = ['general', 'nation', 'world', 'business', 'technology', 'sports', 'health', 'science', 'entertainment'];

/** Stable feed id: 'lang|region|topic'. Hindi feeds are India-only. */
export function feedKey({ lang = 'en', country = '', topic = 'general' }) {
    const region = lang === 'hi' || country === 'in' ? 'in' : 'world';
    return `${lang}|${region}|${topic}`;
}

/** Every feed the app can show (what the ingest job keeps warm). */
export const ALL_FEEDS = [
    ...ALL_TOPICS.map(topic => ({ lang: 'en', country: 'in', topic })),
    ...ALL_TOPICS.map(topic => ({ lang: 'en', country: '', topic })),
    ...ALL_TOPICS.map(topic => ({ lang: 'hi', country: 'in', topic }))
];

/**
 * Newest first, exact-URL duplicates removed, and at most 2 stories in a row
 * from the same outlet so no single publisher floods the list.
 */
export function interleave(articles, max = 30) {
    const pool = articles.slice().sort((a, b) => timeOf(b) - timeOf(a));
    const seen = new Set();
    const out = [];
    const deferred = [];
    let last = '';
    let streak = 0;
    for (const a of pool) {
        const key = a.url.split('?')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        const src = a.source?.name || '';
        if (src === last && streak >= 2) { deferred.push(a); continue; }
        streak = src === last ? streak + 1 : 1;
        last = src;
        out.push(a);
        if (out.length >= max) break;
    }
    for (const a of deferred) {
        if (out.length >= max) break;
        out.push(a);
    }
    return out;
}

/** Live headlines straight from the publisher feeds. */
export async function getRssHeadlines({ lang = 'en', country = '', topic = 'general', q = '', max = 30 }) {
    const feeds = q ? [searchFeed({ lang, country, q })] : feedsFor({ lang, country, topic });
    const lists = await Promise.all(feeds.map(loadFeed));
    const now = Date.now();

    const perFeed = lists.map(items => items
        .filter(a => !a.publishedAt || now - timeOf(a) < MAX_AGE_MS)
        .sort((a, b) => timeOf(b) - timeOf(a))
        .slice(0, feeds.length === 1 ? max : PER_FEED));

    return interleave(perFeed.flat(), max);
}
