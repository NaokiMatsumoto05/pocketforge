// Only this read-only health request is retried. Writes must never be replayed automatically.
export async function probeServer(
  origin: string,
  { request = fetch, timeoutMs = 120000, retryMs = 3000 } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    while (!controller.signal.aborted) {
      let response: Response | undefined;
      let health: any;
      try {
        response = await request(origin + '/api/health', {
          credentials: 'omit',
          signal: controller.signal,
          redirect: 'error',
        });
        health = await response.json();
      } catch {
        /* A sleeping service may return a temporary HTML page or close the connection. */
      }
      if (response?.ok && health?.service === 'pocketforge' && health.status === 'ok')
        return {
          origin,
          version: String(health.version),
          registrationAllowed: Boolean(health.registrationAllowed),
        };
      if (
        response &&
        ((response.ok && health) || (!response.ok && ![502, 503, 504].includes(response.status)))
      )
        throw new Error('PocketForgeのサーバーを確認できませんでした。URLを確認してください。');
      if (controller.signal.aborted) break;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(wait);
          controller.signal.removeEventListener('abort', finish);
          resolve();
        };
        const wait = setTimeout(finish, retryMs);
        controller.signal.addEventListener('abort', finish, { once: true });
      });
    }
    throw new Error(
      'サーバーの起動を待ちましたが接続できませんでした。URL・通信を確認して、もう一度お試しください。',
    );
  } finally {
    clearTimeout(timer);
  }
}
