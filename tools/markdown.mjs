const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?!\s)(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
}

// Supports paragraphs, line breaks, **bold**, *italic*, [links](https://…), "- " lists and "> " quotes.
export function markdownToHtml(markdown) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n[ \t]*\n/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (lines.every((l) => /^\s*>/.test(l))) {
        return `<blockquote><p>${lines.map((l) => inline(l.replace(/^\s*>\s?/, ""))).join("<br>")}</p></blockquote>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("\n");
}
