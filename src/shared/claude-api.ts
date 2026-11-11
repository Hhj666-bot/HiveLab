/** Validate explicitly configured API roots before a credential can be sent. */
export function normalizeClaudeBaseUrl(value: unknown): string {
  if (value === undefined) return '';
  const message = 'Claude API 地址必须是完整的 HTTPS 根地址，不含账户密码、查询参数、片段或 /v1/messages；留空使用官方服务。';
  if (typeof value !== 'string') throw new Error(message);
  const trimmed = value.trim();
  if (!trimmed) return '';
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error(message); }
  if (!/^https:\/\//i.test(trimmed) || url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || /[\\\s]/.test(trimmed)) throw new Error(message);
  // Claude Code appends /v1/messages itself. Accept the common pasted /v1 suffix.
  const pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (/\/v1\/messages$/i.test(pathname)) throw new Error(message);
  return url.origin + pathname;
}
