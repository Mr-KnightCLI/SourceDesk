import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg","pdfjs-dist","mammoth","@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-*/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};
export default config;
