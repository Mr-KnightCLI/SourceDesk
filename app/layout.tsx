import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title:"SourceDesk — Document workspace",
  description:"Ask your documents questions and trace every answer back to the source.",
};
export default function Layout({children}: Readonly<{children:React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
