import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { normalizeServerUrl } from '@pocketforge/core';
import { probeServer } from './server-probe';

export let API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web'
    ? typeof window !== 'undefined' &&
      window.location.port === '8081' &&
      ['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? 'http://localhost:4310'
      : ''
    : '');
let bearer = '';
export async function restoreToken() {
  if (Platform.OS !== 'web') {
    const savedURL = await AsyncStorage.getItem('pf-api-url');
    API_URL = savedURL || API_URL;
    if (API_URL) API_URL = normalizeServerUrl(API_URL);
    // Never restore a credential against a changed build-time default endpoint.
    if (savedURL) bearer = (await SecureStore.getItemAsync('pocketforge-session')) || '';
    else await setToken('');
  }
}
export async function setApiURL(value: string) {
  const next = normalizeServerUrl(value);
  if (next !== API_URL) {
    await setToken('');
    API_URL = next;
  }
  await AsyncStorage.setItem('pf-api-url', next);
}
export async function setToken(token: string) {
  bearer = token;
  if (Platform.OS !== 'web') {
    if (token) await SecureStore.setItemAsync('pocketforge-session', token);
    else await SecureStore.deleteItemAsync('pocketforge-session');
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function checkServer(value: string) {
  return probeServer(normalizeServerUrl(value));
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (Platform.OS !== 'web' && !API_URL) throw new Error('接続先のサーバーURLを設定してください。');
  if (Platform.OS !== 'web') normalizeServerUrl(API_URL);
  let r: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    r = await fetch(API_URL + '/api' + path, {
      method,
      credentials: Platform.OS === 'web' ? 'include' : 'omit',
      redirect: 'error',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(Platform.OS !== 'web' ? { 'X-Client': 'mobile' } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch {
    throw new Error('サーバーに接続できません。通信と接続先を確認してください。');
  } finally {
    clearTimeout(timer);
  }
  let data: any;
  try {
    data = await r.json();
  } catch {
    throw new Error('サーバーから正しい応答を受け取れませんでした。接続先を確認してください。');
  }
  if (!r.ok) throw new ApiError(r.status, data.error || '処理に失敗しました。');
  return data;
}
