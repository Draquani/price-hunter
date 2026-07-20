import { NextRequest, NextResponse } from "next/server";
import { tavily } from "@tavily/core";

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q) return NextResponse.json({ url: null });

  try {
    const results = await tavilyClient.search(`${q} product photo`, {
      maxResults: 3,
      searchDepth: "basic",
      includeImages: true,
    });
    const imageUrl = results.images?.[0] ?? null;
    return NextResponse.json({ url: imageUrl });
  } catch {
    return NextResponse.json({ url: null });
  }
}
