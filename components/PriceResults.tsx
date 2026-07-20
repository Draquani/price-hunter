"use client";

import { PriceComparisonResult } from "@/lib/types";
import { useState, useEffect } from "react";

interface Props {
  result: PriceComparisonResult;
}

export default function PriceResults({ result }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const query = encodeURIComponent(result.product_image_query || result.product_name);
    fetch(`/api/product-image?q=${query}`)
      .then((r) => r.json())
      .then((d) => { if (d.url) setImageUrl(d.url); })
      .catch(() => {});
  }, [result.product_name, result.product_image_query]);

  const availableResults = result.results.filter((r) => r.available && r.price !== "N/A");
  const cheapest = availableResults.length
    ? availableResults.reduce((a, b) => {
        const aPrice = parseFloat(a.price.replace(/[$,]/g, ""));
        const bPrice = parseFloat(b.price.replace(/[$,]/g, ""));
        return aPrice < bPrice ? a : b;
      })
    : null;

  return (
    <div className="mt-3 rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-white/10 backdrop-blur-sm">
      <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30">
        {imageUrl && (
          <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-white/20 border border-white/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={result.product_name} className="w-full h-full object-cover" onError={() => setImageUrl(null)} />
          </div>
        )}
        <div>
          <p className="text-xs font-semibold text-fuchsia-300 uppercase tracking-wider mb-1">Price Comparison</p>
          <h3 className="text-white font-bold text-base leading-snug">{result.product_name}</h3>
          {cheapest && (
            <p className="text-emerald-300 text-sm font-semibold mt-1">🏆 Best price: {cheapest.price} at {cheapest.store}</p>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/10 border-b border-white/10">
              <th className="text-left px-4 py-2.5 text-white/60 font-semibold uppercase text-xs tracking-wider">Store</th>
              <th className="text-left px-4 py-2.5 text-white/60 font-semibold uppercase text-xs tracking-wider">Price</th>
              <th className="text-left px-4 py-2.5 text-white/60 font-semibold uppercase text-xs tracking-wider">Link</th>
              <th className="text-left px-4 py-2.5 text-white/60 font-semibold uppercase text-xs tracking-wider">Note</th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((row, i) => {
              const isBest = cheapest?.store === row.store && row.available;
              return (
                <tr key={i} className={`border-b border-white/5 transition-colors ${isBest ? "bg-emerald-500/10" : "hover:bg-white/5"}`}>
                  <td className="px-4 py-3 text-white font-medium">
                    <span className="flex items-center gap-2">{isBest && <span className="text-emerald-400">★</span>}{row.store}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-bold text-base ${row.available ? (isBest ? "text-emerald-300" : "text-white") : "text-white/30"}`}>{row.price}</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.url ? (
                      <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-fuchsia-300 hover:text-fuchsia-200 underline underline-offset-2 text-xs truncate max-w-[160px] block">View product →</a>
                    ) : (
                      <span className="text-white/30 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/50 text-xs italic">{row.note ?? (row.available ? "" : "Not available")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
