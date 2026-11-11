/** Normalize document links only; the main process still checks the session's allowed roots. */
export function localFileLink(href: string): string | undefined {
  let target: string;
  try { target = decodeURIComponent(href.trim()); } catch { return; }
  if (/^file:\/\//i.test(target)) {
    target = target.replace(/^file:\/\/(?:localhost)?\//i, '/').replace(/^\/([a-z]:[\\/])/i, '$1');
  }
  target = target.replace(/#.*$/, '').replace(/:(\d+)(?::\d+)?$/, '');
  if (!target || /\0/.test(target) || (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target))) return;
  return /\.(docx?|pdf|xlsx?|ods|pptx?|odp|md|markdown|mdx|txt|[cm]?js|jsx|tsx?|py|cs|c|cpp|h|hpp|java|kt|go|rs|rb|php|swift|sh|ps1|jsonl?|ya?ml|toml|ini|conf|cfg|env|xml|html?|css|sql|tex|csv|tsv|log|png|jpe?g|gif|webp|avif|svg|bmp|ico|mp3|wav|ogg|m4a|flac|mp4|webm|mov)$/i.test(target) ? target : undefined;
}
