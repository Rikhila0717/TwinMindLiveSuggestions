/*
 * Tiny markdown → HTML renderer for streamed assistant output.
 */

export function renderMarkdown(src: string): string {
  // Normalize model-emitted <br> / <br/> tags to actual newlines before escaping.
  let text = src.replace(/<br\s*\/?>/gi, "\n");
  text = escapeHtml(text);

  text = text.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_m, _lang, body) => `<pre><code>${body}</code></pre>`
  );

  const lines = text.split("\n");
  const out: string[] = [];
  let inUL = false;
  let inOL = false;
  let inBQ = false;
  let inTable = false;
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${inlineMd(paraBuf.join(" "))}</p>`);
      paraBuf = [];
    }
  };
  const closeLists = () => {
    if (inUL) {
      out.push("</ul>");
      inUL = false;
    }
    if (inOL) {
      out.push("</ol>");
      inOL = false;
    }
  };
  const closeBQ = () => {
    if (inBQ) {
      out.push("</blockquote>");
      inBQ = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("<pre>") || line.startsWith("</pre>") || line.includes("<code>")) {
      flushPara();
      closeLists();
      closeBQ();
      out.push(line);
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      closeLists();
      closeBQ();
      closeTable();
      continue;
    }
    // Markdown table row: starts and ends with |, or has | separators
    if (/^\|(.+)\|$/.test(line.trim())) {
      flushPara();
      closeLists();
      closeBQ();
      const trimmed = line.trim();
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      // Skip separator rows (e.g. |---|---|)
      if (cells.every((c) => /^[-:\s]+$/.test(c))) {
        continue;
      }
      if (!inTable) {
        out.push('<table><thead><tr>');
        out.push(cells.map((c) => `<th>${inlineMd(c)}</th>`).join(""));
        out.push('</tr></thead><tbody>');
        inTable = true;
      } else {
        out.push('<tr>');
        out.push(cells.map((c) => `<td>${inlineMd(c)}</td>`).join(""));
        out.push('</tr>');
      }
      continue;
    }
    if (/^-{3,}$|^_{3,}$|^\*{3,}$/.test(line.trim())) {
      flushPara();
      closeLists();
      closeBQ();
      out.push("<hr/>");
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeLists();
      closeBQ();
      out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      flushPara();
      closeLists();
      if (!inBQ) {
        out.push("<blockquote>");
        inBQ = true;
      }
      out.push(`<p>${inlineMd(line.replace(/^&gt;\s?/, ""))}</p>`);
      continue;
    }
    closeBQ();
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (inOL) {
        out.push("</ol>");
        inOL = false;
      }
      if (!inUL) {
        out.push("<ul>");
        inUL = true;
      }
      out.push(`<li>${inlineMd(ul[1])}</li>`);
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (inUL) {
        out.push("</ul>");
        inUL = false;
      }
      if (!inOL) {
        out.push("<ol>");
        inOL = true;
      }
      out.push(`<li>${inlineMd(ol[1])}</li>`);
      continue;
    }
    closeLists();
    paraBuf.push(line);
  }

  flushPara();
  closeLists();
  closeBQ();
  closeTable();

  return out.join("\n");
}

function inlineMd(s: string): string {
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`
  );
  return s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
