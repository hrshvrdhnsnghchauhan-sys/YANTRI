/**
 * YANTRI — Server-native Weather & News (agent-free).
 *
 * Ports of agent/tools/weather.py and agent/tools/news.py so "aaj mausam
 * kaisa hai" / "aaj ki news batao" work on ANY deployment — cloud, APK
 * webview, or desktop-without-agent. Both services are keyless public HTTP
 * (wttr.in, Google News RSS), exactly as the Python tools use them.
 *
 * Result shapes intentionally match the Python tools so prompts/results
 * behave identically whichever backend executes them.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Weather (wttr.in JSON) — mirrors agent/tools/weather.py
// ---------------------------------------------------------------------------

export interface WeatherOutput {
  result: string;
  location: string;
  temperature?: string;
  description?: string;
  humidity?: string;
  wind_speed?: string;
}

export async function getWeatherServer(args: {
  location?: string;
}): Promise<WeatherOutput> {
  const location = (args.location || "").toString().trim() || "Mumbai";
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;

  let data: any;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`wttr.in returned status ${res.status}`);
    data = await res.json();
  } catch (e: any) {
    throw new Error(`Failed to fetch weather: ${e?.message || e}`);
  }

  const curr = data?.current_condition?.[0];
  if (!curr) throw new Error("Failed to fetch weather: empty response from wttr.in");

  const tempC = curr.temp_C;
  const feels = curr.FeelsLikeC;
  const desc = curr.weatherDesc?.[0]?.value;
  const humidity = curr.humidity;
  const wind = curr.windspeedKmph;

  return {
    result: `Weather in ${location}: ${desc}, ${tempC}°C (feels like ${feels}°C). Humidity: ${humidity}%, Wind: ${wind} km/h.`,
    location,
    temperature: String(tempC),
    description: desc,
    humidity: String(humidity),
    wind_speed: String(wind),
  };
}

// ---------------------------------------------------------------------------
// News (Google News RSS) — mirrors agent/tools/news.py
// ---------------------------------------------------------------------------

const RSS_URLS: Record<string, string> = {
  top: "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
  tech: "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-IN&gl=IN&ceid=IN:en",
  world: "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en-IN&gl=IN&ceid=IN:en",
  india: "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFZxYUdjU0FtVnVHZ0pWVXlnQVAB?hl=en-IN&gl=IN&ceid=IN:en",
  sports: "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB?hl=en-IN&gl=IN&ceid=IN:en",
  business: "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-IN&gl=IN&ceid=IN:en",
};

export interface NewsOutput {
  result: string;
  headlines: { title: string; link: string }[];
  category: string;
  count: number;
}

export async function getNewsServer(args: {
  category?: string;
  count?: number;
}): Promise<NewsOutput> {
  const category = (args.category || "top").toString().trim().toLowerCase();
  const count = Math.min(Math.max(1, Number(args.count) || 5), 15);
  const url = RSS_URLS[category] || RSS_URLS.top;

  let xml: string;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Google News RSS returned status ${res.status}`);
    xml = await res.text();
  } catch (e: any) {
    throw new Error(`Failed to fetch news: ${e?.message || e}`);
  }

  const headlines: { title: string; link: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null && headlines.length < count) {
    const item = m[1];
    const title = unescapeXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").trim();
    const link = unescapeXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "").trim();
    if (title) headlines.push({ title, link });
  }

  if (headlines.length === 0) {
    throw new Error("Failed to fetch news: no headlines found in the RSS feed.");
  }

  const summary = headlines
    .map((h, i) => `${i + 1}. ${h.title}`)
    .join("\n");

  return {
    result: `Top ${headlines.length} headlines:\n${summary}`,
    headlines,
    category: RSS_URLS[category] ? category : "top",
    count: headlines.length,
  };
}

function unescapeXml(s: string): string {
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
