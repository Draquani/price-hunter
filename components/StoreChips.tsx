"use client";

interface Props {
  stores: string[];
  onRemove: (store: string) => void;
}

export default function StoreChips({ stores, onRemove }: Props) {
  if (stores.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2 bg-white/5 border-b border-white/10">
      <span className="text-white/40 text-xs self-center">Saved stores:</span>
      {stores.map((store) => (
        <span key={store} className="flex items-center gap-1 bg-violet-500/20 text-violet-200 text-xs font-medium px-2.5 py-1 rounded-full border border-violet-400/30">
          {store}
          <button onClick={() => onRemove(store)} className="ml-1 text-violet-300/60 hover:text-white transition-colors leading-none" aria-label={`Remove ${store}`}>×</button>
        </span>
      ))}
    </div>
  );
}
