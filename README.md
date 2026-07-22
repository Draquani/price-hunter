# PriceHunter 🐾

An AI-powered price comparison web app. You describe a product, PriceHunter clarifies the specs, confirms what it'll search for, then scrapes live prices from each store — no training-data guesses, no stale numbers.

**Live:** https://price-hunter-bay.vercel.app

---

## What It Does

1. **Clarifies** — Asks focused spec questions (brand, size, power source, etc.) until it has a specific, searchable product
2. **Confirms** — Shows exactly what it will search for and which stores, waits for your go-ahead
3. **Pre-checks** — Optionally verifies the product actually exists at retail (skipped for mainstream products to save time)
4. **Searches** — Queries all stores in parallel via Tavily, scrapes top 3 candidate product pages per store simultaneously via Firecrawl, uses an LLM to extract and strictly validate the price
5. **Reports** — Displays a comparison table with live prices, best-deal highlight, product image, and direct links

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16.2.10 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| LLM | Google Gemini via OpenRouter (`google/gemini-3-flash-preview`) |
| Web search | Tavily (`@tavily/core`) |
| Page scraping | Firecrawl (`@mendable/firecrawl-js`) |
| Streaming | Server-Sent Events (SSE) |
| Hosting | Vercel |

---

## Architecture

```
User → app/page.tsx (chat UI)
         ↓  POST /api/price-search
app/api/price-search/route.ts
  ├── Agentic loop (max 8 iterations) via OpenRouter
  ├── Tool: update_store_list      — saves the agreed store list
  ├── Tool: check_product_exists   — optional Tavily search to verify obscure products exist at retail
  └── Tool: get_item_prices
        ├── Tavily search per store in parallel (includeDomains, max 10 results)
        ├── URL ranking — product-page patterns preferred over category/search pages
        ├── Firecrawl scrape — top 3 candidate URLs per store scraped in parallel
        └── LLM price extraction — strict brand/model/spec matching; rejects wrong variants
              ↓
  lastPriceResults override — actual scraper URLs/prices always replace LLM-generated ones
         ↓  SSE stream
app/page.tsx — renders status messages, final chat reply, PriceResults table
```

### Key Design Decisions

**`lastPriceResults` override:** The LLM writes a final JSON block with results, but the server always substitutes the real scraper data before sending. This prevents the LLM from fabricating URLs or prices.

**Parallel scraping:** All stores are searched simultaneously via `Promise.all`, and within each store the top 3 candidate URLs are scraped in parallel too. This cuts total search time significantly compared to sequential scraping.

**Strict price extraction:** The LLM extractor rejects pages where brand, model, or any specified spec (size, power source, color, etc.) doesn't match. It tries up to 3 candidate URLs before giving up on a store.

**3-step workflow (CLARIFY → CONFIRM → SEARCH):** The agent asks spec questions, presents exactly what it'll search for, waits for user confirmation, then calls tools. This avoids wasted scraping on the wrong product.

**SSE streaming:** Status messages (`Searching Walmart…`, `Reading price from Amazon…`) stream to the UI in real time so users see progress during the search.

**No model-number invention:** The system prompt explicitly forbids the LLM from inventing model numbers during clarification. It builds the search query only from specs the user explicitly stated.

**Optional existence check:** `check_product_exists` is skipped for mainstream products (major brands, common electronics, etc.) — it's only called when the agent has genuine doubt. Saves 1–2s on most searches.

---

## Project Structure

```
price-hunter/
├── app/
│   ├── api/
│   │   ├── price-search/route.ts   # Core agentic search route (SSE)
│   │   └── product-image/route.ts  # Tavily image search for product thumbnails
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                    # Chat UI with SVG PawIcon, SSE reader, snapshot download
├── components/
│   ├── PriceResults.tsx            # Price comparison table (best-deal highlight, links hidden for N/A)
│   └── StoreChips.tsx              # Saved-store chip display
├── lib/
│   ├── tools.ts                    # Tool definitions + AGENT_SYSTEM_PROMPT
│   └── types.ts                    # TypeScript interfaces
└── .env.local                      # NOT committed — see setup below
```

---

## Local Setup

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/price-hunter.git
cd price-hunter
npm install
```

### 2. Environment variables

Create `.env.local` in the project root (gitignored — never commit this file):

```
OPENROUTER_API_KEY=sk-or-...
TAVILY_API_KEY=tvly-...
FIRECRAWL_API_KEY=fc-...
```

Get keys from:
- OpenRouter: https://openrouter.ai/keys
- Tavily: https://tavily.com
- Firecrawl: https://firecrawl.dev

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000

---

## Vercel Deployment

The app deploys via the Vercel API. Environment variables must be set in **Vercel → Project → Settings → Environment Variables**:

- `OPENROUTER_API_KEY`
- `TAVILY_API_KEY`
- `FIRECRAWL_API_KEY`

These are server-only — never exposed to the browser.

---

## Features

- **Any product category** — electronics, appliances, tools, art supplies, furniture, and more
- **Spec-driven clarification** — asks the right questions for each category before searching
- **Store memory** — saves preferred stores in localStorage across sessions
- **Product image** — fetched live via Tavily image search
- **Best-deal highlight** — lowest price gets a star and green highlight
- **N/A rows show no link** — if a store didn't have the product, the Link column shows `—`
- **All-N/A loop-back** — if every store returns N/A, asks user to adjust specs instead of showing a useless table
- **Debug snapshots** — camera icon downloads a full conversation + results log for troubleshooting
- **Responsive UI** — works on mobile and desktop

---

## Security

- `.env*` files are gitignored — API keys are never committed to the repo
- All API calls to OpenRouter, Tavily, and Firecrawl run server-side only
- No API keys are sent to the client
