import { readFile } from "node:fs/promises";
import path from "node:path";
import LegacyBootstrap from "./LegacyBootstrap";

async function readLegacyBodyHtml(): Promise<string> {
  const filePath = path.join(process.cwd(), "src", "index.html");
  const html = await readFile(filePath, "utf8");

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) {
    throw new Error("src/index.html에서 body를 찾을 수 없습니다.");
  }

  return bodyMatch[1]
    .replace(/<script[^>]*src=["']\.\/main\.ts["'][^>]*><\/script>/gi, "")
    .trim();
}

export default async function Page() {
  const legacyBodyHtml = await readLegacyBodyHtml();

  return (
    <>
      <LegacyBootstrap />
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: legacyBodyHtml }} />
    </>
  );
}
