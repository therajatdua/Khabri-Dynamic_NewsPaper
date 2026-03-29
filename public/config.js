// API Configuration


const API_CONFIG = {
    // NOTE: Do not ship API keys in public files.
    // This project now uses server-side endpoints under /api/* with environment variables.
    NEWS_API_KEY: '',
    GNEWS_API_KEY: '',
    
    // Alternative free APIs (no key required)
    RSS_TO_JSON_API: 'https://api.rss2json.com/v1/api.json',
    
    // CORS Proxy for browser requests (if needed)
    CORS_PROXY: 'https://cors-anywhere.herokuapp.com/',
    
    // Default settings
    DEFAULT_COUNTRY: 'in',
    DEFAULT_LANGUAGE: 'en',
    ARTICLES_PER_PAGE: 12
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API_CONFIG;
}
