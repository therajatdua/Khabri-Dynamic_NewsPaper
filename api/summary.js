export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { title = '', description = '', content = '', url = '' } = req.body || {};
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    const fallback = () => {
        const base = (description || content || title || '').trim();
        const sentences = base.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
        const first = sentences[0] || title;
        const second = sentences[1] || '';
        return [first, second].filter(Boolean).join(' ');
    };

    if (!GROQ_API_KEY) {
        return res.status(200).json({ summary: fallback() });
    }

    const prompt = `Summarize the following news story in exactly 2 punchy sentences. Be factual and concise.\n\nTitle: ${title}\nDescription: ${description}\nContent: ${content}\nURL: ${url}`;

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama3-70b-8192',
                temperature: 0.2,
                max_tokens: 120,
                messages: [
                    { role: 'system', content: 'You are a fast news summarizer.' },
                    { role: 'user', content: prompt }
                ]
            })
        });

        if (!response.ok) {
            return res.status(200).json({ summary: fallback() });
        }

        const data = await response.json();
        const summary = data?.choices?.[0]?.message?.content?.trim();
        return res.status(200).json({ summary: summary || fallback() });
    } catch {
        return res.status(200).json({ summary: fallback() });
    }
}
