import { PDFDocument, StandardFonts } from "pdf-lib";

export async function makePdf(pages: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage();
    lines.split("\n").forEach((line, i) => page.drawText(line, {font, size:12, x:50, y:750-22*i}));
  }
  return Buffer.from(await pdf.save());
}
