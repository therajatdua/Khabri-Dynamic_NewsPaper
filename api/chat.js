export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const { question, articles, context } = req.body || {};

    const q = (question || '').toString().trim();
    if (!q) return res.status(400).json({ answer: 'Missing question.' });

    const linesFromArticles = Array.isArray(articles)
        ? articles.slice(0, 12).map((a, i) => {
            const title = (a?.title || '').toString();
            const source = (a?.source || a?.sourceName || '').toString();
            const url = (a?.url || '').toString();
            const desc = (a?.description || '').toString();
            return `${i + 1}. ${title} (${source})\n${desc}\n${url}`;
        }).join('\n\n')
        : '';

    const ctx = (context || '').toString().trim();
    const newsContext = [linesFromArticles, ctx].filter(Boolean).join('\n\n');

    if (!GROQ_API_KEY) {
        // Safe fallback: return a structured response pointing to links.
        return res.status(200).json({
            answer: `I can answer using live headlines, but server AI isn't enabled yet.\n\nQuestion: ${q}\n\nTip: Set GROQ_API_KEY on Vercel to enable deep answers.`
        });
    }

    const prompt = `You are a news assistant. Use ONLY the provided headlines/context to answer.\n\nContext:\n${newsContext || '(no context provided)'}\n\nUser question: ${q}\n\nAnswer rules:\n- If the user asks for "specific details", cite the most relevant items and include their URLs.\n- If the context is insufficient, say so and propose what category/region to check.`;

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
                max_tokens: 350,
                messages: [
                    { role: 'system', content: 'You are fast, factual, and concise.' },
                    { role: 'user', content: prompt }
                ]
            })
        });

        const data = await response.json();
        const answer = data?.choices?.[0]?.message?.content?.trim();
        return res.status(200).json({ answer: answer || 'No answer returned.' });
    } catch {
        return res.status(500).json({ answer: 'Connection to AI failed. Please try again.' });
    }
}
