import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  AI_PROVIDERS,
  AI_PROVIDER_INFO,
  isAIProvider,
  type IntegrationProvider,
  type Project,
  type ProjectSummary,
  type ConnectionStatus,
} from '@pocketforge/core';
import { api, restoreToken, setToken, setApiURL, checkServer, API_URL } from './src/api';
import { C, s, Txt, Icon, Button, Field, Sheet, Badge } from './src/ui';
import { Workspace } from './src/workspace';
import { Home } from './src/home';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Studio />
    </SafeAreaProvider>
  );
}
function Studio() {
  const { width } = useWindowDimensions(),
    wide = width >= 1000;
  const [loading, setLoading] = useState(true),
    [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [project, setProject] = useState<Project | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]),
    [settings, setSettings] = useState(false),
    [creating, setCreating] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [description, setDescription] = useState('');
  const notify = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  async function refresh() {
    const [ps, cs] = await Promise.all([
      api<ProjectSummary[]>('/projects'),
      api<ConnectionStatus[]>('/integrations'),
    ]);
    setProjects(ps);
    setConnections(cs);
  }
  useEffect(() => {
    void restoreToken()
      .then(() => api<{ user: { id: string; name: string } }>('/auth/me'))
      .then((r) => {
        setUser(r.user);
        return refresh();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  async function open(id: string) {
    try {
      setProject(await api<Project>('/projects/' + id));
    } catch (e) {
      notify(e);
    }
  }
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api<Project>('/projects', 'POST', { name, description });
      setProject(p);
      setCreating(false);
      setName('');
      setDescription('');
      await refresh();
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api('/auth/logout', 'POST');
      await setToken('');
      setUser(null);
      setProject(null);
      setProjects([]);
    } catch (e) {
      notify(e);
    }
  }
  const newProject = () => {
    setName('');
    setDescription('');
    setCreating(true);
  };
  if (loading)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}
      >
        <Brand compact />
        <ActivityIndicator color={C.ink} />
      </View>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {!user ? (
          <Auth
            onSuccess={async (u) => {
              setUser(u);
              await refresh();
            }}
          />
        ) : (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {wide && (
              <View style={{ width: 236, backgroundColor: C.dark, padding: 24, paddingTop: 28 }}>
                <Brand />
                <View style={{ height: 38 }} />
                <Txt size={10} color="#A1A1AA" bold style={{ letterSpacing: 2, paddingLeft: 12 }}>
                  WORKSPACE
                </Txt>
                <Pressable
                  onPress={() => {
                    setProject(null);
                    void refresh();
                  }}
                  style={[
                    s.row,
                    {
                      padding: 13,
                      borderRadius: 12,
                      marginTop: 10,
                      backgroundColor: project ? 'transparent' : '#303033',
                    },
                  ]}
                >
                  <Icon name="grid" color={C.highlight} size={19} />
                  <Txt color={C.highlight} bold>
                    プロジェクト
                  </Txt>
                </Pressable>
                <Pressable
                  onPress={() => setSettings(true)}
                  style={[s.row, { padding: 13, marginTop: 6 }]}
                >
                  <Icon name="sliders" color="#A1A1AA" size={19} />
                  <Txt color="#E4E4E7">接続・設定</Txt>
                </Pressable>
                <View style={{ marginTop: 28, paddingHorizontal: 12, gap: 14 }}>
                  <Txt size={10} color="#A1A1AA" bold style={{ letterSpacing: 2 }}>
                    RECENT PROJECTS
                  </Txt>
                  {projects.slice(0, 5).map((p) => (
                    <Pressable key={p.id} onPress={() => void open(p.id)} style={s.row}>
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: p.id === project?.id ? C.highlight : '#71717A',
                        }}
                      />
                      <Txt size={12} color={p.id === project?.id ? C.highlight : '#D4D4D8'}>
                        {p.name.slice(0, 17)}
                      </Txt>
                    </Pressable>
                  ))}
                  {!projects.length && (
                    <Txt size={12} color="#A1A1AA">
                      ここから、最初の一歩。
                    </Txt>
                  )}
                </View>
                <View style={{ flex: 1 }} />
                <View
                  style={{ backgroundColor: '#27272A', borderRadius: 18, padding: 18, gap: 10 }}
                >
                  <Icon name="smartphone" color={C.highlight} size={24} />
                  <Txt bold color="#FAFAFA">
                    ポケットに、開発環境を。
                  </Txt>
                  <Txt size={11} color="#A1A1AA">
                    企画からコード、デザインまで。ひらめいた場所が、あなたのスタジオ。
                  </Txt>
                </View>
                <View style={[s.row, { marginTop: 22 }]}>
                  <View style={[s.iconBox, { backgroundColor: '#3F3F46' }]}>
                    <Txt bold color={C.highlight}>
                      {user.name.slice(0, 1).toUpperCase()}
                    </Txt>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt color="#FAFAFA" bold size={12}>
                      {user.name}
                    </Txt>
                    <Txt size={10} color="#A1A1AA">
                      Personal workspace
                    </Txt>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="ログアウト"
                    onPress={() => void logout()}
                  >
                    <Icon name="log-out" size={17} color="#A1A1AA" />
                  </Pressable>
                </View>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View
                style={[
                  s.between,
                  {
                    height: 72,
                    paddingHorizontal: wide ? 38 : 20,
                    borderBottomWidth: 1,
                    borderColor: C.line,
                  },
                ]}
              >
                {!wide ? (
                  <Brand compact />
                ) : (
                  <View style={s.row}>
                    <Txt size={12} color={C.muted}>
                      ワークスペース
                    </Txt>
                    <Icon name="chevron-right" size={13} color={C.muted} />
                    <Txt size={12} bold>
                      {project?.name || 'プロジェクト'}
                    </Txt>
                  </View>
                )}
                <View style={s.row}>
                  {(wide || width >= 360) && (
                    <Badge label={wide ? 'MVP · ローカル開発版' : 'LOCAL'} dot />
                  )}
                  {!wide && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="接続・設定"
                      onPress={() => setSettings(true)}
                      style={{ padding: 8 }}
                    >
                      <Icon name="sliders" size={20} />
                    </Pressable>
                  )}
                </View>
              </View>
              {project ? (
                <Workspace
                  key={project.id}
                  project={project}
                  onProject={setProject}
                  userId={user.id}
                  connections={connections}
                  onSettings={() => setSettings(true)}
                  onHome={() => {
                    setProject(null);
                    void refresh();
                  }}
                  notify={notify}
                />
              ) : (
                <Home
                  name={user.name}
                  projects={projects}
                  wide={wide}
                  onCreate={newProject}
                  onOpen={(id) => void open(id)}
                />
              )}
            </View>
          </View>
        )}
        <Sheet visible={creating} title="新しいプロジェクト" onClose={() => setCreating(false)}>
          <View style={s.row}>
            <Badge label="React Native" />
            <Badge label="Expo" />
            <Badge label="TypeScript" />
          </View>
          <Field
            label="プロジェクト名"
            placeholder="例：Daily Bloom"
            value={name}
            onChangeText={setName}
            maxLength={60}
          />
          <Field
            label="つくりたいアプリ"
            placeholder="どんな人の、どんな毎日を変えますか？"
            multiline
            value={description}
            onChangeText={setDescription}
            maxLength={400}
          />
          <Txt color={C.muted} size={12}>
            編集できるExpoプロジェクトを作成し、サーバーに保存します。クラウド環境は必要なときに起動できます。
          </Txt>
          <Button
            label="プロジェクトを作成"
            icon="arrow-right"
            onPress={() => void create()}
            disabled={!name.trim()}
            loading={busy}
          />
        </Sheet>
        {user && (
          <Settings
            visible={settings}
            onClose={() => setSettings(false)}
            connections={connections}
            refresh={refresh}
            notify={notify}
            onLogout={() => void logout()}
          />
        )}
        <Sheet visible={!!error} title="確認してください" onClose={() => setError('')}>
          <Txt>{error}</Txt>
          <Button label="閉じる" onPress={() => setError('')} />
        </Sheet>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <View style={s.row}>
      <View
        style={[
          s.iconBox,
          { width: compact ? 31 : 38, height: compact ? 31 : 38, borderRadius: 11 },
        ]}
      >
        <Icon name="command" size={compact ? 19 : 24} />
      </View>
      <Txt
        size={compact ? 17 : 20}
        bold
        color={compact ? C.ink : '#FAFAFA'}
        style={{ letterSpacing: -0.7 }}
      >
        pocketforge<Txt color="#A1A1AA">.</Txt>
      </Txt>
    </View>
  );
}
function Auth({ onSuccess }: { onSuccess: (u: { id: string; name: string }) => Promise<void> }) {
  const [endpoint, setEndpoint] = useState(API_URL),
    [mode, setMode] = useState<'register' | 'login'>(Platform.OS === 'web' ? 'register' : 'login'),
    [name, setName] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [connection, setConnection] = useState(''),
    [checking, setChecking] = useState(false);
  const { width } = useWindowDimensions();
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (Platform.OS !== 'web') await setApiURL(endpoint);
      const r = await api<{ user: { id: string; name: string }; token?: string }>(
        '/auth/' + mode,
        'POST',
        { name, password },
      );
      if (r.token) await setToken(r.token);
      await onSuccess(r.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        padding: 24,
        alignItems: 'center',
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={{
          width: '100%',
          maxWidth: 980,
          flexDirection: width > 800 ? 'row' : 'column',
          backgroundColor: C.white,
          borderRadius: 30,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: C.line,
        }}
      >
        <View style={{ flex: 1, backgroundColor: C.dark, padding: width > 800 ? 45 : 28, gap: 28 }}>
          <Brand />
          <View style={{ height: width > 800 ? 40 : 0 }} />
          <Txt
            size={width > 800 ? 38 : 27}
            bold
            color="#FAFAFA"
            style={{ lineHeight: width > 800 ? 55 : 42 }}
          >
            ひらめきを、{'\n'}手のひらから。
          </Txt>
          <Txt color="#D4D4D8" size={13}>
            AIも、コードも、デザインも。{'\n'}あなたのための小さな開発スタジオ。
          </Txt>
          <View style={s.row}>
            <Icon name="smartphone" color={C.highlight} />
            <Txt size={10} bold color={C.highlight} style={{ letterSpacing: 2 }}>
              SMALL SCREEN. BIG IDEAS.
            </Txt>
          </View>
        </View>
        <View style={{ flex: 1, padding: width > 800 ? 45 : 28, gap: 20 }}>
          <View style={{ gap: 5 }}>
            <Txt size={24} bold>
              {mode === 'register' ? 'あなたのスタジオを開こう' : 'おかえりなさい'}
            </Txt>
            <Txt color={C.muted} size={12}>
              接続するサーバーにプロジェクトを保存します
            </Txt>
          </View>
          <>
            {Platform.OS !== 'web' && (
              <View style={{ gap: 10 }}>
                <Field
                  label="接続先サーバー（HTTPS）"
                  placeholder="https://your-studio.example.com"
                  value={endpoint}
                  onChangeText={(value) => {
                    setEndpoint(value);
                    setConnection('');
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Button
                  label="接続先を確認"
                  kind="secondary"
                  small
                  icon="wifi"
                  loading={checking}
                  disabled={busy || !endpoint.trim()}
                  onPress={() => {
                    void (async () => {
                      setChecking(true);
                      setError('');
                      setConnection('');
                      try {
                        const result = await checkServer(endpoint);
                        setConnection('PocketForge ' + result.version + ' に接続できます');
                        if (!result.registrationAllowed) setMode('login');
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setChecking(false);
                      }
                    })();
                  }}
                />
                {checking && (
                  <Txt size={12} color={C.muted}>
                    サーバーを確認しています。休止中の場合は起動に1〜2分かかります。
                  </Txt>
                )}
                {!!connection && (
                  <Txt size={12} color={C.muted}>
                    {connection}
                  </Txt>
                )}
              </View>
            )}
          </>
          <Field
            label="ユーザー名"
            placeholder="あなたの名前"
            autoCapitalize="none"
            value={name}
            onChangeText={setName}
            maxLength={40}
          />
          <Field
            label="パスワード"
            placeholder="10文字以上"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            onSubmitEditing={() => void submit()}
          />
          {error && (
            <Txt color={C.danger} size={12}>
              {error}
            </Txt>
          )}
          <Button
            label={mode === 'register' ? 'スタジオをはじめる' : 'ログイン'}
            icon="arrow-right"
            onPress={() => void submit()}
            loading={busy}
            disabled={name.trim().length < 2 || password.length < 10}
          />
          <Pressable
            onPress={() => {
              setMode(mode === 'register' ? 'login' : 'register');
              setError('');
            }}
          >
            <Txt size={12} color={C.muted} style={{ textAlign: 'center' }}>
              {mode === 'register' ? 'アカウントをお持ちの方はこちら' : '新しくアカウントを作成'}
            </Txt>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
function Settings({
  visible,
  onClose,
  connections,
  refresh,
  notify,
  onLogout,
}: {
  visible: boolean;
  onClose: () => void;
  connections: ConnectionStatus[];
  refresh: () => Promise<void>;
  notify: (e: unknown) => void;
  onLogout: () => void;
}) {
  const [provider, setProvider] = useState<IntegrationProvider>('openai'),
    [key, setKey] = useState(''),
    [model, setModel] = useState(''),
    [busy, setBusy] = useState(false);
  const current = connections.find((x) => x.provider === provider);
  function selectProvider(next: IntegrationProvider) {
    setProvider(next);
    setKey('');
    setModel(connections.find((c) => c.provider === next)?.model || '');
  }
  async function save() {
    setBusy(true);
    try {
      await api('/integrations/' + provider, 'PUT', { key, model });
      setKey('');
      await refresh();
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api('/integrations/' + provider, 'DELETE');
      await refresh();
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible={visible} title="接続・設定" onClose={onClose}>
      <Txt color={C.muted} size={12}>
        ご自身のアカウントを接続します。キーはサーバーで暗号化され、プロジェクトには保存されません。外部サービスの利用料金は各アカウントに発生します。
      </Txt>
      <Txt size={12} bold>
        AIサービス
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {AI_PROVIDERS.map((p) => (
          <View key={p} style={{ width: '48%' }}>
            <Button
              small
              kind={p === provider ? 'primary' : 'secondary'}
              label={AI_PROVIDER_INFO[p].settingsLabel}
              disabled={busy}
              onPress={() => selectProvider(p)}
            />
          </View>
        ))}
      </View>
      <Txt size={12} bold>
        開発環境
      </Txt>
      <View style={s.row}>
        {(['e2b', 'expo'] as const).map((p) => (
          <Button
            key={p}
            label={p === 'e2b' ? 'E2B' : 'Expo'}
            small
            kind={p === provider ? 'primary' : 'secondary'}
            disabled={busy}
            onPress={() => selectProvider(p)}
          />
        ))}
      </View>
      <View style={s.divider} />
      <Txt size={16} bold>
        {isAIProvider(provider)
          ? AI_PROVIDER_INFO[provider].settingsLabel
          : provider === 'e2b'
            ? 'E2B'
            : 'Expo'}
      </Txt>
      <Badge
        label={current?.configured ? 'キー登録済み · 接続は実行時に確認' : '未接続'}
        color={current?.configured ? '#52525B' : C.muted}
        dot
      />
      <Field
        label={provider === 'expo' ? 'Expoアクセストークン' : 'APIキー'}
        placeholder="キーを入力"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={key}
        onChangeText={setKey}
        editable={!busy}
      />
      {isAIProvider(provider) && (
        <Field
          label="モデルID"
          placeholder="利用可能なモデルID"
          autoCapitalize="none"
          autoCorrect={false}
          value={model}
          onChangeText={setModel}
          editable={!busy}
        />
      )}
      {isAIProvider(provider) && (
        <Button
          label="APIキーの発行ガイド"
          kind="ghost"
          small
          icon="external-link"
          onPress={() => {
            void Linking.openURL(AI_PROVIDER_INFO[provider].guide).catch(notify);
          }}
        />
      )}
      <Button
        label="接続情報を保存"
        icon="lock"
        onPress={() => void save()}
        disabled={key.trim().length < 8 || (isAIProvider(provider) && !model.trim())}
        loading={busy}
      />
      {current?.configured && (
        <Button label="接続情報を削除" kind="ghost" onPress={() => void remove()} disabled={busy} />
      )}
      <View style={s.divider} />
      <Txt size={12} bold>
        このバージョンについて
      </Txt>
      <Txt size={12} color={C.muted}>
        プロジェクト・コード・履歴はAPIサーバーに保存されます。別端末では同じサーバーへ接続してください。画像管理、任意コードの埋め込みプレビューは次の開発対象です。
      </Txt>
      <Button
        label="ログアウト"
        kind="secondary"
        icon="log-out"
        onPress={() => {
          onClose();
          onLogout();
        }}
      />
    </Sheet>
  );
}
