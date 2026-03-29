import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

try {
    // Loads .env into process.env for local development.
    // Optional so the server still runs even if dependencies aren't installed yet.
    await import('dotenv/config');
} catch {
    // ignore
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PREFERRED_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
};

function send(res, statusCode, body, headers = {}) {
    res.writeHead(statusCode, {
        'Cache-Control': 'no-store',
        ...headers
    });
    res.end(body);
}

function sendJson(res, statusCode, obj) {
    send(res, statusCode, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function getBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

async function routeApi(req, res, url) {
    const pathname = url.pathname;

    const apiMatch = pathname.match(/^\/api\/(news|summary|chat)$/);
    if (!apiMatch) return false;

    const name = apiMatch[1];
    const moduleUrl = pathToFileURL(path.join(__dirname, 'api', `${name}.js`)).href;

    let handler;
    try {
        ({ default: handler } = await import(moduleUrl));
        if (typeof handler !== 'function') throw new Error('Missing default export');
    } catch (e) {
        sendJson(res, 500, { error: `Failed to load /api/${name}: ${e?.message || 'unknown error'}` });
        return true;
    }

    const query = Object.fromEntries(url.searchParams.entries());

    let bodyObj = undefined;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const raw = await getBody(req);
        if (raw) {
            try {
                bodyObj = JSON.parse(raw);
            } catch {
                bodyObj = raw;
            }
        }
    }

    const vercelReq = {
        method: req.method,
        query,
        body: bodyObj,
        headers: req.headers
    };

    const vercelRes = {
        status(code) {
            this._status = code;
            return this;
        },
        setHeader(key, value) {
            res.setHeader(key, value);
        },
        json(obj) {
            sendJson(res, this._status || 200, obj);
        },
        send(payload) {
            if (typeof payload === 'object' && payload !== null) {
                return this.json(payload);
            }
            send(res, this._status || 200, payload ?? '');
        },
        end(payload) {
            send(res, this._status || 200, payload ?? '');
        }
    };

    try {
        await handler(vercelReq, vercelRes);
    } catch (e) {
        sendJson(res, 500, { error: e?.message || 'Server error' });
    }

    return true;
}

function safeJoin(base, requestPath) {
    const normalized = path.posix.normalize(requestPath);
    const stripped = normalized.replace(/^\/+/, '');
    const resolved = path.join(base, stripped);
    if (!resolved.startsWith(base)) return null;
    return resolved;
}

async function routeStatic(_req, res, url) {
    let pathname = url.pathname;
    if (pathname === '/') pathname = '/index.html';

    const target = safeJoin(PUBLIC_DIR, pathname);
    if (!target) {
        send(res, 400, 'Bad request');
        return;
    }

    try {
        const ext = path.extname(target).toLowerCase();
        const ct = CONTENT_TYPES[ext] || 'application/octet-stream';
        const content = await readFile(target);
        send(res, 200, content, { 'Content-Type': ct });
    } catch {
        send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    const handled = await routeApi(req, res, url);
    if (handled) return;

    await routeStatic(req, res, url);
});

function startListening(startPort, attemptsLeft) {
    const port = startPort;

    const onListening = () => {
        // eslint-disable-next-line no-console
        console.log(`Khabari dev server running: http://localhost:${port}`);
        // eslint-disable-next-line no-console
        console.log('API endpoints: /api/news, /api/summary, /api/chat');
    };

    const onError = (err) => {
        if (err?.code === 'EADDRINUSE' && attemptsLeft > 0) {
            startListening(port + 1, attemptsLeft - 1);
            return;
        }

        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    };

    server.once('error', onError);
    server.listen(port, onListening);
}

startListening(PREFERRED_PORT, 20);
