// Minimal Supabase REST (PostgREST) client for server code. Service-role key:
// never import this from anything that ships to the browser.

export function dbConfigured() {
    return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function base() {
    return `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;
}

function headers(extra = {}) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/**
 * Call PostgREST. Returns { ok, status, data }. Never throws: the database is
 * a cache, so callers treat failures as "no data".
 */
export async function db(path, { method = 'GET', body, prefer, timeoutMs = 3000 } = {}) {
    if (!dbConfigured()) return { ok: false, status: 0, data: null };
    try {
        const res = await fetch(`${base()}/${path}`, {
            method,
            headers: headers({
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...(prefer ? { Prefer: prefer } : {})
            }),
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(timeoutMs)
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!res.ok) console.warn(`supabase ${method} ${path.split('?')[0]} -> ${res.status} ${typeof data === 'object' ? data?.message || '' : ''}`);
        return { ok: res.ok, status: res.status, data, contentRange: res.headers.get('content-range') || '' };
    } catch (error) {
        console.warn(`supabase ${method} ${path.split('?')[0]} failed: ${error?.message}`);
        return { ok: false, status: 0, data: null };
    }
}

export const rpc = (name, args, opts = {}) => db(`rpc/${name}`, { method: 'POST', body: args, ...opts });
