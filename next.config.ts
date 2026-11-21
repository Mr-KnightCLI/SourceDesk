import type { NextConfig } from "next";
const config: NextConfig = { serverExternalPackages: ["pg","pdfjs-dist","mammoth"] };
export default config;
