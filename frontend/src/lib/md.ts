/*
 * Markdown -> HTML renderer for streamed assistant output.
 *
 * Handles: headings, bold, italic, strikethrough, code (inline + fenced),
 * blockquotes, ordered/unordered lists (with continuation across
 * intervening blocks), horizontal rules, links, tables (standard markdown
 * AND model quirks like <br> within cells, || row separators, lines
 * starting with | but not ending with one, and bullet markers leaking
 * into cells).
 *
 * Tables are wrapped in a horizontally scrollable container so wide tables
 * never break the chat bubble layout.
 *
 * `<br>` handling:
 *   We do NOT split table rows on `<br>`. The model often packs multiple
 *   bullets into a single cell using `<br>` to keep the row on one line
 *   like `| Liver disease | • A<br>• B<br>• C |`. If we converted `<br>`
 *   to `\n` up front we'd shred the row across many lines, leaving stray
 *   pipes leaking into the body. Instead we replace `<br>` with a sentinel
 *   character that survives line-splitting and is re-emitted as a real
 *   `<br>` only inside the final HTML.
 *
 * Ordered list continuity:
 *   When an ordered list gets interrupted (by a bullet sub-list, a
 *   paragraph, etc.) the model usually intends the next "1." / "2." block
 *   to keep counting from the previous list, not restart at 1. We track
 *   the running `<li>` count and reopen the next OL with `start=N` so the
 *   numbering continues.
 */

const BR_SENTINEL = "\u0001";

export function renderMarkdown(src: string): string {
  // 1. Replace <br> / <br/> with a sentinel that survives line splitting.
  let text = src.replace(/<br\s*\/?>/gi, BR_SENTINEL);

  // 2. Normalize "||" used by some models as row separators into real newlines.
  text = text.replace(/\|\|\s*\n?/g, "|\n|");

  // 3. Escape HTML entities (sentinel is harmless / preserved).
  text = escapeHtml(text);

  // 4. Fenced code blocks (before line-by-line).
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
  // Running count of <li>s emitted to ordered lists. Reopening an OL uses
  // start=olCount+1 so numbering continues across interrupting blocks.
  let olCount = 0;

  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${inlineMd(paraBuf.join(" "))}</p>`);
      paraBuf = [];
    }
  };
  const closeUL = () => {
    if (inUL) { out.push("</ul>"); inUL = false; }
  };
  const closeOL = () => {
    if (inOL) { out.push("</ol>"); inOL = false; }
  };
  const closeLists = () => {
    closeUL();
    closeOL();
  };
  const resetOLCount = () => {
    // Called when we reach a "real" structural break (heading, hr, table,
    // blockquote, fenced code) so the *next* "1." truly starts a new list.
    olCount = 0;
  };
  const closeBQ = () => {
    if (inBQ) { out.push("</blockquote>"); inBQ = false; }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table></div>");
      inTable = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Fenced code passthrough
    if (line.startsWith("<pre>") || line.startsWith("</pre>") || line.includes("<code>")) {
      flushPara(); closeLists(); closeBQ(); closeTable(); resetOLCount();
      out.push(line);
      continue;
    }

    // Empty line — soft break; do NOT reset olCount so a numbered list can
    // resume after a blank line / sub-list.
    if (line.trim() === "") {
      flushPara(); closeLists(); closeBQ(); closeTable();
      continue;
    }

    const trimmed = line.trim();

    // Horizontal rule (early - dashes can look like table separators).
    if (/^-{3,}$|^_{3,}$|^\*{3,}$|^~{3,}$/.test(trimmed)) {
      flushPara(); closeLists(); closeBQ(); closeTable(); resetOLCount();
      out.push("<hr/>");
      continue;
    }

    // Headings — hard break, reset numbering.
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); closeLists(); closeBQ(); closeTable(); resetOLCount();
      out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`);
      continue;
    }

    // Blockquote
    if (/^&gt;\s?/.test(line)) {
      flushPara(); closeLists(); closeTable(); resetOLCount();
      if (!inBQ) { out.push("<blockquote>"); inBQ = true; }
      out.push(`<p>${inlineMd(line.replace(/^&gt;\s?/, ""))}</p>`);
      continue;
    }
    closeBQ();

    // Unordered list (-, *, •) — check BEFORE tables so bullet lines that
    // happen to contain `|` aren't mistaken for table rows.
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara(); closeTable();
      // Close any open OL but DO NOT reset olCount — if a numbered list
      // resumes after these bullets, it should keep counting.
      closeOL();
      if (!inUL) { out.push("<ul>"); inUL = true; }
      out.push(`<li>${inlineMd(ul[1])}</li>`);
      continue;
    }

    // Ordered list — continue from olCount when reopening.
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara(); closeTable();
      closeUL();
      if (!inOL) {
        const start = olCount + 1;
        out.push(start === 1 ? "<ol>" : `<ol start="${start}">`);
        inOL = true;
      }
      olCount += 1;
      out.push(`<li>${inlineMd(ol[1])}</li>`);
      continue;
    }

    // Table detection — line starts with `|` and contains at least 2 pipes.
    if (isTableRow(trimmed)) {
      flushPara(); closeLists(); closeBQ(); resetOLCount();
      const cells = parseTableCells(trimmed);

      // Skip separator rows (---|---) including those with colons for alignment.
      if (cells.length > 0 && cells.every((c) => /^[-:\s]*$/.test(c) && c.length > 0)) {
        continue;
      }

      if (!inTable) {
        out.push('<div class="md-table-wrap"><table><thead><tr>');
        out.push(cells.map((c) => `<th>${renderCell(c)}</th>`).join(""));
        out.push('</tr></thead><tbody>');
        inTable = true;
      } else {
        out.push('<tr>');
        out.push(cells.map((c) => `<td>${renderCell(c)}</td>`).join(""));
        out.push('</tr>');
      }
      continue;
    }

    // Not a table row — close any open table.
    closeTable();

    // Plain prose line. Closes any list (since we're moving to paragraph
    // context) but keeps olCount so a list further down can resume.
    closeLists();
    paraBuf.push(line);
  }

  flushPara();
  closeLists();
  closeBQ();
  closeTable();

  return out.join("\n");
}

