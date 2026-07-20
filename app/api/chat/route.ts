import { NextRequest, NextResponse } from "next/server";
import { GENERAL_SYSTEM_PROMPT } from "@/lib/tools";
import { ChatMessage } from "@/lib/types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-3-haiku";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured on the server." }, { status: 500 });
  }

  const { messages } = await req.json() as { messages: ChatMessage[] };

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
      messages: [{ role: "system", content: GENERAL_SYSTEM_PROMPT }, ...messages],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  const data = await response.json();
  return NextResponse.json({ content: data.choices[0].message.content });
}
