export type Passage = { location: string; excerpt: string };

export class UserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const maxBytes = 10 * 1024 * 1024;
export const supported = /\.(pdf|docx|txt|md|markdown)$/i;

type WordNode = { type: string; styleId?: string; styleName?: string; value?: string; children?: WordNode[] };

function wordText(node: WordNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type === "tab") return "\t";
  if (node.type === "break") return "\n";
  return (node.children ?? []).map(wordText).join("");
}

function wordPassages(root: WordNode) {
  const passages: Passage[] = [];
  let heading = "";
  let paragraph = 0;
  function visit(node: WordNode) {
    if (node.type !== "paragraph") {
      node.children?.forEach(visit);
      return;
    }
    paragraph++;
    const excerpt = wordText(node).trim();
    if (!excerpt) return;
    if (/^heading\s*[1-9]$/i.test(node.styleName ?? node.styleId ?? "")) heading = excerpt.slice(0,160);
    passages.push({excerpt,location:(heading ? heading + " · " : "") + "Paragraph " + paragraph});
  }
  visit(root);
  return passages;
}

export function split(passages: Passage[]) {
  return passages.flatMap(({ location, excerpt }) => {
    const chunks: Passage[] = [];
    let start = 0;
    while (start < excerpt.length) {
      const limit = start + 1400;
      const space = excerpt.lastIndexOf(" ", limit);
      const end = limit >= excerpt.length ? excerpt.length : space > start + 900 ? space : limit;
      const text = excerpt.slice(start, end).trim();
      if (text) chunks.push({ location, excerpt: text });
      if (end === excerpt.length) break;
      start = end - 150;
    }
    return chunks;
  });
}

export async function extract(name: string, data: Buffer): Promise<Passage[]> {
  if (!supported.test(name)) throw new UserError("Upload a PDF, DOCX, TXT, or Markdown file.", 415);
  if (data.length > maxBytes) throw new UserError("This file exceeds the 10 MB limit.", 413);
  try {
    if (/\.pdf$/i.test(name)) {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true });
      try {
        const pdf = await task.promise;
        if (pdf.numPages > 300) throw new UserError("PDFs can contain at most 300 pages.");
        const pages: Passage[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const { items } = await page.getTextContent();
          const excerpt = items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
          if (excerpt) pages.push({ location: "Page " + i, excerpt });
          page.cleanup();
        }
        if (!pages.length) throw new UserError("This PDF has no extractable text. Scanned documents require OCR, which SourceDesk does not currently support.");
        return pages;
      } finally { await task.destroy(); }
    }
    if (/\.docx$/i.test(name)) {
      const mammoth = await import("mammoth");
      let passages: Passage[] = [];
      await mammoth.convertToHtml({buffer:data},{
        externalFileAccess:false,
        ignoreEmptyParagraphs:false,
        transformDocument(root: WordNode) {
          passages = wordPassages(root);
          return root;
        },
        convertImage: mammoth.images.imgElement(async () => ({src:""})),
      });
      if (!passages.length) throw new UserError("The document has no readable text.");
      return passages;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (/\.(md|markdown)$/i.test(name)) {
      let heading = "";
      const passages: Passage[] = [];
      let lines: string[] = [];
      let start = 1;
      function flush() {
        const excerpt = lines.join("\n").trim();
        if (excerpt) passages.push({excerpt,location:(heading?heading+" · ":"")+"Line "+start});
        lines = [];
      }
      text.split(/\r?\n/).forEach((line,i)=>{
        const title = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
        if (!line.trim() || title) flush();
        if (title) heading = title[1].slice(0,160);
        if (line.trim()) {
          if (!lines.length) start = i+1;
          lines.push(line);
        }
      });
      flush();
      if (!passages.length) throw new UserError("The document has no readable text.");
      return passages;
    }
    const passages = text.split(/\r?\n\s*\r?\n/).map((excerpt, i) => ({ excerpt: excerpt.trim(), location: "Paragraph " + (i + 1) })).filter(p => p.excerpt);
    if (!passages.length) throw new UserError("The document has no readable text.");
    return passages;
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError("The document could not be parsed. Check that it opens and is not password protected.");
  }
}
