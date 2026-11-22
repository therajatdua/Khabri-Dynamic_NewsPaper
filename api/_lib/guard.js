// Shared request guards for the serverless endpoints.
// Files under api/_lib are not exposed as routes on Vercel (underscore prefix).

const buckets = new Map();

export function clientIp(req) {
    const fwd = (req.headers?.['x-forwarded-for'] || '').toString();
    return fwd.split(',')[0].trim() || req.headers?.['x-real-ip'] || 'unknown';
}

/**
 * Best-effort fixed-window rate limit, per serverless instance.
 * Not a substitute for a shared store (Upstash/Vercel KV), but it stops
 * casual abuse of the paid AI endpoints from a single client.
 */
export function rateLimit(req, res, { key, limit, windowMs }) {
    const id = `${key}:${clientIp(req)}`;
    const now = Date.now();
    let b = buckets.get(id);
    if (!b || now - b.start > windowMs) {
        b = { start: now, count: 0 };
        buckets.set(id, b);
    }
    b.count += 1;

    if (buckets.size > 5000) {
        for (const [k, v] of buckets) {
            if (now - v.start > windowMs) buckets.delete(k);
        }
    }

    if (b.count > limit) {
        const retry = Math.ceil((b.start + windowMs - now) / 1000);
        res.setHeader?.('Retry-After', String(retry));
        return false;
    }
    return true;
}

export function clamp(value, max) {
    return (value ?? '').toString().replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

export function isHttpUrl(value) {
    try {
        const u = new URL(value);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}
