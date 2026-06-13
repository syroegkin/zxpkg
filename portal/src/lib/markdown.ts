// Minimal markdown -> HTML for first-party content/*.md — the single source shared
// by the website (these helpers) and the gopher mirror (gopher-compiler md2gopher).
// Trusted input (our own docs), so the renderer is small: headings, paragraphs,
// -/*/N. lists, fenced code, and inline **strong** *em* `code` [text](url).

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inlineHtml(s: string): string {
  let t = esc(s); // escape first, then apply markup to the escaped text
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, url) =>
    /^(https?:\/\/|\/|#)/.test(url) ? `<a href="${esc(url)}">${txt}</a>` : txt); // safe schemes only
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/_([^_]+)_/g, "<em>$1</em>");
  return t;
}

export function md2html(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: "ul" | "ol" | null = null;
  let code: string[] | null = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inlineHtml(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flush = () => { flushPara(); flushList(); };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.trim().startsWith("```")) {
      if (code) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; }
      else { flush(); code = []; }
      continue;
    }
    if (code) { code.push(raw); continue; }
    const line = raw.trim();
    if (line === "") { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); const n = Math.min(h[1].length, 6); out.push(`<h${n}>${inlineHtml(h[2])}</h${n}>`); continue; }
    const li = /^([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const want: "ul" | "ol" = li[1] === "-" || li[1] === "*" ? "ul" : "ol";
      if (list && list !== want) flushList();
      if (!list) { out.push(`<${want}>`); list = want; }
      out.push(`<li>${inlineHtml(li[2])}</li>`);
      continue;
    }
    if (list && out.length && out[out.length - 1].endsWith("</li>")) {
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, " " + inlineHtml(line) + "</li>");
    } else {
      para.push(line);
    }
  }
  if (code) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flush();
  return out.join("\n");
}

// Extract the "## FAQ" Q/A pairs (### question + following text) for FAQPage JSON-LD.
export function parseFaq(md: string): { q: string; a: string }[] {
  const faq: { q: string; a: string }[] = [];
  let inFaq = false, q: string | null = null, a: string[] = [];
  const push = () => { if (q) faq.push({ q, a: a.join(" ").trim() }); q = null; a = []; };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) { push(); inFaq = /faq/i.test(h2[1]); continue; }
    if (!inFaq) continue;
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) { push(); q = h3[1]; continue; }
    if (q && line) a.push(line);
  }
  push();
  return faq;
}
