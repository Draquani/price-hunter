import { NextRequest } from "next/server";
import { tavily } from "@tavily/core";
import FirecrawlApp from "@mendable/firecrawl-js";
import { PRICE_TOOLS, AGENT_SYSTEM_PROMPT } from "@/lib/tools";
import { ChatMessage, PriceComparisonResult, StoreResult } from "@/lib/types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

// ─── SSE helpers ─────────────────────────────────────────────────────────────
function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ─── Tool: update_store_list ──────────────────────────────────────────────────
function handleUpdateStoreList(args: {
  stores: string[];
  suggested_additions?: string[];
}): { stores: string[]; suggested_additions: string[]; message: string } {
  return {
    stores: args.stores,
    suggested_additions: args.suggested_additions ?? [],
    message: `Store list saved: ${args.stores.join(", ")}`,
  };
}

// ─── LLM-based price extraction ───────────────────────────────────────────────
async function extractPriceWithLLM(
  product: string,
  store: string,
  pageContent: string,
  apiKey: string
): Promise<{ price: string | null; note: string | null }> {
  const truncated = pageContent.slice(0, 8000);
  const EXTRACT_TIMEOUT_MS = 10000;
  let res: Response;
  try {
    res = await Promise.race([
      fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://price-hunter.vercel.app",
          "X-Title": "PriceHunter",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{
            role: "user",
            content: `You are a strict price extraction tool. From the product page content below (from ${store}), find the current selling price for EXACTLY: "${product}".

Return ONLY a JSON object:
{"price": "$X.XX", "note": "optional short note"}

CRITICAL ANTI-HALLUCINATION RULES (read first):
- You are READING TEXT from a product page. You may ONLY report a price that appears VERBATIM in the page content below.
- NEVER use your training knowledge of product prices — prices change and your training data is wrong for today's prices.
- If you cannot find the price explicitly written in the text below, return {"price": null, "note": "price not visible"}.
- The "note" field must only describe what is literally on the page. NEVER write "based on", "typically", "usually", "approximately", "estimated", or any inference. If you catch yourself doing this, return null instead.
- When in doubt, return null. A missed price is far better than a wrong one.

STRICT MATCHING RULES — every applicable criterion must match:
1. Brand/manufacturer must match (e.g. if searching for Sony, reject Samsung, LG, Bose, etc.)
2. Model name/number must match (e.g. if searching for WH-1000XM5, reject WH-1000XM4 or WF-1000XM5)
3. Product category must match exactly — an accessory, attachment, or add-on is NOT the same as the main product.
   (e.g. if searching for a string trimmer, reject a trimmer attachment or blade; if searching for headphones, reject a TV)
4. Key specs must match when specified — size, capacity, speed, color, variant, generation, power source, etc.
   Examples: 32GB ≠ 16GB; CL30 ≠ CL36; DDR5 ≠ DDR4; 65" ≠ 55"; M3 ≠ M2; gas ≠ electric/battery/brushless
5. Kit configuration and form factor must match exactly:
   - A 4x32GB kit is NOT the same as a 1x128GB single module, even though both total 128GB.
   - LRDIMM ≠ RDIMM ≠ UDIMM ≠ ECC ≠ SO-DIMM — these are different form factors, not interchangeable.
   - If searching for a single stick (1x128GB) and the page shows a kit (4x32GB), return {"price": null, "note": "kit, not single module"}.
   - If searching for LRDIMM and the page shows UDIMM or RDIMM, return {"price": null, "note": "wrong form factor"}.

PRICE RULES:
- Return the CURRENT SELLING PRICE — what a customer pays today (the "Add to Cart" / "Buy Now" price).
- If the item is ON SALE, return the SALE PRICE (the lower/discounted price), NOT the original/was/MSRP price.
- If multiple colors/sizes exist and prices vary, return the LOWEST available price and note the range (e.g. "From $107.93, varies by color").
- Put the original/list price in the note if useful: e.g. "Sale price (was $145.00)".

Return {"price": null, "note": "not found"} if:
- The brand is different
- The model is a different variant or generation
- The product is a completely different category or is an accessory/attachment
- The page shows multiple products (listing/search/category page)

Return {"price": null, "note": "category page"} for search results, category listings, or pages with no single product.
Return {"price": null, "note": "price not visible"} if the page is the right product but the price isn't in the text.

Do NOT return prices for accessories, extended warranties, bundles, or related items.
Do NOT guess — only return a price you can see written in the page content below.

Page content:
${truncated}`,
          }],
        }),
      }) as Promise<Response>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("extract timeout")), EXTRACT_TIMEOUT_MS)
      ),
    ]);
  } catch {
    return { price: null, note: "extraction timeout" };
  }
  if (!res.ok) return { price: null, note: "extraction failed" };
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  try {
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { price: parsed.price ?? null, note: parsed.note ?? null };
    }
  } catch { /* fall through */ }
  return { price: null, note: "parse error" };
}

