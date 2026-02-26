export function toCsvDownloadText(csvText: string): string {
  const normalized = csvText.replace(/\r?\n/g, "\r\n");
  return `\ufeff${normalized}`;
}
