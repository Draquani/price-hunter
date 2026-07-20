import { NextRequest, NextResponse } from "next/server";
import { tavily } from "@tavily/core";
import FirecrawlApp from "@mendable/firecrawl-js";
import { PRICE_TOOLS, AGENT_SYSTEM_PROMPT } from "@/lib/tools";
import { ChatMessage, PriceComparisonResult, StoreResult } from "@/lib/types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-3.5-sonnet";

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });

function handleUpdateStoreList(args: {
  stores: string[];
  suggested_additions?: string[];
}): { stores: string[]; suggested_additions: string[]; message: string } {
  return {
    stores: args.stores,
    suggested_additions: args.suggested_additions ?? [],
    message: `Store list saved: ${args.stores.join(", ")}${
      args.suggested_additions?.length
        ? `. Suggested additions: ${args.suggested_additions.join(", ")}`
        : ""
    }`,
  };
}

async function handleGetItemPrices(args: {
  product: string;
  stores: string[];
}): Promise<StoreResult[]> {
  const { product, stores } = args;

  const results = await Promise.all(
    stores.map(async (store): Promise<StoreResult> => {
      try {
        const searchQuery = `${product} price site:${storeDomain(store)} OR "${store}" "${product}"`;
        const searchResults = await tavilyClient.search(searchQuery, {
          maxResults: 3,
          searchDepth: "basic",
        });

        const productUrl = searchResults.results[0]?.url ?? null;

        if (!productUrl) {
          return { store, price: "N/A", url: "", available: false, note: "Not found in search" };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scraped = await firecrawl.scrapeUrl(productUrl, { formats: ["markdown"] }) as any;

        if (!scraped?.markdown) {
          const snippet = searchResults.results[0]?.content ?? "";
          const price = extractPriceFromText(snippet);
          return {
            store,
            price: price ?? "N/A",
            url: productUrl,
            available: !!price,
            note: price ? "Price from search snippet" : "Could not scrape page",
          };
        }

        const price = extractPriceFromText(scraped.markdown as string);

        return {
          store,
          price: price ?? "N/A",
          url: productUrl,
          available: !!price,
          note: price ? undefined : "Price not found on page",
        };
      } catch (err) {
        console.error(`Error fetching price for ${store}:`, err);
        return { store, price: "N/A", url: "", available: false, note: "Search error" };
      }
    })
  );

  return results;
}

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
  };
  return map[store.toLowerCase()] ?? `${store.toLowerCase().replace(/\\s+/g, "")}.com`;
}

function extractPriceFromText(text: string): string | null {
  const match = text.match(/\\$\\s*[\\d,]+(?:\\.\\d{2})?/);
  return match ? match[0].replace(/\\s/, "") : null;
}

export async function POST(req: NextRequest) {
  const { messages, stores: savedStores } = await req.json() as {
    messages: ChatMessage[];
    stores: string[];
  };

  const systemContent =
    AGENT_SYSTEM_PROMPT +
    (savedStores.length > 0
      ? `\n\nThe user's saved stores are: ${savedStores.join(", ")}. Use these when calling get_item_prices unless they specify otherwise.`
      : "");

  const allMessages: Array<ChatMessage | Record<string, unknown>> = [
    { role: "system", content: systemContent },
    ...messages,
  ];

  const MAX_ITERATIONS = 8;
  let updatedStores: string[] = [...savedStores];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
      const err = await response.text();
      return NextResponse.json({ error: `LLM API error: ${err}` }, { status: 500 });
    }

    const data = await response.json();
    const choice = data.choices[0];
    const assistantMsg = choice.message;

    allMessages.push(assistantMsg);

    if (!assistantMsg.tool_calls?.length) {
      const content: string = assistantMsg.content ?? "";
      let priceResult: PriceComparisonResult | null = null;
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try { priceResult = JSON.parse(jsonMatch[1]); } catch { }
      }
      return NextResponse.json({ content: priceResult ? priceResult.summary : content, priceResult, updatedStores });
    }

    const toolResults = await Promise.all(
      assistantMsg.tool_calls.map(async (tc: { id: string; function: { name: string; arguments: string } }) => {
        const args = JSON.parse(tc.function.arguments);
        let result: unknown;
        if (tc.function.name === "update_store_list") {
          result = handleUpdateStoreList(args);
          updatedStores = (result as { stores: string[] }).stores;
        } else if (tc.function.name === "get_item_prices") {
          result = await handleGetItemPrices(args);
        } else {
          result = { error: `Unknown tool: ${tc.function.name}` };
        }
        return { role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) };
      })
    );

    allMessages.push(...toolResults);
  }

  return NextResponse.json({
    content: "I hit my search limit on that one — try narrowing down the product name or stores?",
    priceResult: null,
    updatedStores,
  });
}
