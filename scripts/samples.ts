import { mkdir, writeFile } from "node:fs/promises";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { makePdf } from "../test/fixture";
import { samples } from "../lib/demo";

async function main() {
  await mkdir("public/samples",{recursive:true});
  await writeFile("public/samples/"+samples[0].name,await makePdf([
    "STANDARD SUPPORT\nService terms and cancellation.",
    samples[0].excerpt.replace(". The ",".\nThe "),
    samples[0].cancellation.replace("’","'"),
  ]));
  const doc = new Document({sections:[{children:[
    new Paragraph({text:"Support commitments",heading:HeadingLevel.HEADING_1}),
    new Paragraph(samples[1].excerpt),
    new Paragraph({text:"Cancellation",heading:HeadingLevel.HEADING_1}),
    new Paragraph(samples[1].cancellation),
  ]}]});
  await writeFile("public/samples/"+samples[1].name,await Packer.toBuffer(doc));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
