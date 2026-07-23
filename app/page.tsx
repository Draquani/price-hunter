"use client";

import { useState, useRef, useEffect } from "react";
import { AppMessage, ChatMessage } from "@/lib/types";
import PriceResults from "@/components/PriceResults";
import StoreChips from "@/components/StoreChips";

const DEFAULT_STATUS = "On the hunt…";

function uid() { return Math.random().toString(36).slice(2); }

const WELCOME: AppMessage = {
  id: "welcome",
  role: "assistant",
  content: `👋 Hey there! I'm **PriceHunter** — your personal bargain bloodhound.\n\nTell me what product you're looking for and which stores you want to compare, and I'll dig up the latest prices faster than you can say "free shipping."\n\nNot sure where to shop? I can suggest stores too. Just say the word.`,
  timestamp: Date.now(),
};

function PawIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#fb923c" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="6" cy="5.5" rx="1.7" ry="2.2" />
      <ellipse cx="10.5" cy="3.8" rx="1.5" ry="2" />
      <ellipse cx="15" cy="4.2" rx="1.5" ry="2" />
      <ellipse cx="19" cy="6.5" rx="1.6" ry="2.1" />
      <path d="M12 8.5c-3.5 0-6.5 2.5-6.5 5.5 0 2 1 3.5 2.5 4.5.8.5 1.7.8 2.5 1h3c.8-.2 1.7-.5 2.5-1 1.5-1 2.5-2.5 2.5-4.5 0-3-3-5.5-6.5-5.5z" />
    </svg>
  );
}

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
  const [loadingStatus, setLoadingStatus] = useState(DEFAULT_STATUS);
  const [savedStores, setSavedStores] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("ph_stores");
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showInstructions, setShowInstructions] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { localStorage.setItem("ph_stores", JSON.stringify(savedStores)); }, [savedStores]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    const userMsg: AppMessage = { id: uid(), role: "user", content: text, timestamp: Date.now() };
    const searchStart = Date.now();
    const loadingId = uid();
    setMessages((prev) => [...prev, userMsg, { id: loadingId, role: "assistant", content: "", isLoading: true, timestamp: searchStart }]);
    setIsLoading(true);
    setLoadingStatus(DEFAULT_STATUS);
    const history: ChatMessage[] = messages
      .filter((m) => m.id !== "welcome" && !m.isLoading)
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: text });
    try {
      const res = await fetch("/api/price-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, stores: savedStores }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status) {
              setLoadingStatus(data.status);
            } else {
              if (data.updatedStores?.length) setSavedStores(data.updatedStores);
              const assistantMsg: AppMessage = {
                id: uid(), role: "assistant",
                content: data.content ?? data.error ?? "Something went wrong.",
                priceResult: data.priceResult ?? undefined,
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev.filter((m) => m.id !== loadingId), assistantMsg]);
            }
          } catch { /* malformed line */ }
        }
      }
    } catch {
      setMessages((prev) => [...prev.filter((m) => m.id !== loadingId), { id: uid(), role: "assistant", content: "Network error — please try again." }]);
    } finally {
      setIsLoading(false);
      setLoadingStatus(DEFAULT_STATUS);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const removeStore = (store: string) => setSavedStores((prev) => prev.filter((s) => s !== store));

  const downloadSnapshot = () => {
    const now = Date.now();
    const lines: string[] = [`PriceHunter Debug Snapshot — ${new Date(now).toISOString()}`, "=".repeat(60), ""];
    let lastUserSendTime: number | null = null;
    messages.forEach((m) => {
      if (m.id === "welcome") return;
      const ts = m.timestamp ? new Date(m.timestamp).toISOString() : "unknown";
      lines.push(`[${m.role.toUpperCase()}] ${ts}`);
      if (m.role === "user") {
        lastUserSendTime = m.timestamp ?? null;
      }
      if (m.role === "assistant" && m.timestamp && lastUserSendTime && m.priceResult) {
        const elapsed = ((m.timestamp - lastUserSendTime) / 1000).toFixed(1);
        lines.push(`⏱  Search completed in ${elapsed}s`);
      }
      lines.push(m.content || "(loading)");
      if (m.priceResult) {
        lines.push("");
        lines.push(`Product: ${m.priceResult.product_name}`);
        m.priceResult.results.forEach((r) => {
          lines.push(`  ${r.store}: ${r.price}${r.note ? ` (${r.note})` : ""} — ${r.url}`);
        });
      }
      lines.push("");
    });
    lines.push(`Saved stores: ${savedStores.join(", ") || "none"}`);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pricehunter-snapshot-${now}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-violet-950 to-fuchsia-950 flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-800 to-indigo-900 flex items-center justify-center shadow-lg">
            <PawIcon className="w-5 h-5" />
          </div>
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
              { step: "1", icon: "🛍️", title: "Name your product", desc: "Any product — electronics, appliances, toys, tools. Be specific: brand, model, size, color." },
              { step: "2", icon: "🏪", title: "Pick your stores", desc: "Name 2+ stores, or ask me to suggest the best ones for your product. I'll remember them." },
              { step: "3", icon: "📊", title: "Get live prices", desc: "I search each store and scrape the real current price — no guessing, no stale data." },
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
          <p className="text-white/30 text-xs mt-3">💡 Prices are always fetched live — never from training data.</p>
        </div>
      )}
      {savedStores.length > 0 && <div className="mx-4 mt-3"><StoreChips stores={savedStores} onRemove={removeStore} /></div>}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-5 max-w-3xl w-full mx-auto">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-800 to-indigo-900 flex items-center justify-center flex-shrink-0 mt-1 mr-2 shadow">
                <PawIcon className="w-4 h-4" />
              </div>
            )}
            <div className={msg.role === "user" ? "max-w-[75%]" : "flex-1 min-w-0"}>
              <div className={`rounded-2xl px-4 py-3 ${msg.role === "user" ? "bg-gradient-to-br from-fuchsia-600 to-violet-600 text-white rounded-br-sm shadow-lg" : "bg-white/10 text-white/90 rounded-bl-sm backdrop-blur-sm border border-white/10"}`}>
                {msg.isLoading ? (
                  <div className="flex items-center gap-2 text-white/50">
                    <span className="animate-bounce inline-block w-1.5 h-1.5 bg-fuchsia-400 rounded-full" style={{ animationDelay: "0ms" }} />
                    <span className="animate-bounce inline-block w-1.5 h-1.5 bg-fuchsia-400 rounded-full" style={{ animationDelay: "150ms" }} />
                    <span className="animate-bounce inline-block w-1.5 h-1.5 bg-fuchsia-400 rounded-full" style={{ animationDelay: "300ms" }} />
                    <span className="text-xs ml-1">{loadingStatus}</span>
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
              {["Sony WH-1000XM5 headphones", "Apple MacBook Air M3 13-inch", "Suggest stores for PC parts"].map((s) => (
                <button key={s} onClick={() => setInput(s)} className="text-xs text-white/50 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition-all">{s}</button>
              ))}
            </div>
          )}
          <div className="flex gap-3 items-end">
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Name any product to compare prices across stores…" rows={1}
              className="flex-1 bg-white/10 text-white placeholder-white/30 rounded-xl px-4 py-3 resize-none border border-white/20 focus:outline-none focus:border-fuchsia-400/60 focus:bg-white/15 transition-all text-sm leading-relaxed"
              style={{ minHeight: "48px", maxHeight: "120px" }}
              onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }} />
            <button onClick={sendMessage} disabled={!input.trim() || isLoading} className="w-12 h-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 hover:from-fuchsia-400 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white shadow-lg transition-all active:scale-95 flex-shrink-0">
              {isLoading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>}
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-white/20 text-xs">Prices fetched live via Tavily + Firecrawl · Enter to send · Shift+Enter for new line</p>
            <button onClick={downloadSnapshot} title="Download debug snapshot" className="text-white/20 hover:text-white/60 transition-colors flex items-center gap-1 text-xs ml-3 flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0118.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              snapshot
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
