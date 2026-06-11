export type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  description: string;
};

type NewsFeed = {
  name: string;
  url: string;
};

const googleNewsBase = "https://news.google.com/rss/search";

const newsFeeds: NewsFeed[] = [
  {
    name: "ge",
    url: `${googleNewsBase}?q=${encodeURIComponent("Copa do Mundo 2026 site:ge.globo.com")}&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
  },
  {
    name: "ESPN",
    url: `${googleNewsBase}?q=${encodeURIComponent("Copa do Mundo 2026 site:espn.com.br")}&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
  },
  {
    name: "FIFA",
    url: `${googleNewsBase}?q=${encodeURIComponent("Copa do Mundo 2026 site:fifa.com")}&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
  },
];

function decodeXml(value: string) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .trim();
}

function stripHtml(value: string) {
  return decodeXml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  return items.map((item) => {
    const title = stripHtml(readTag(item, "title"));
    const link = readTag(item, "link");
    const publishedAt = readTag(item, "pubDate");
    const description = stripHtml(readTag(item, "description"));

    return {
      title,
      link,
      source,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
      description,
    };
  }).filter((item) => item.title && item.link);
}

export async function getLatestNews(limit = 12) {
  const results = await Promise.allSettled(
    newsFeeds.map(async (feed) => {
      const response = await fetch(feed.url, { next: { revalidate: 15 * 60 } });
      if (!response.ok) throw new Error(`Feed ${feed.name} returned ${response.status}`);
      return parseRss(await response.text(), feed.name);
    }),
  );

  return results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => {
      const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, limit);
}
