/**
 * YANTRI — Server-native Tavily Search (agent-free).
 *
 * Tavily provides AI-powered search with summarization. This module
 * enables high-quality web search on ANY deployment — cloud, server-only,
 * or desktop-without-agent. Works identically to the desktop agent's
 * search tools but with better results via Tavily's API.
 */

import { generateText } from "./server_llm_fallback";

export interface TavilySearchResult {
  query: string;
  answer: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
  images?: Array<{
    url: string;
    description: string;
  }>;
}

export interface TavilySearchOptions {
  query: string;
  search_depth?: "basic" | "advanced";
  topic?: "general" | "news" | "finance";
  days?: number;
  max_results?: number;
  include_images?: boolean;
  include_answer?: boolean;
  include_raw_content?: boolean;
}

/**
 * Perform a search using Tavily API.
 */
export async function searchTavily(options: TavilySearchOptions): Promise<TavilySearchResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY environment variable is not set");
  }

  const {
    query,
    search_depth = "advanced",
    topic = "general",
    days = 7,
    max_results = 10,
    include_images = false,
    include_answer = true,
    include_raw_content = false,
  } = options;

  const payload = {
    api_key: apiKey,
    query,
    search_depth,
    topic,
    days,
    max_results,
    include_images,
    include_answer,
    include_raw_content,
  };

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Tavily API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as TavilySearchResult;
  return data;
}

/**
 * Format Tavily results for the AI response.
 */
export function formatTavilyResult(result: TavilySearchResult): string {
  let output = `Search results for: "${result.query}"\n\n`;

  if (result.answer) {
    output += `AI Summary: ${result.answer}\n\n`;
  }

  if (result.results && result.results.length > 0) {
    output += "Sources:\n";
    result.results.forEach((r, i) => {
      output += `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content.slice(0, 300)}...\n\n`;
    });
  }

  if (result.images && result.images.length > 0) {
    output += "Images:\n";
    result.images.forEach((img, i) => {
      output += `${i + 1}. ${img.description || "Image"} - ${img.url}\n`;
    });
  }

  return output.trim();
}

/**
 * Search and get a concise answer (for quick responses).
 */
export async function searchTavilyQuick(query: string): Promise<string> {
  const result = await searchTavily({
    query,
    search_depth: "basic",
    max_results: 5,
    include_answer: true,
  });
  return formatTavilyResult(result);
}

/**
 * Deep research search with advanced options.
 */
export async function searchTavilyDeep(query: string): Promise<string> {
  const result = await searchTavily({
    query,
    search_depth: "advanced",
    max_results: 15,
    include_answer: true,
    include_raw_content: false,
  });
  return formatTavilyResult(result);
}