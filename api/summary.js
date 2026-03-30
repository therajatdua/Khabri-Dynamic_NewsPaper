export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { title = '', description = '', content = '', url = '' } = req.body || {};
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    const safeText = (v) => (v ?? '').toString().trim();

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

    const prompt = `Summarize the following news story in exactly 2 punchy sentences. Be factual and concise.\n\nTitle: ${safeText(title)}\nDescription: ${safeText(description)}\nContent: ${safeText(content)}\nURL: ${safeText(url)}`;

    const modelCandidates = [
        safeText(process.env.GROQ_MODEL),
        'llama-3.3-70b-versatile',
        'llama-3.1-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768'
    ].filter(Boolean);

    const uniqueModels = [...new Set(modelCandidates)];

    try {
        for (const model of uniqueModels) {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.1,
                    max_tokens: 140,
                    messages: [
                        { role: 'system', content: 'You are a fast news summarizer.' },
                        { role: 'user', content: prompt }
                    ]
                })
            });

            let data;
            try {
                data = await response.json();
            } catch {
                data = null;
            }

            if (!response.ok) {
                const msg = safeText(data?.error?.message);
                const retryableModelIssue = /decommissioned|model|not\s+supported|does\s+not\s+exist/i.test(msg);
                if (retryableModelIssue) {
                    // eslint-disable-next-line no-console
                    console.warn(`Groq summary failed for model ${model}: ${msg || `HTTP ${response.status}`}`);
                    continue;
                }
                return res.status(200).json({ summary: fallback() });
            }

            const summary = safeText(data?.choices?.[0]?.message?.content);
            if (summary) return res.status(200).json({ summary });
        }

        return res.status(200).json({ summary: fallback() });
    } catch {
        return res.status(200).json({ summary: fallback() });
    }
}
