// Shared Groq chat-completions client with model fallback.

const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

// gpt-oss models reason before answering; keep it short and hide the reasoning.
const reasoningOpts = (model) => (model.startsWith('openai/gpt-oss')
    ? { reasoning_effort: 'low', include_reasoning: false }
    : {});

/**
 * Returns the model's plain-text reply, or '' when AI is unavailable
 * (no key, all models failed, timeout). Callers supply their own fallback.
 */
export async function groqComplete({ system, user, maxTokens = 600, temperature = 0.2, timeoutMs = 15000 }) {
    const key = process.env.GROQ_API_KEY;
    if (!key) return '';

    const models = [...new Set([(process.env.GROQ_MODEL || '').trim(), ...MODELS].filter(Boolean))];

    for (const model of models) {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    temperature,
                    max_tokens: maxTokens,
                    ...reasoningOpts(model),
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user }
                    ]
                }),
                signal: AbortSignal.timeout(timeoutMs)
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const msg = (data?.error?.message || '').toString();
                // Retired/unknown model: try the next one. Anything else: give up.
                if (/decommissioned|model|not\s+supported|does\s+not\s+exist/i.test(msg)) {
                    console.warn(`Groq model ${model} unavailable: ${msg || response.status}`);
                    continue;
                }
                return '';
            }
            const text = (data?.choices?.[0]?.message?.content || '').toString().replace(/<[^>]*>/g, '').trim();
            if (text) return text;
        } catch {
            return '';
        }
    }
    return '';
}
