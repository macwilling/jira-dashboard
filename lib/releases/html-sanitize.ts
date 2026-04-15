/**
 * Allowlist sanitizer matching Google Calendar's supported description HTML.
 * Google renders: <a href>, <b>, <i>, <u>, <br>, <ul>, <ol>, <li>. Everything
 * else is stripped on their side, so we strip it here too — the preview then
 * shows what the user will actually see in Calendar, not what they typed.
 *
 * Text content is HTML-escaped. <a> keeps only href, and only when the URL
 * uses a safe scheme (http/https/mailto) to avoid javascript: self-XSS.
 */

const ALLOWED_TAGS = new Set(["a", "b", "i", "u", "br", "ul", "ol", "li"]);

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isSafeHref(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim());
}

function sanitizeTag(raw: string): string {
  const closing = raw.startsWith("</");
  const selfClosing = raw.endsWith("/>");
  const body = raw.slice(closing ? 2 : 1, selfClosing ? -2 : -1).trim();
  const spaceIdx = body.search(/\s/);
  const name = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase();

  if (!ALLOWED_TAGS.has(name)) return "";
  if (closing) return `</${name}>`;
  if (name === "br") return "<br>";

  if (name === "a") {
    const m = body.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    const href = m ? m[1] ?? m[2] ?? m[3] ?? "" : "";
    if (!href || !isSafeHref(href)) return "<a>";
    return `<a href="${escapeText(href)}" target="_blank" rel="noopener noreferrer">`;
  }

  return `<${name}>`;
}

export function sanitizeCalendarHtml(input: string): string {
  if (!input) return "";
  const tagRegex = /<\/?[a-zA-Z][^>]*>/g;
  let result = "";
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(input)) !== null) {
    result += escapeText(input.slice(lastIdx, match.index));
    result += sanitizeTag(match[0]);
    lastIdx = match.index + match[0].length;
  }
  result += escapeText(input.slice(lastIdx));
  return result;
}
