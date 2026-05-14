export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 1. Check Authentication (admin835 / khabri@835@)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Mock ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const base64Creds = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Creds, 'base64').toString('utf-8');
    
    if (credentials !== 'admin835:khabri@835@') {
        return res.status(401).json({ error: 'Unauthorized credentials' });
    }

    // Fallback Mock Data in case Supabase is not configured or empty
    const fallbackData = {
        totalArticles: 1450,
        uniqueUsers: 340,
        totalLikes: 890,
        sources: {
            labels: ['TechCrunch', 'BBC News', 'CNN', 'Reuters', 'IGN'],
            values: [450, 300, 250, 200, 250]
        },
        dates: {
            labels: ['May 8', 'May 9', 'May 10', 'May 11', 'May 12', 'May 13', 'May 14'],
            values: [120, 150, 180, 130, 200, 170, 220]
        },
        isMock: true
    };

    // 2. Fetch real analytics from Supabase
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // If keys missing, return realistic mock data to keep the UI active
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(200).json(fallbackData);
    }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    };

    try {
        const cacheRes = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/news_cache?select=source_name,created_at`, { headers });
        if (!cacheRes.ok) throw new Error('Failed to fetch from news_cache');
        const cacheData = await cacheRes.json();
        
        const likesRes = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/user_likes?select=user_id`, { headers });
        let likesData = [];
        if (likesRes.ok) {
            likesData = await likesRes.json();
        }

        if (!cacheData || cacheData.length === 0) {
            // No real data yet, return fallback to show a populated dashboard
            return res.status(200).json(fallbackData);
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

        res.status(200).json(analyticsData);
    } catch (err) {
        console.error('Error fetching from Supabase:', err);
        return res.status(200).json(fallbackData);
    }
}
