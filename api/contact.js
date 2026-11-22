// Contact form: validates, rate limits, and stores messages in Supabase
// (table contact_messages; read them in the Supabase table editor).
import { createHash } from 'node:crypto';
import { rateLimit, clamp, clientIp } from './_lib/guard.js';
import { db, dbConfigured } from './_lib/db.js';

const TOPICS = new Set(['feedback', 'bug', 'tip', 'ai-error', 'other']);
// Durable limits (shared by all serverless instances), per hashed IP.
const LIMIT_10_MIN = 5;
const LIMIT_DAY = 20;
const LIMIT_GLOBAL_HOUR = 200; // protects the free-tier database from floods

// Browsers send Origin on POST; reject cross-site posts. (Non-browser clients
// without Origin still hit the durable rate limits below.)
function sameOrigin(req) {
    const origin = (req.headers?.origin || '').toString();
    if (!origin) return true;
    try {
        const host = (req.headers?.['x-forwarded-host'] || req.headers?.host || '').toString().split(',')[0].trim();
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanAttribution(a) {
    if (!a || typeof a !== 'object') return null;
    const pick = (t) => (t && typeof t === 'object')
        ? Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'landing', 'referrer', 'at']
            .filter(k => t[k]).map(k => [k, clamp(t[k], 120)]))
        : null;
    const out = { first: pick(a.first), last: pick(a.last) };
    return out.first || out.last ? out : null;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    res.setHeader('Cache-Control', 'no-store');

    if (!sameOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!/^application\/json\b/i.test((req.headers?.['content-type'] || '').toString())) {
        return res.status(415).json({ error: 'Send JSON' });
    }
    if (!rateLimit(req, res, { key: 'contact', limit: 5, windowMs: 10 * 60_000 })) {
        return res.status(429).json({ error: 'Too many messages. Please try again in a few minutes.' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // Honeypot: bots fill hidden fields. Pretend success, store nothing.
    if (clamp(body.website, 200)) return res.status(200).json({ ok: true });

    const name = clamp(body.name, 80);
    const email = clamp(body.email, 200).toLowerCase();
    const topic = TOPICS.has(body.topic) ? body.topic : 'other';
    // Keep line breaks in the message (clamp() would turn them into spaces).
    const message = (body.message ?? '').toString().replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, 2000);

    const errors = {};
    if (!email) errors.email = 'Please enter your email so we can reply.';
    else if (!EMAIL_RE.test(email)) errors.email = 'That email doesn’t look right. Check for typos.';
    if (message.length < 10) errors.message = 'Please write at least 10 characters.';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    if (!dbConfigured()) return res.status(503).json({ error: 'Contact isn’t set up yet. Please try again later.' });

    // Store a salted hash of the IP (abuse tracing) rather than the IP itself.
    const salt = process.env.CRON_SECRET || process.env.SUPABASE_URL || 'khabri';
    const ipHash = createHash('sha256').update(`${salt}:${clientIp(req)}`).digest('hex').slice(0, 32);

    // Durable rate limits (in-memory limits reset per serverless instance).
    const [recent, today, global] = await Promise.all([
        db(`contact_messages?select=id&ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 10 * 60_000).toISOString())}&limit=1`, { prefer: 'count=exact', timeoutMs: 3000 }),
        db(`contact_messages?select=id&ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&limit=1`, { prefer: 'count=exact', timeoutMs: 3000 }),
        db(`contact_messages?select=id&created_at=gte.${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}&limit=1`, { prefer: 'count=exact', timeoutMs: 3000 })
    ]);
    const total = (r) => Number((r.contentRange || '').split('/')[1]) || 0;
    if (total(recent) >= LIMIT_10_MIN || total(today) >= LIMIT_DAY) {
        return res.status(429).json({ error: 'Too many messages. Please try again later.' });
    }
    if (total(global) >= LIMIT_GLOBAL_HOUR) {
        return res.status(503).json({ error: 'We’re receiving a lot of messages right now. Please try again in an hour.' });
    }

    const r = await db('contact_messages', {
        method: 'POST',
        body: {
            name: name || null,
            email,
            topic,
            message,
            page: clamp(body.page, 200) || null,
            attribution: cleanAttribution(body.attribution),
            ip_hash: ipHash,
            user_agent: clamp(req.headers?.['user-agent'], 200) || null
        },
        prefer: 'return=minimal',
        timeoutMs: 4000
    });

    if (!r.ok) {
        const missing = r.status === 404;
        return res.status(missing ? 503 : 502).json({
            error: missing ? 'Contact isn’t set up yet. Please try again later.' : 'We couldn’t save your message. Please try again.'
        });
    }
    return res.status(201).json({ ok: true });
}
