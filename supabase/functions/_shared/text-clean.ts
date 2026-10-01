/**
 * Strip HTML/markup from a description and cap its length. Schema.org JSON-LD
 * descriptions on venue sites often contain raw WordPress markup, captions,
 * inline styles, and embed shortcodes — none of which belong in a feed card.
 */
export function cleanText(raw: string | null | undefined, maxLen = 500): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\[caption[\s\S]*?\[\/caption\]/gi, "")
    .replace(/\[\/?\w+[^\]]*\]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#?\w+;/g, "")
    .replace(/https?:\/\/\S+/g, "") // strip raw URLs that escaped tag stripping
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).trim() + "…";
}
