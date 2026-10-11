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

async function searchDuckDuckGoFallback(query: string, maxResults = 8): Promise<TavilySearchResult> {
  try {
    const response = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Web search fallback HTTP error: ${response.status}`);
    }

    const html = await response.text();
    const linkMatches = [...html.matchAll(/<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi)];
    const snippetMatches = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)];

    const results = linkMatches.slice(0, maxResults).map((m, i) => {
      const rawTitle = m[2].replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim();
      const rawSnippet = snippetMatches[i] ? snippetMatches[i][1].replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim() : "";
      return {
        title: rawTitle || "Web Search Result",
        url: m[1],
        content: rawSnippet,
        score: Math.max(0.1, 1.0 - (i * 0.1)),
      };
    });

    return {
      query,
      answer: results.length > 0 ? `Found ${results.length} relevant web sources for "${query}".` : `No direct web search results found for "${query}".`,
      results,
    };
  } catch (err: any) {
    return {
      query,
      answer: `Web search for "${query}" completed with error: ${err?.message || err}`,
      results: [],
    };
  }
}

/**
 * Perform a search using Tavily API, with seamless keyless fallback.
 */
export async function searchTavily(options: TavilySearchOptions): Promise<TavilySearchResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return searchDuckDuckGoFallback(options.query, options.max_results || 8);
  }

  try {
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
      console.warn(`[Tavily] Status ${response.status}, falling back to web search.`);
      return searchDuckDuckGoFallback(options.query, options.max_results || 8);
    }

    const data = await response.json() as TavilySearchResult;
    return data;
  } catch (err) {
    console.warn("[Tavily] Search failed, falling back to web search:", err);
    return searchDuckDuckGoFallback(options.query, options.max_results || 8);
  }
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