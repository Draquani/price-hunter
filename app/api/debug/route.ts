import { NextResponse } from "next/server";

// Temporary debug endpoint — DELETE after confirming env vars work
export async function GET() {
  return NextResponse.json({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? `set (starts with ${process.env.OPENROUTER_API_KEY.slice(0, 8)}...)` : "MISSING",
    TAVILY_API_KEY: process.env.TAVILY_API_KEY ? `set (starts with ${process.env.TAVILY_API_KEY.slice(0, 8)}...)` : "MISSING",
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY ? `set (starts with ${process.env.FIRECRAWL_API_KEY.slice(0, 8)}...)` : "MISSING",
  });
}
