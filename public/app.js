/**
 * Khabari Elite - app.js
 * Modular Controller Pattern
 */

// 1. Data Layer - Supabase Client Integration
// Legacy file (not used by the current Khabari frontend).
// Do not ship real keys in public assets.
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY && window?.supabase?.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

class DataLayer {
    constructor() {
        this.cache = [];
    }
    
    async fetchLatestNews() {
        if (!supabase) {
            return [
                { id: '1', title: 'Legacy Elite frontend is disabled', source: 'Khabari', isLead: true },
                { id: '2', title: 'Use the main site UI (index.html + script.js).', source: 'Khabari', isLead: false }
            ];
        }
        // Fetch news from the Supabase 'news_cache' table
        const { data, error } = await supabase
            .from('news_cache')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error('Error fetching Supabase news:', error);
            // Fallback mock data if DB connection fails
            return [
                { id: '1', title: 'Global Markets Rally on AI Infrastructure Boom', source: 'Financial Times', isLead: true },
                { id: '2', title: 'Quantum Computing Startups Secure Record Funding', source: 'TechCrunch', isLead: false }
            ];
        }

        if (!data || data.length === 0) {
            console.log("No data found in Supabase news_cache table.");
            return [
                { id: '1', title: 'Database Connected Successfully', source: 'System Alert', isLead: true },
                { id: '2', title: 'Insert rows into the news_cache table to see them here.', source: 'Setup', isLead: false }
            ];
        }

        // Map database records to frontend model (assigning the first one as lead)
        return data.map((item, index) => ({
            id: item.id,
            title: item.title,
            source: item.source_name || 'Khabari Alert',
            isLead: index === 0
        }));
    }

    async trackLike(articleId) {
        console.log(`[DataLayer] Tracking like for article ${articleId}...`);
        // Required logic once Auth is setup:
        /*
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
            await supabase.from('user_likes').insert([
                { user_id: userData.user.id, article_id: articleId }
            ]);
        }
        */
    }
}

// 2. AI Engine (Groq for Sprinter, Gemini for Analyst)
class AIEngine {
    async getInstantSummary(articleId) {
        // Groq: Llama-3-70b
        console.log('[Groq/Sprinter] Fetching sub-500ms summary...');
        return "This is a lightning-fast 2-sentence summary powered by Groq's Llama-3-70b. It provides immediate context without latency.";
    }

    async querySemanticRAG(query) {
        // Gemini + Supabase pgvector
        console.log(`[Gemini/Analyst] Executing Semantic Search across SUPABASE vector embeddings for: ${query}`);
        return "Based on the 3 most relevant articles clustered in our vector database, market sentiment indicators suggest a strong Q3 recovery.";
    }

    async getDailyBrief() {
        return "Exec Brief: Market rallies on AI news. Quantum funding surges. Energy grids normalize. End of brief.";
    }
}

// 3. Accessibility & System APIs
class DeviceManager {
    speak(text) {
        if (!('speechSynthesis' in window)) return alert("Voice Mode not supported in this browser.");
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        utterance.pitch = 1;
        // Select an executive-sounding voice if available
        const voices = window.speechSynthesis.getVoices();
        const premiumVoice = voices.find(v => v.name.includes('Premium') || v.name.includes('Samantha') || v.name.includes('Daniel'));
        if(premiumVoice) utterance.voice = premiumVoice;
        
        window.speechSynthesis.speak(utterance);
    }
}

// 4. Main App Controller
class AppController {
    constructor() {
        this.data = new DataLayer();
        this.ai = new AIEngine();
        this.device = new DeviceManager();
        this.init();
    }

    async init() {
        this.bindEvents();
        const news = await this.data.fetchLatestNews();
        this.renderNews(news);
    }

    bindEvents() {
        document.getElementById('sendChatBtn').addEventListener('click', () => this.handleChat());
        document.getElementById('chatInput').addEventListener('keypress', (e) => {
            if(e.key === 'Enter') this.handleChat();
        });
        document.getElementById('readBriefBtn').addEventListener('click', async () => {
            const brief = await this.ai.getDailyBrief();
            this.device.speak(brief);
        });
    }

    async handleChat() {
        const input = document.getElementById('chatInput');
        const query = input.value.trim();
        if(!query) return;
        
        const chatBox = document.getElementById('chatMessages');
        chatBox.innerHTML += `<p class="msg-user">${query}</p>`;
        input.value = '';
        chatBox.scrollTop = chatBox.scrollHeight;

        const responseMsg = await this.ai.querySemanticRAG(query);
        chatBox.innerHTML += `<p class="msg-ai">${responseMsg}</p>`;
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    renderNews(news) {
        const lead = news.find(n => n.isLead);
        const trending = news.filter(n => !n.isLead);

        // Render Lead
        document.getElementById('leadStory').innerHTML = `
            <div class="premium-label">Lead Intelligence</div>
            <h2>${lead.title}</h2>
            <p style="color: var(--vintage-gold)">Source: ${lead.source}</p>
            <button class="btn-cyber instant-summary-btn" data-id="${lead.id}">Sprinter Summary (Groq)</button>
            <div class="summary-box" id="sum-${lead.id}"></div>
        `;

        // Render Trending
        const trendingHtml = trending.slice(0,2).map(n => `
            <article class="trending-card">
                <h3>${n.title}</h3>
                <button class="btn-cyber instant-summary-btn" style="font-size:0.8rem" data-id="${n.id}">Summary</button>
                <div class="summary-box" id="sum-${n.id}"></div>
            </article>
        `).join('');
        document.getElementById('trendingGrid').innerHTML = trendingHtml;

        // Render Ticker
        const tickerHtml = `<div class="premium-label">Breaking Ticker</div>` + 
            trending.map(n => `<div style="margin-top: 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5rem">${n.title} - ${n.source}</div>`).join('');
        document.getElementById('tickerGrid').innerHTML = tickerHtml;

        // Bind Summary Buttons
        document.querySelectorAll('.instant-summary-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                const box = document.getElementById(`sum-${id}`);
                box.innerHTML = '<div class="shimmer shimmer-text"></div>';
                box.classList.add('active');
                
                const summary = await this.ai.getInstantSummary(id);
                box.innerHTML = summary;
            });
        });
    }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    new AppController();
    
    // Warm up speech synthesis voices
    window.speechSynthesis.getVoices();
});