// ─── Product-page URL patterns per store ─────────────────────────────────────
const PRODUCT_URL_PATTERNS: Record<string, (url: string) => boolean> = {
  "amazon.com": (url) => /amazon\.com\/.*\/dp\/[A-Z0-9]{10}/.test(url),
  "bestbuy.com": (url) => /bestbuy\.com\/site\/.*\/\d+\.p/.test(url),
  "walmart.com": (url) => /walmart\.com\/ip\//.test(url),
  "target.com": (url) => /target\.com\/p\//.test(url),
  "newegg.com": (url) => /newegg\.com\/p\//.test(url) || /newegg\.com\/.*\/Item\.aspx/.test(url),
  "bhphotovideo.com": (url) => /bhphotovideo\.com\/c\/product\//.test(url),
  "costco.com": (url) => /costco\.com\/.*\.product\.\d+\.html/.test(url),
  "ebay.com": (url) => /ebay\.com\/itm\//.test(url),
  "dickssportinggoods.com": (url) => /dickssportinggoods\.com\/p\//.test(url),
  "footlocker.com": (url) => /footlocker\.com\/product\//.test(url),
  "nike.com": (url) => /nike\.com\/t\//.test(url),
};

const CATEGORY_PATTERNS = [
  "/search", "/browse", "/category", "?q=", "?k=", "?query=",
  "/s?", "/c/", "/shop/", "/b/", "/sch/", "/deals/", "/list/",
];

function isProductPage(url: string, domain: string): boolean {
  const lower = url.toLowerCase();
  if (CATEGORY_PATTERNS.some((p) => lower.includes(p))) return false;
  const checker = PRODUCT_URL_PATTERNS[domain];
  return checker ? checker(url) : true;
}

// ─── Tool: check_product_exists ──────────────────────────────────────────────
async function handleCheckProductExists(args: {
  product: string;
}): Promise<{ found: boolean; results: string[]; suggestion: string }> {
  const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });
  try {
    const searchResults = await tavilyClient.search(`${args.product} buy`, {
      maxResults: 5,
      searchDepth: "basic",
    });
    const titles = searchResults.results.map((r) => r.title).filter(Boolean);
    const found = titles.length > 0;
    return {
      found,
      results: titles.slice(0, 5),
      suggestion: found
        ? "Product appears to exist at retail. Proceed with get_item_prices."
        : "No matching products found. Ask the user to adjust their specs.",
    };
  } catch {
    return { found: false, results: [], suggestion: "Search failed. Proceed cautiously or ask user to retry." };
  }
}

