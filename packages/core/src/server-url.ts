/** A device must address the backend, not its own localhost. Keep credentials out of URLs. */
export function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('接続先のHTTPS URLを入力してください。');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(
      'HTTPSのサーバーURLを入力してください。パス・認証情報・クエリは含めないでください。',
    );
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    host === '[::]' ||
    /^127\./.test(host) ||
    host === '0.0.0.0' ||
    host.startsWith('[::ffff:')
  )
    throw new Error(
      'iPhoneから届くサーバーのHTTPS URLが必要です。localhostやループバックIPは使えません。',
    );
  return url.origin;
}