/** A line counts as a table row only if it starts with `|` AND has >= 2 pipes. */
function isTableRow(line: string): boolean {
  if (!line.startsWith("|")) return false;
  return (line.match(/\|/g) || []).length >= 2;
}

/** Strip leading/trailing pipes and split on `|`. */
function parseTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/**
 * Render a single table cell. Bullet-flavoured cells (multiple `•` items
 * separated by the BR sentinel) become a real `<ul class="md-cell-list">`
 * inside the cell. Otherwise sentinels collapse to `<br>` for in-cell line
 * breaks.
 */
function renderCell(cell: string): string {
  const parts = cell.split(BR_SENTINEL).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  if (parts.length === 1) return inlineMd(stripCellPrefix(parts[0]));

  const allBullet = parts.every((p) => /^[-*•]\s+/.test(p));
  if (allBullet) {
    const items = parts
      .map((p) => `<li>${inlineMd(stripCellPrefix(p))}</li>`)
      .join("");
    return `<ul class="md-cell-list">${items}</ul>`;
  }
  return parts.map((p) => inlineMd(stripCellPrefix(p))).join("<br/>");
}

/** Strip a leading bullet marker (`-`, `*`, `•`) from a cell fragment. */
function stripCellPrefix(s: string): string {
  return s.replace(/^\s*[-*•]\s+/, "").trim();
}

function inlineMd(s: string): string {
  // Inline code
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // Strikethrough
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // Italic
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  // Links
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`
  );
  // Strip stray `|` characters used as inline separators outside tables.
  s = s.replace(/\|{2,}/g, "|");
  s = s.replace(/\s+\|\s+/g, " — ");
  s = s.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*$/, "");
  s = s.replace(/^\s*—\s*/, "").replace(/\s*—\s*$/, "");
  // Surviving sentinels (non-cell contexts) become inline line breaks.
  s = s.replace(new RegExp(BR_SENTINEL, "g"), "<br/>");
  // Strip leftover decorative tilde runs.
  s = s.replace(/~{3,}/g, "");
  return s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