// ─── Tool: get_item_prices ────────────────────────────────────────────────────
async function handleGetItemPrices(args: {
  product: string;
  stores: string[];
  apiKey: string;
  sendStatus: (msg: string) => void;
}): Promise<StoreResult[]> {
  const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });
  const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
  const { product, stores, apiKey, sendStatus } = args;

  // Purchase-intent query surfaces product pages over category pages
  const searchQuery = `${product} buy`;

  const storeList = stores.join(", ");
  sendStatus(`Searching ${storeList} for "${product}"…`);

  const results = await Promise.all(
    stores.map(async (store): Promise<StoreResult> => {
      try {
        const domain = storeDomain(store);

        const searchResults = await tavilyClient.search(searchQuery, {
          maxResults: 10,
          searchDepth: "basic",
          includeDomains: [domain],
        });

        const ranked = [...searchResults.results].sort((a, b) => {
          const aIsProduct = isProductPage(a.url, domain) ? 1 : 0;
          const bIsProduct = isProductPage(b.url, domain) ? 1 : 0;
          return bIsProduct - aIsProduct;
        });

        const productCandidates = ranked.filter((r) => isProductPage(r.url, domain));
        const candidates = productCandidates.length > 0 ? productCandidates : ranked;

        if (candidates.length === 0) {
          return { store, price: "N/A", url: "", available: false, note: "Not found in search" };
        }

        sendStatus(`Loading product pages from ${store}…`);

        // Scrape top 5 candidates in parallel; fall back to Tavily snippet on timeout.
        // CANDIDATE_TIMEOUT_MS is a hard cap on the entire per-candidate operation
        // (scrape + extract), so slow OpenRouter calls can't stall the whole search.
        const SCRAPE_TIMEOUT_MS = 8000;
        const CANDIDATE_TIMEOUT_MS = 15000;
        const topCandidates = candidates.slice(0, 5);
        const scrapeResults = await Promise.all(
          topCandidates.map(async (candidate) => {
            try {
              return await Promise.race([
                (async () => {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const scraped = await Promise.race([
                      firecrawl.scrapeUrl(candidate.url, { formats: ["markdown"] }) as Promise<any>,
                      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("scrape timeout")), SCRAPE_TIMEOUT_MS)),
                    ]);
                    const pageContent: string = scraped?.markdown ?? candidate?.content ?? "";
                    if (!pageContent || pageContent.length < 100) return null;
                    sendStatus(`Reading price from ${store}…`);
                    const { price, note } = await extractPriceWithLLM(product, store, pageContent, apiKey);
                    return { price, note, url: candidate.url };
                  } catch {
                    // Scrape failed/timed out — try Tavily snippet as fallback
                    const snippet: string = candidate?.content ?? "";
                    if (snippet && snippet.length >= 80) {
                      const { price, note } = await extractPriceWithLLM(product, store, snippet, apiKey).catch(() => ({ price: null, note: null }));
                      if (price) return { price, note, url: candidate.url };
                    }
                    return null;
                  }
                })(),
                new Promise<null>((resolve) =>
                  setTimeout(() => resolve(null), CANDIDATE_TIMEOUT_MS)
                ),
              ]);
            } catch {
              return null;
            }
          })
        );

        // Return first candidate that has a price (preserving ranked order)
        const winner = scrapeResults.find((r) => r?.price);
        if (winner) {
          return { store, price: winner.price!, url: winner.url, available: true, note: winner.note ?? undefined };
        }
        const lastNote = scrapeResults.filter(Boolean).pop()?.note ?? null;
        return { store, price: "N/A", url: "", available: false, note: lastNote ?? "Price not found" };
      } catch (err) {
        console.error(`Error fetching price for ${store}:`, err);
        return { store, price: "N/A", url: "", available: false, note: "Search error" };
      }
    })
  );

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function storeDomain(store: string): string {
  const map: Record<string, string> = {
    amazon: "amazon.com",
    "best buy": "bestbuy.com",
    walmart: "walmart.com",
    target: "target.com",
    costco: "costco.com",
    "b&h": "bhphotovideo.com",
    "b&h photo": "bhphotovideo.com",
    newegg: "newegg.com",
    ebay: "ebay.com",
    "home depot": "homedepot.com",
    lowes: "lowes.com",
    apple: "apple.com",
    "microsoft store": "microsoft.com",
    "lowe's": "lowes.com",
    samsung: "samsung.com",
    "samsung.com": "samsung.com",
    "tractor supply": "tractorsupply.com",
    "tractor supply co": "tractorsupply.com",
    "tractor supply co.": "tractorsupply.com",
    "dick's sporting goods": "dickssportinggoods.com",
    "dicks sporting goods": "dickssportinggoods.com",
    "dicks": "dickssportinggoods.com",
    "foot locker": "footlocker.com",
    "footlocker": "footlocker.com",
    "nike": "nike.com",
    "nike.com": "nike.com",
    "rei": "rei.com",
  };
  return map[store.toLowerCase()] ?? `${store.toLowerCase().replace(/\s+/g, "")}.com`;
}

