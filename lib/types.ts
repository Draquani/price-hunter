export interface StoreResult {
  store: string;
  price: string;
  url: string;
  available: boolean;
  note?: string;
}

export interface PriceComparisonResult {
  product_name: string;
  product_image_query: string;
  results: StoreResult[];
  summary: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AppMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  priceResult?: PriceComparisonResult;
  isLoading?: boolean;
}
