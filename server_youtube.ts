/**
 * YANTRI — Server-side YouTube search (agent-free playback).
 *
 * Scrapes YouTube search results exactly like the /api/youtube-search proxy
 * in server.ts, but is reusable from tool handlers so Gemini can play a song
 * without any Python agent. The frontend receives a { type: "playYouTube" }
 * event and renders the video in the holographic browser's embedded player.
 */

const YT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36";

export interface YouTubeResult {
  videoId: string;
  title: string;
  thumbnail: string;
  author: string;
  duration: string;
  views: string;
}

export async function searchYouTubeVideos(query: string, limit = 10): Promise<YouTubeResult[]> {
  const q = (query || "").trim();
  if (!q) return [];

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&sp=EgIQAQ%253D%253D`;
  const response = await fetch(searchUrl, {
    headers: { "User-Agent": YT_UA },
  });
  const html = await response.text();

  const videoList: YouTubeResult[] = [];

  const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      const contents =
        data?.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer
          ?.contents?.[0]?.itemSectionRenderer?.contents;
      if (Array.isArray(contents)) {
        for (const item of contents) {
          const vr = item?.videoRenderer;
          const vId = vr?.videoId;
          if (vId) {
            videoList.push({
              videoId: vId,
              title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || "YouTube Video",
              thumbnail: `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`,
              author:
                vr.ownerText?.runs?.[0]?.text ||
                vr.shortBylineText?.runs?.[0]?.text ||
                "Unknown Channel",
              duration: vr.lengthText?.simpleText || "N/A",
              views: vr.viewCountText?.simpleText || "N/A",
            });
          }
        }
      }
    } catch {
      /* fall through to regex */
    }
  }

  if (videoList.length === 0) {
    const videoRegex = /"videoId":"([^"]+)"/g;
    let match;
    const ids: string[] = [];
    while ((match = videoRegex.exec(html)) !== null && ids.length < limit) {
      const id = match[1];
      if (id && !ids.includes(id)) ids.push(id);
    }
    for (const id of ids) {
      videoList.push({
        videoId: id,
        title: `YouTube Video`,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        author: "YouTube Creator",
        duration: "N/A",
        views: "Available Now",
      });
    }
  }

  return videoList.slice(0, limit);
}

/** First video id for a query, or null when nothing was found. */
export async function findFirstYouTubeVideo(query: string): Promise<string | null> {
  const results = await searchYouTubeVideos(query, 5);
  return results[0]?.videoId || null;
}