// ─── Main route handler ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(
      sseEvent({ error: "OPENROUTER_API_KEY is not configured.", priceResult: null, updatedStores: [] }),
      { status: 500, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { messages, stores: savedStores } = await req.json() as {
    messages: ChatMessage[];
    stores: string[];
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };
      const sendStatus = (msg: string) => send({ status: msg });

      try {
        const systemContent =
          AGENT_SYSTEM_PROMPT +
          (savedStores.length > 0
            ? `\n\nThe user's saved stores are: ${savedStores.join(", ")}.`
            : "");

        const allMessages: Array<ChatMessage | Record<string, unknown>> = [
          { role: "system", content: systemContent },
          ...messages,
        ];

        const MAX_ITERATIONS = 8;
        let updatedStores: string[] = [...savedStores];
        let lastPriceResults: StoreResult[] | null = null;

        sendStatus("Thinking about your request…");

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const response = await fetch(OPENROUTER_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://price-hunter.vercel.app",
              "X-Title": "PriceHunter",
            },
            body: JSON.stringify({
              model: MODEL,
              messages: allMessages,
              tools: PRICE_TOOLS,
              tool_choice: "auto",
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            let errBody: { error?: { code?: number; message?: string } } = {};
            try { errBody = JSON.parse(errText); } catch { /* ignore */ }
            const code = errBody?.error?.code;
            const userMsg =
              code === 403
                ? "Something in the conversation triggered a content filter. Could you rephrase or try a slightly different search?"
                : `Search service error — please try again. (${response.status})`;
            send({ error: userMsg, priceResult: null, updatedStores });
            controller.close();
            return;
          }

          const data = await response.json();
          const assistantMsg = data.choices[0].message;
          allMessages.push(assistantMsg);

          if (!assistantMsg.tool_calls?.length) {
            const content: string = assistantMsg.content ?? "";
            let priceResult: PriceComparisonResult | null = null;
            const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
              try { priceResult = JSON.parse(jsonMatch[1]); } catch { /* ignore */ }
            }
            // Override results array with actual scraper data — never trust LLM-generated URLs/prices
            if (priceResult && lastPriceResults) {
              priceResult.results = lastPriceResults;
            }
            if (priceResult) sendStatus("Tallying up the results…");
            send({
              content: priceResult ? priceResult.summary : content,
              priceResult,
              updatedStores,
            });
            controller.close();
            return;
          }

          const toolResults = await Promise.all(
            assistantMsg.tool_calls.map(async (tc: {
              id: string;
              function: { name: string; arguments: string };
            }) => {
              const args = JSON.parse(tc.function.arguments);
              let result: unknown;

              if (tc.function.name === "update_store_list") {
                sendStatus("Picking the best stores to check…");
                result = handleUpdateStoreList(args);
                updatedStores = (result as { stores: string[] }).stores;
              } else if (tc.function.name === "check_product_exists") {
                sendStatus("Looking up current models…");
                result = await handleCheckProductExists(args);
              } else if (tc.function.name === "get_item_prices") {
                result = await handleGetItemPrices({ ...args, apiKey, sendStatus });
                lastPriceResults = result as StoreResult[];
                sendStatus("Comparing prices…");
              } else {
                result = { error: `Unknown tool: ${tc.function.name}` };
              }

              return { role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) };
            })
          );

          allMessages.push(...toolResults);
        }

        send({ content: "I hit my search limit — try a more specific product name?", priceResult: null, updatedStores });
      } catch (err) {
        send({ error: String(err), priceResult: null, updatedStores: savedStores });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
