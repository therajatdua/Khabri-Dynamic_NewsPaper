export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 1. Check Authentication (From .env)
        const EXPECTED_ID = process.env.ADMIN_ID || 'admin835';
        const EXPECTED_PW = process.env.ADMIN_PASSWORD || 'khabri@835@';

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Mock ')) {
            return res.status(401).json({ error: 'Unauthorized', reason: 'Missing or invalid auth header' });
        }

        const base64Creds = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Creds, 'base64').toString('utf-8');
        
        if (credentials !== `${EXPECTED_ID}:${EXPECTED_PW}`) {
            return res.status(401).json({ error: 'Unauthorized credentials' });
        }

        // 2. Validate Supabase config
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            console.error('Missing Supabase env vars:', { hasUrl: !!SUPABASE_URL, hasKey: !!SUPABASE_SERVICE_ROLE_KEY });
            return res.status(500).json({ error: 'Missing Supabase config', details: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' });
        }

        const headers = {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        };

        // 3. Fetch from news_cache table
        console.log('Fetching from news_cache:', `${SUPABASE_URL}/rest/v1/news_cache?select=source_name,created_at`);
        const cacheRes = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/news_cache?select=source_name,created_at`, { headers });
        
        if (!cacheRes.ok) {
            const errorBody = await cacheRes.text();
            console.error('news_cache fetch failed:', { status: cacheRes.status, body: errorBody });
            throw new Error(`news_cache returned ${cacheRes.status}: ${errorBody}`);
        }
        
        const cacheData = await cacheRes.json();
        console.log('Fetched news_cache rows:', cacheData?.length || 0);

        // 4. Fetch from user_likes table
        console.log('Fetching from user_likes...');
        const likesRes = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/user_likes?select=user_id`, { headers });
        let likesData = [];
        
        if (likesRes.ok) {
            likesData = await likesRes.json();
            console.log('Fetched user_likes rows:', likesData?.length || 0);
        } else {
            console.warn('user_likes fetch skipped (table may not exist)');
        }

        // 5. Build analytics
        if (!cacheData || cacheData.length === 0) {
            console.log('No cache data, returning empty analytics');
            return res.status(200).json({
                totalArticles: 0,
                uniqueUsers: 0,
                totalLikes: 0,
                sources: { labels: [], values: [] },
                dates: { labels: [], values: [] },
                isMock: false
            });
        }

        const sourceCounts = {};
        const dateCounts = {};
        
        cacheData.forEach(article => {
            const src = article.source_name || 'Unknown';
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;

            if (article.created_at) {
                const dateKey = article.created_at.split('T')[0];
                dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
            }
        });

        const sortedSources = Object.entries(sourceCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
            
        const sortedDates = Object.keys(dateCounts).sort();
        const uniqueUsers = new Set(likesData.map(l => l.user_id)).size;

        const analyticsData = {
            totalArticles: cacheData.length,
            uniqueUsers: uniqueUsers,
            totalLikes: likesData.length,
            sources: {
                labels: sortedSources.map(s => s[0]),
                values: sortedSources.map(s => s[1])
            },
            dates: {
                labels: sortedDates.slice(-7),
                values: sortedDates.slice(-7).map(d => dateCounts[d])
            },
            isMock: false
        };

        console.log('Returning analytics:', { articles: analyticsData.totalArticles, users: analyticsData.uniqueUsers, likes: analyticsData.totalLikes });
        res.status(200).json(analyticsData);
    } catch (err) {
        // Log full error to Vercel logs
        console.error('Unexpected error in /api/admin:', err);
        return res.status(500).json({ 
            error: 'Failed to fetch analytics', 
            details: err?.message || String(err),
            timestamp: new Date().toISOString()
        });
    }
}
