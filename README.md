# Khabri -NewsWala

An India-first news app with a personalized "For You" feed, instant AI summaries, and an AI news assistant. It is plain HTML, CSS and JavaScript with Vercel serverless functions. There is no framework and no build step.

## Features

- **Personalized For You feed.** Readers pick topics (India, World, Tech, Sports…) and follow keywords (e.g. "IPL", "ISRO", "Sensex"). The feed is ranked by recency, chosen topics, what you actually read (category and source affinity that slowly decays), followed keywords and multi-source coverage, with a diversity pass so one topic never floods it. Everything is stored in the browser (`localStorage`), so no account is needed.
- **Daily briefing.** The 5 stories that matter most right now, one factual line each, picked by AI from the top headlines, with a **Listen** button (text-to-speech, Hindi or English). One AI call per region and language is shared by all readers through the CDN cache. Readers can hide it until tomorrow.
- **"Since your last visit."** A count of new stories and **NEW** badges on cards. Stories you've already read are dimmed.
- **Story sheet.** Shows the image, an AI summary, "also covered by" other outlets, related stories, and a button to read the full article at the source. This replaced an iframe that most news sites block.
- **Saved stories**, sharing (native share sheet, clipboard or WhatsApp), "Show less like this", and hiding a source.
- **"↑ N new stories" pill.** Auto-refresh never swaps content while someone is reading.
- **Hindi feed** (`lang=hi`), India and World regions, dark mode, and shareable URLs (`?cat=sports`, `?q=isro`, `?search=`).
- **Installable PWA** with offline reading of the last feed (service worker).
- **AI assistant** that answers from the headlines on screen, with a "Listen" audio briefing.

## Architecture

```
public/
  index.html      markup
  script.js       app: fetching, ranking, rendering, personalization
  styles.css      design tokens (light/dark) and components
  sw.js           offline cache (network-first for pages, /api/news, /api/brief)
  analytics.html  private dashboard (token-protected), analytics.js
api/
  news.js         news feed endpoint (CDN cache headers)
  brief.js        daily 5-story AI briefing (cached 30 min per region/language)
  ingest.js       scheduled job: all feeds -> Supabase, AI summaries, pruning (needs CRON_SECRET)
  summary.js      2-sentence AI summary (Groq), rate limited
  chat.js         assistant (Groq), answers only from supplied headlines
  analytics.js    dashboard data (requires ANALYTICS_TOKEN)
  _lib/guard.js   rate limiting and input clamping helpers
  _lib/rss.js     publisher RSS feeds (per region/language/topic) + parser, Google News search
  _lib/headlines.js  headline source: Supabase (fresh ingest) -> live RSS -> GNews backup -> stored fallback
  _lib/db.js      minimal Supabase REST client (server only)
supabase/migration.sql  safe-to-rerun migration for an existing project
.github/workflows/ingest.yml  calls /api/ingest every 10 minutes
  _lib/groq.js    Groq client with model fallback
schema.sql        Supabase tables + row-level security policies
dev-server.mjs    local server that mimics Vercel (same security headers)
```

**Where headlines come from.** Publisher RSS feeds: The Hindu, The Indian Express, NDTV, The Times of India, Mint and Gadgets 360 for India; BBC, The Guardian, Al Jazeera and NPR for World; BBC Hindi, NDTV India and Amar Ujala for Hindi. They are free, need no key, have no quota, and are minutes fresh. Search and Hindi topic pages use Google News RSS. Each feed is cached for 5 minutes per server, and responses are CDN-cached, so the feeds are fetched only a few times an hour no matter how many visitors you have. Cards show the publisher and link to the original article.

The daily briefing ranks stories by how many outlets cover them and by their position in Google News Top Stories, then asks the AI for one factual line per story.

Fallbacks, in order: if the RSS feeds return too little, `/api/news` tries GNews (when `GNEWS_API_KEY` is set). If that fails too, it serves the most recent matching rows from the Supabase `news_cache` table. If that is empty or not configured, the browser falls back to a static headline archive. Both are **labelled as archived** in the UI.

## Setup

```bash
npm install
cp .env.example .env   # or create .env with the variables below
npm run dev            # http://localhost:3000
```

| Variable | Required | Purpose |
|---|---|---|
| `GNEWS_API_KEY` | optional | Backup headline source ([gnews.io](https://gnews.io)), used only when the RSS feeds return too little |
| `GROQ_API_KEY` | optional | AI summaries and assistant. Without it, simple text fallbacks are used |
| `GROQ_MODEL` | optional | Override the model (default `openai/gpt-oss-120b`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | optional | Headline cache + analytics data. **Server-side only, never ship these to the browser** |
| `ANALYTICS_TOKEN` | for `/analytics` | Random secret, at least 16 characters. The dashboard asks for it |
| `CRON_SECRET` | for `/api/ingest` | Random secret, at least 16 characters (`openssl rand -hex 24`). Schedulers send it as `Authorization: Bearer …` |

Deploy on Vercel and set the same variables in the project's Environment Variables. `vercel.json` adds a Content-Security-Policy and other security headers.

### Scheduled ingest (recommended)

1. Run `supabase/migration.sql` in the Supabase SQL Editor (safe to re-run).
2. Set `CRON_SECRET` in Vercel.
3. In GitHub: Settings -> Secrets and variables -> Actions, add `CRON_SECRET` (same value) and `INGEST_URL` (`https://<your-site>/api/ingest`).
4. Test it: Actions -> **Ingest news** -> Run workflow. The response looks like `{"ok":true,"feeds":27,"stories":…,"summarized":…}`.

Every 10 minutes the job stores all 27 feeds in Supabase, writes AI summaries for the top new stories (8 per AI call), and deletes stories older than 7 days. `/api/news` then serves from the database with summaries included, so the story sheet needs no AI call. If the job stops, the site falls back to reading the feeds live. Vercel Cron runs it once a day as a backup (the Hobby plan limit).

### Notes

- Feed URLs change occasionally. A dead feed only logs `feed <name> failed` and the others keep working. Update the list in `api/_lib/rss.js`.
- Google News RSS (search and Hindi topics) is meant for personal, non-commercial use. If you monetise the site, replace it with publisher feeds or a licensed API.
- If you use GNews as the backup: on the free plan, articles arrive about 12 hours late.
- The Supabase fallback needs the `topic`, `lang` and `country` columns on `news_cache` (see `schema.sql`; the `alter table` lines are safe to run on an existing table). Without them, headlines are still cached, but the fallback can't find them.
- After changing `public/` files that the service worker caches, bump `VERSION` in `public/sw.js` so returning visitors get the update.

## 👨‍� Author

**Rajat Dua**  
- GitHub: [@rajatxdua](https://github.com/rajatxdua)  
- Instagram: [@therajatdua](https://instagram.com/therajatdua)

*Built as part of a web development internship to demonstrate modern API integration, responsive design, and JavaScript programming skills.*

## 📄 License

MIT License - feel free to use this project for learning and development purposes.

#Gallery

https://github.com/rajatxdua/API-INTEGRATION/issues/1#issue-3253828625

https://github.com/rajatxdua/API-INTEGRATION/issues/2#issue-3253833802
