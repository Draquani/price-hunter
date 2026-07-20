"use client";

import { useState, useRef, useEffect } from "react";
import { AppMessage, ChatMessage } from "@/lib/types";
import PriceResults from "@/components/PriceResults";
import StoreChips from "@/components/StoreChips";

function isPriceQuestion(text: string): boolean {
  const keywords = [
    "price", "cost", "how much", "cheapest", "cheap", "expensive",
    "compare", "buy", "purchase", "deal", "discount", "sale",
    "store", "shop", "amazon", "walmart", "best buy", "target",
    "order", "shipping", "available", "find me",
  ];
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function uid() {
  return Math.random().toString(36).slice(2);
}

const WELCOME: AppMessage = {
  id: "welcome",
  role: "assistant",
  content: `👋 Hey there! I'm **PriceHunter** — your personal bargain bloodhound.\n\nTell me what product you're looking for and which stores you want to compare, and I'll dig up the latest prices faster than you can say "free shipping."\n\nNot sure where to shop? I can suggest stores too. Just say the word. 🐾`,
};

function formatMessage(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code class="bg-white/10 px-1 rounded text-fuchsia-300 text-xs">$1</code>')
    .replace(/\n/g, "<br/>");
}

export default function Home() {
  const [messages, setMessages] = useState<AppMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [savedStores, setSavedStores] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("ph_stores");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [showInstructions, setShowInstructions] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    localStorage.setItem("ph_stores", JSON.stringify(savedStores));
  }, [savedStores]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");

    const userMsg: AppMessage = { id: uid(), role: "user", content: text };
    const loadingId = uid();
    const loadingMsg: AppMessage = { id: loadingId, role: "assistant", content: "", isLoading: true };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setIsLoading(true);

    const history: ChatMessage[] = messages
      .filter((m) => m.id !== "welcome" && !m.isLoading)
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: text });

    try {
      const endpoint = isPriceQuestion(text) ? "/api/price-search" : "/api/chat";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, stores: savedStores }),
      });
      const data = await res.json();

      if (data.updatedStores && data.updatedStores.length > 0) {
        setSavedStores(data.updatedStores);
      }

      const assistantMsg: AppMessage = {
        id: uid(),
        role: "assistant",
        content: data.content ?? data.error ?? "Something went wrong.",
        priceResult: data.priceResult ?? undefined,
      };

      setMessages((prev) => [...prev.filter((m) => m.id !== loadingId), assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== loadingId),
        { id: uid(), role: "assistant", content: "Network error — please try again." },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const removeStore = (store: string) => {
    setSavedStores((prev) => prev.filter((s) => s !== store));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-violet-950 to-fuchsia-950 flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center text-lg shadow-lg">🐾</div>
          <div>
            <h1 className="text-white font-bold text-lg leading-none">PriceHunter</h1>
            <p className="text-white/40 text-xs">AI-powered price comparison</p>
          </div>
        </div>
        <button onClick={() => setShowInstructions(!showInstructions)} className="text-white/50 hover:text-white text-sm flex items-center gap-1.5 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10">
          {showInstructions ? "✕ Close" : "? How it works"}
        </button>
      </header>

      {showInstructions && (
        <div className="mx-4 mt-4 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-white/20 p-5 backdrop-blur-sm">
          <h2 className="text-white font-bold text-base mb-3 flex items-center gap-2"><span>🗺️</span> How PriceHunter Works</h2>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            {[
              { step: "1", icon: "🛍️", title: "Name your product", desc: 'Tell me what you\'re shopping for, e.g. "Compare prices for AirPods Pro"' },
              { step: "2", icon: "🏪", title: "Pick your stores", desc: "Give me 2+ stores, or ask me to suggest some. I'll remember them for next time." },
              { step: "3", icon: "📊", title: "Get live prices", desc: "I search and scrape each store's website for the current price and show a comparison table." },
            ].map(({ step, icon, title, desc }) => (
              <div key={step} className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-fuchsia-500/30 text-fuchsia-200 text-xs font-bold flex items-center justify-center">{step}</span>
                  <span className="text-lg">{icon}</span>
                  <span className="text-white font-semibold text-sm">{title}</span>
                </div>
                <p className="text-white/50 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <p className="text-white/30 text-xs mt-3">💡 Non-price questions skip the search tools entirely.</p>
        </div>
      )}

      {savedStores.length > 0 && (
        <div className="mx-4 mt-3"><StoreChips stores={savedStores} onRemove={removeStore} /></div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-5 max-w-3xl w-full mx-auto">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center text-sm flex-shrink-0 mt-1 mr-2 shadow">🐾</div>
            )}
            <div className={msg.role === "user" ? "max-w-[75%]" : "flex-1 min-w-0"}>
              <div className={`rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-gradient-to-br from-fuchsia-600 to-violet-600 text-white rounded-br-sm shadow-lg"
                  : "bg-white/10 text-white/90 rounded-bl-sm backdrop-blur-sm border border-white/10"
              }`}>
                {msg.isLoading ? (
                  <div className="flex items-center gap-2 text-white/50">
                    <span className="animate-bounce inline-block w-1.5 h-1.5 bg-fuchsia-400 rounded-full" style={{ animationDelay: "0ms" }} />
                    <span className="animate-bounce inline-block w-1.5 h-1.5 bg-fuchsia-400 rounded-full" style={{ animationDelay: "150ms" }} />
                    <span className="animate-bounce inline-block w-1.5 h-1.5 bg-fuchsia-400 rounded-full" style={{ animationDelay: "300ms" }} />
                    <span className="text-xs ml-1">Hunting prices…</span>
                  </div>
                ) : (
                  <div className="prose prose-invert prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }} />
                )}
              </div>
              {msg.priceResult && <PriceResults result={msg.priceResult} />}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <div className="sticky bottom-0 bg-black/30 backdrop-blur-md border-t border-white/10 px-4 py-4">
        <div className="max-w-3xl mx-auto">
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {["Compare Sony WH-1000XM5 at Amazon and Best Buy", "Find the cheapest MacBook Air M3", "Suggest some stores to compare prices"].map((s) => (
                <button key={s} onClick={() => setInput(s)} className="text-xs text-white/50 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition-all">{s}</button>
              ))}
            </div>
          )}
          <div className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me to compare prices, or just chat…"
              rows={1}
              className="flex-1 bg-white/10 text-white placeholder-white/30 rounded-xl px-4 py-3 resize-none border border-white/20 focus:outline-none focus:border-fuchsia-400/60 focus:bg-white/15 transition-all text-sm leading-relaxed"
              style={{ minHeight: "48px", maxHeight: "120px" }}
              onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }}
            />
            <button onClick={sendMessage} disabled={!input.trim() || isLoading} className="w-12 h-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 hover:from-fuchsia-400 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white shadow-lg transition-all active:scale-95 flex-shrink-0">
              {isLoading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              )}
            </button>
          </div>
          <p className="text-white/20 text-xs mt-2 text-center">Prices fetched live via Tavily + Firecrawl · Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
