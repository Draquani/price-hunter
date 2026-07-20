// Tool definitions as JSON schemas passed to the LLM via OpenRouter tool-use pattern.
// The LLM decides when to call these; the server executes them.

export const PRICE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "update_store_list",
      description:
        "Save or update the list of stores the user wants to compare prices at. Call this whenever the user mentions stores they want to use. Also suggest 1-2 additional relevant stores if the user has fewer than 3.",
      parameters: {
        type: "object",
        properties: {
          stores: {
            type: "array",
            items: { type: "string" },
            description: 'List of store names to save, e.g. ["Amazon", "Best Buy", "Walmart"]',
          },
          suggested_additions: {
            type: "array",
            items: { type: "string" },
            description: "Optional: stores you recommend the user also consider, beyond what they listed",
          },
        },
        required: ["stores"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_item_prices",
      description:
        "Search for the current price of a product at each store in the store list. This searches each store's website and scrapes the actual product page for an accurate, up-to-date price. Call this once you have confirmed the product name and the stores to search.",
      parameters: {
        type: "object",
        properties: {
          product: {
            type: "string",
            description: 'The full product name to search for, e.g. "Sony WH-1000XM5 Wireless Headphones"',
          },
          stores: {
            type: "array",
            items: { type: "string" },
            description: "List of store names to search",
          },
        },
        required: ["product", "stores"],
      },
    },
  },
];

export const AGENT_SYSTEM_PROMPT = `You are PriceHunter, a helpful and witty price comparison assistant with a subtle sense of humor. Your specialty is hunting down the best deals so users don't have to.

WORKFLOW:
1. When a user asks to compare prices for a product, identify the product and ask which stores they want to check (require at least 2). You may suggest popular online stores.
2. Once you have stores, call update_store_list to save them.
3. Then call get_item_prices with the product name and the saved store list.
4. After receiving the price data, respond with a JSON block in this EXACT format — no other text before or after:

\`\`\`json
{
  "product_name": "Full product name",
  "product_image_query": "concise image search query for the product",
  "results": [
    {
      "store": "Store Name",
      "price": "$X.XX",
      "url": "https://direct-product-page-url",
      "available": true,
      "note": "optional note e.g. 'Prime deal' or 'limited stock'"
    }
  ],
  "summary": "A brief, witty summary of the findings highlighting the best deal. Mention if you spotted other stores worth checking."
}
\`\`\`

If a store doesn't carry the item or no price was found, set available to false and price to \"N/A\".

For ANY question not related to product prices (greetings, general questions, help, etc.), respond naturally WITHOUT calling any tools.`;

export const GENERAL_SYSTEM_PROMPT = `You are PriceHunter, a friendly assistant with a subtle sense of humor. You specialize in price comparison but are happy to chat. Keep responses concise.`;
