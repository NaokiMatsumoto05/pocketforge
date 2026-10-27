import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Linking,
  useWindowDimensions,
  ActivityIndicator,
  Switch,
} from 'react-native';
import {
  AI_PROVIDERS,
  AI_PROVIDER_INFO,
  type AIProvider,
  type Project,
  type ConnectionStatus,
  type Event,
  type Job,
  type Snapshot,
} from '@pocketforge/core';
import { api, API_URL } from './api';
import { C, s, Txt, Icon, Button, Field, Sheet, Badge, Empty } from './ui';
import { Editor } from './editor';
import { Design } from './design';

type Tab = 'ai' | 'code' | 'design' | 'preview' | 'tools';
export function Workspace({
  project,
  onProject,
  userId,
  connections,
  onSettings,
  onHome,
  notify,
}: {
  project: Project;
  onProject: (p: Project) => void;
  userId: string;
  connections: ConnectionStatus[];
  onSettings: () => void;
  onHome: () => void;
  notify: (e: unknown) => void;
}) {
  const [tab, setTab] = useState<Tab>('ai'),
    [events, setEvents] = useState<Event[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [submitting, setSubmitting] = useState(false);
  const [prompt, setPrompt] = useState(''),
    [provider, setProvider] = useState<AIProvider>('openai'),
    [allowCommands, setAllowCommands] = useState(false),
    [confirm, setConfirm] = useState(''),
    [codeDirty, setCodeDirty] = useState(false);
  const [toolTab, setToolTab] = useState('terminal'),
    [command, setCommand] = useState(''),
    [history, setHistory] = useState<Snapshot[]>([]),
    [diff, setDiff] = useState(''),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [commit, setCommit] = useState('変更を保存');
  const { width } = useWindowDimensions(),
    wide = width >= 1000,
    active = jobs.some((j) => j.status === 'running'),
    locked = active || submitting;
  const lastEvent = useRef(0),
    polling = useRef(false),
    lastJobs = useRef('');
  const root = '/projects/' + project.id;
  const configured = (p: string) => connections.some((c) => c.provider === p && c.configured);
  async function refresh() {
    if (polling.current) return;
    polling.current = true;
    try {
      const [ev, js] = await Promise.all([
        api<Event[]>(root + '/events?after=' + lastEvent.current),
        api<Job[]>(root + '/jobs'),
      ]);
      if (ev.length) {
        lastEvent.current = ev[ev.length - 1].id;
        setEvents((old) => [...old, ...ev].slice(-600));
      }
      const signature = js.map((j) => j.id + ':' + j.status).join(',');
      if (signature !== lastJobs.current) {
        lastJobs.current = signature;
        setJobs(js);
        onProject(await api<Project>(root));
      }
    } catch (e) {
      notify(e);
    } finally {
      polling.current = false;
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), 1800);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (tab === 'tools' && toolTab === 'history')
      void api<Snapshot[]>(root + '/history')
        .then(setHistory)
        .catch(notify);
  }, [tab, toolTab, project.revision]);
  async function job(path: string, body?: unknown) {
    if (codeDirty) {
      notify(
        new Error(
          'コードの自動保存が終わるまでお待ちください。競合がある場合はコード画面で解決してください。',
        ),
      );
      return;
    }
    setSubmitting(true);
    try {
      const j = await api<Job>(root + path, 'POST', body);
      setJobs((old) => [j, ...old]);
      await refresh();
    } catch (e) {
      notify(e);
    } finally {
      setSubmitting(false);
    }
  }
  async function chat() {
    if (!prompt.trim()) return;
    const text = prompt;
    await job('/ai', { prompt: text, provider, allowCommands });
    if (configured(provider)) setPrompt('');
  }
  async function exportProject() {
    try {
      const r = await api<{ path: string }>(root + '/export', 'POST');
      await Linking.openURL(API_URL + r.path);
    } catch (e) {
      notify(e);
    }
  }
  async function compare(h: Snapshot) {
    try {
      const r = await api<{ diff: string }>(root + '/diff/' + h.id);
      setSnapshot(h);
      setDiff(r.diff || '現在のファイルと同じ内容です。');
    } catch (e) {
      notify(e);
    }
  }
  async function restore() {
    if (!snapshot) return;
    try {
      const p = await api<Project>(root + '/restore', 'POST', {
        snapshotId: snapshot.id,
        revision: project.revision,
      });
      onProject(p);
      setSnapshot(null);
      await refresh();
    } catch (e) {
      notify(e);
    }
  }
  const tabs = [
    { key: 'ai', icon: 'zap', label: 'AI' },
    { key: 'code', icon: 'code', label: 'コード' },
    { key: 'design', icon: 'layout', label: 'デザイン' },
    { key: 'preview', icon: 'play', label: 'プレビュー' },
    { key: 'tools', icon: 'terminal', label: 'ツール' },
  ] as const;
  const messages = events.filter((e) => e.kind === 'user' || e.kind === 'assistant');
  const cloudRunning =
    project.sandboxState === 'running' && (project.sandboxExpiresAt ?? 0) > Date.now();
  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          s.between,
          {
            paddingHorizontal: wide ? 30 : 18,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderColor: C.line,
          },
        ]}
      >
        <View style={s.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ホームへ戻る"
            onPress={onHome}
            style={{ padding: 6 }}
          >
            <Icon name="arrow-left" size={18} />
          </Pressable>
          <View>
            <Txt bold size={wide ? 17 : 14}>
              {project.name}
            </Txt>
            <Txt size={10} color={C.muted}>
              Expo · revision {project.revision}
            </Txt>
          </View>
        </View>
        <View style={s.row}>
          {wide && (
            <Badge
              label={cloudRunning ? 'クラウド稼働中' : 'クラウド停止中'}
              dot
              color={cloudRunning ? '#52525B' : C.muted}
            />
          )}
          <Button
            small
            kind="secondary"
            label={cloudRunning ? '停止' : '環境を起動'}
            icon={cloudRunning ? 'pause' : 'cloud'}
            onPress={() => {
              if (!configured('e2b')) onSettings();
              else if (cloudRunning) void job('/runtime/pause', {});
              else setConfirm('start');
            }}
            disabled={locked}
          />
        </View>
      </View>
      {wide && (
        <View style={{ paddingHorizontal: 30, paddingTop: 18, flexDirection: 'row', gap: 9 }}>
          {tabs.map((t) => (
            <Button
              key={t.key}
              label={t.label}
              icon={t.icon}
              kind={tab === t.key ? 'primary' : 'ghost'}
              small
              onPress={() => setTab(t.key)}
            />
          ))}
        </View>
      )}
      {locked && (
        <View
          style={[s.row, { paddingHorizontal: 22, paddingVertical: 9, backgroundColor: '#F4F4F5' }]}
        >
          <ActivityIndicator size="small" color="#52525B" />
          <Txt size={11}>処理中 · 実行内容はログに記録されています</Txt>
        </View>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: wide ? 30 : 18, paddingBottom: 28 }}
      >
        <View style={{ display: tab === 'ai' ? 'flex' : 'none', gap: 20 }}>
          <View style={s.between}>
            <View style={s.row}>
              <View style={[s.iconBox, { backgroundColor: C.highlight }]}>
                <Icon name="zap" />
              </View>
              <View>
                <Txt size={17} bold>
                  ひらめきの、その先へ。
                </Txt>
                <Txt size={11} color={C.muted}>
                  AIと一緒に、アプリを育てよう。
                </Txt>
              </View>
            </View>
          </View>
          {messages.length === 0 ? (
            <View
              style={[
                s.card,
                {
                  minHeight: 230,
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 18,
                  borderStyle: 'dashed',
                },
              ]}
            >
              <View
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 20,
                  backgroundColor: C.soft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="message-circle" size={26} />
              </View>
              <Txt size={19} bold>
                何をつくりましょう？
              </Txt>
              <Txt color={C.muted} size={12} style={{ textAlign: 'center', maxWidth: 350 }}>
                アイデアを伝えると、AIがプロジェクトを読み、{'\n'}実際のファイルを編集します。
              </Txt>
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}
              >
                {[
                  'このアプリの構造を教えて',
                  'プロフィール画面を追加して',
                  'コードを確認して改善点を教えて',
                ].map((p) => (
                  <Button key={p} label={p} small kind="secondary" onPress={() => setPrompt(p)} />
                ))}
              </View>
            </View>
          ) : (
            messages.map((e) => (
              <View
                key={e.id}
                style={{
                  alignSelf: e.kind === 'user' ? 'flex-end' : 'stretch',
                  maxWidth: '96%',
                  backgroundColor: e.kind === 'user' ? '#F4F4F5' : C.white,
                  padding: 20,
                  borderRadius: 20,
                  gap: 9,
                  borderWidth: 1,
                  borderColor: C.line,
                }}
              >
                <View style={s.row}>
                  <Icon name={e.kind === 'user' ? 'user' : 'zap'} size={13} />
                  <Txt size={10} bold>
                    {e.kind === 'user' ? 'あなた' : 'PocketForge AI'}
                  </Txt>
                  <Txt size={9} color={C.muted}>
                    {new Date(e.createdAt).toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Txt>
                </View>
                <Txt size={13}>{e.message}</Txt>
              </View>
            ))
          )}
          {events.some((e) => e.kind === 'tool') && (
            <View style={[s.card, { padding: 16, gap: 6 }]}>
              <Txt size={10} bold color={C.muted}>
                AIの操作
              </Txt>
              {events
                .filter((e) => e.kind === 'tool')
                .slice(-6)
                .map((e) => (
                  <View key={e.id} style={s.row}>
                    <Icon name="chevron-right" size={12} color={C.muted} />
                    <Txt size={11} color={C.muted} style={{ fontFamily: 'monospace' }}>
                      {e.message}
                    </Txt>
                  </View>
                ))}
            </View>
          )}
          {jobs.find((j) => j.kind === 'ai' && j.status === 'failed') && (
            <View style={[s.card, { backgroundColor: '#F4F4F5' }]}>
              <Txt size={12} color={C.danger}>
                {jobs.find((j) => j.kind === 'ai' && j.status === 'failed')?.result}
              </Txt>
            </View>
          )}
          <View style={[s.card, { gap: 14, padding: 18 }]}>
            <Field
              accessibilityLabel="AIへの指示"
              placeholder="どんなアプリにしたいですか？"
              multiline
              value={prompt}
              onChangeText={setPrompt}
              style={{ borderWidth: 0, padding: 4, minHeight: 95 }}
            />
            <View style={s.divider} />
            <View style={{ gap: 10 }}>
              <View style={[s.row, { flexWrap: 'wrap', gap: 5 }]}>
                {AI_PROVIDERS.map((p) => (
                  <Button
                    key={p}
                    label={AI_PROVIDER_INFO[p].label}
                    small
                    kind={p === provider ? 'primary' : 'ghost'}
                    disabled={locked}
                    onPress={() => setProvider(p)}
                  />
                ))}
              </View>
              <View style={s.between}>
                <Txt size={10} color={C.muted} style={{ flex: 1 }}>
                  {configured(provider)
                    ? connections.find((c) => c.provider === provider)?.model
                    : AI_PROVIDER_INFO[provider].label + ' · 未接続'}
                </Txt>
                <Button
                  label="送信"
                  icon="arrow-up"
                  small
                  onPress={() => void chat()}
                  disabled={locked || !prompt.trim() || !configured(provider) || codeDirty}
                />
              </View>
            </View>
            <View style={s.between}>
              <Txt size={10} color={C.muted}>
                AIのコマンド実行を許可
              </Txt>
              <Switch
                value={allowCommands}
                onValueChange={setAllowCommands}
                trackColor={{ true: '#18181B', false: C.line }}
              />
            </View>
          </View>
          {!configured(provider) && (
            <View style={[s.between, { padding: 16, borderRadius: 15, backgroundColor: C.soft }]}>
              <View style={{ flex: 1 }}>
                <Txt size={12} bold>
                  AIを接続して、はじめましょう
                </Txt>
                <Txt size={10} color={C.muted}>
                  ご自身のAPIキーとモデルを登録できます。
                </Txt>
              </View>
              <Button small kind="secondary" label="設定" icon="arrow-right" onPress={onSettings} />
            </View>
          )}
        </View>
        <View style={{ display: tab === 'code' ? 'flex' : 'none' }}>
          <Editor
            project={project}
            onProject={onProject}
            userId={userId}
            locked={locked}
            onDirty={setCodeDirty}
            onAskAI={(text) => {
              setPrompt(text);
              setTab('ai');
            }}
          />
        </View>
        <View style={{ display: tab === 'design' ? 'flex' : 'none' }}>
          <Design
            project={project}
            onProject={onProject}
            locked={locked || codeDirty}
            notify={notify}
          />
        </View>
        <View style={{ display: tab === 'preview' ? 'flex' : 'none' }}>
          <Design
            project={project}
            onProject={onProject}
            locked={true}
            notify={notify}
            previewOnly
          />
        </View>
        <View style={{ display: tab === 'tools' ? 'flex' : 'none', gap: 18 }}>
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {[
              { key: 'terminal', label: 'ターミナル', icon: 'terminal' },
              { key: 'git', label: 'Git', icon: 'git-branch' },
              { key: 'history', label: '変更履歴', icon: 'clock' },
              { key: 'build', label: 'ビルド', icon: 'package' },
            ].map((t) => (
              <Button
                key={t.key}
                small
                label={t.label}
                kind={toolTab === t.key ? 'primary' : 'secondary'}
                onPress={() => setToolTab(t.key)}
              />
            ))}
          </ScrollView>
          {toolTab === 'terminal' && (
            <>
              <View
                style={{
                  backgroundColor: '#18181B',
                  borderRadius: 20,
                  padding: 18,
                  minHeight: 240,
                  gap: 8,
                }}
              >
                <View style={s.between}>
                  <Txt size={11} color="#E4E4E7" bold>
                    PROJECT TERMINAL
                  </Txt>
                  <Txt size={10} color="#A1A1AA">
                    60s / command
                  </Txt>
                </View>
                <View style={{ height: 1, backgroundColor: '#3F3F46', marginVertical: 8 }} />
                {!events.some((e) => ['stdout', 'command', 'error'].includes(e.kind)) ? (
                  <Txt style={s.mono} color="#A1A1AA">
                    {cloudRunning
                      ? '環境の準備ができました。'
                      : 'クラウド環境を起動すると、コマンドを実行できます。'}
                  </Txt>
                ) : (
                  events
                    .filter((e) => ['stdout', 'command', 'error'].includes(e.kind))
                    .slice(-80)
                    .map((e) => (
                      <Txt
                        key={e.id}
                        size={11}
                        color={
                          e.kind === 'error'
                            ? '#FCA5A5'
                            : e.kind === 'command'
                              ? C.highlight
                              : '#D4D4D8'
                        }
                        style={s.mono}
                      >
                        {e.message}
                      </Txt>
                    ))
                )}
              </View>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Field
                    accessibilityLabel="コマンド"
                    placeholder="npm install"
                    value={command}
                    onChangeText={setCommand}
                    autoCorrect={false}
                    autoCapitalize="none"
                    style={{ fontFamily: 'monospace' }}
                    onSubmitEditing={() => void job('/command', { command })}
                  />
                </View>
                <Button
                  label="実行"
                  icon="play"
                  onPress={() => void job('/command', { command })}
                  disabled={!command.trim() || locked || !cloudRunning}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {['npm install', 'npm run typecheck', 'git status'].map((c) => (
                  <Button key={c} label={c} small kind="secondary" onPress={() => setCommand(c)} />
                ))}
              </View>
              <Txt size={11} color={C.muted}>
                プロジェクト専用の隔離環境で実行します。完了後にテキストファイルを保存します。対話型PTY・常駐プロセスの自動同期は未対応です。
              </Txt>
            </>
          )}
          {toolTab === 'git' && (
            <View style={[s.card, { gap: 16 }]}>
              <View style={s.row}>
                <Icon name="git-branch" />
                <Txt bold>本物のGitを、クラウドで。</Txt>
              </View>
              <Txt size={12} color={C.muted}>
                Gitコマンドは隔離環境内で動きます。環境を一時停止しても.gitは保持されます。ファイルの復元は「変更履歴」からも行えます。
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {['git init', 'git status', 'git diff'].map((c) => (
                  <Button
                    key={c}
                    label={c}
                    small
                    kind="secondary"
                    disabled={locked || !cloudRunning}
                    onPress={() => {
                      setToolTab('terminal');
                      void job('/command', { command: c });
                    }}
                  />
                ))}
              </View>
              <Field label="コミットメッセージ" value={commit} onChangeText={setCommit} />
              <Button
                label="変更をコミット"
                icon="git-commit"
                disabled={locked || !cloudRunning || !commit.trim()}
                onPress={() => {
                  setToolTab('terminal');
                  const quoted = "'" + commit.replace(/'/g, "'\\''") + "'";
                  void job('/command', {
                    command:
                      'git add . && git -c user.name=PocketForge -c user.email=local@pocketforge.invalid commit -m ' +
                      quoted,
                  });
                }}
              />
            </View>
          )}
          {toolTab === 'history' && (
            <>
              <View style={s.between}>
                <Txt size={17} bold>
                  変更履歴
                </Txt>
                <Button
                  small
                  label="ZIPで保存"
                  icon="download"
                  kind="secondary"
                  onPress={() => void exportProject()}
                  disabled={codeDirty}
                />
              </View>
              {history.map((h) => (
                <Pressable
                  key={h.id}
                  onPress={() => void compare(h)}
                  style={[
                    s.card,
                    {
                      padding: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      borderRadius: 16,
                    },
                  ]}
                >
                  <View style={[s.iconBox, { backgroundColor: C.soft }]}>
                    <Icon name="git-commit" size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt size={13} bold>
                      {h.label}
                    </Txt>
                    <Txt size={10} color={C.muted}>
                      {new Date(h.createdAt).toLocaleString('ja-JP')} · v{h.revision}
                    </Txt>
                  </View>
                  <Icon name="chevron-right" size={15} />
                </Pressable>
              ))}
            </>
          )}
          {toolTab === 'build' && (
            <>
              <View style={[s.card, { gap: 17 }]}>
                <View style={s.row}>
                  <View style={[s.iconBox, { backgroundColor: C.soft }]}>
                    <Icon name="package" />
                  </View>
                  <View>
                    <Txt bold size={17}>
                      アプリを、手元へ。
                    </Txt>
                    <Txt size={11} color={C.muted}>
                      Expo EAS Build · Preview profile
                    </Txt>
                  </View>
                </View>
                <Txt size={12} color={C.muted}>
                  ExpoのプロジェクトID、アプリ識別子、署名情報を準備してください。iOSはデバイス登録も必要です。ビルド操作は利用料金が発生する場合があります。
                </Txt>
                <View style={s.row}>
                  <Button
                    label="Android"
                    icon="smartphone"
                    onPress={() => setConfirm('android')}
                    disabled={locked || !cloudRunning || !configured('expo')}
                  />
                  <Button
                    label="iOS"
                    icon="smartphone"
                    kind="secondary"
                    onPress={() => setConfirm('ios')}
                    disabled={locked || !cloudRunning || !configured('expo')}
                  />
                </View>
                {!configured('expo') && (
                  <Button
                    small
                    kind="secondary"
                    label="Expoを接続する"
                    icon="link"
                    onPress={onSettings}
                  />
                )}
                <Button
                  kind="secondary"
                  label="ビルド状況・成果物を取得"
                  icon="refresh-cw"
                  onPress={() => void job('/build-status', {})}
                  disabled={locked || !cloudRunning || !configured('expo')}
                />
              </View>
              {jobs
                .filter((j) => j.kind.startsWith('build'))
                .map((j) => (
                  <View key={j.id} style={[s.card, { gap: 9 }]}>
                    <View style={s.between}>
                      <Txt bold size={12}>
                        {j.kind === 'build' ? 'ビルド要求' : 'ビルド状況取得'}
                      </Txt>
                      <Badge
                        label={
                          j.status === 'complete'
                            ? '要求処理完了'
                            : j.status === 'failed'
                              ? 'エラー'
                              : '処理中'
                        }
                      />
                    </View>
                    <Txt selectable style={s.mono} color={j.status === 'failed' ? C.danger : C.ink}>
                      {j.result || 'EASに問い合わせています…'}
                    </Txt>
                    {(() => {
                      try {
                        const data = JSON.parse(j.result.trim());
                        return (Array.isArray(data) ? data : [data])
                          .filter((b: any) => b.artifacts?.buildUrl?.startsWith('https://'))
                          .map((b: any, i: number) => (
                            <Button
                              key={i}
                              small
                              label={(b.platform || '') + ' 成果物をダウンロード'}
                              icon="download"
                              onPress={() => void Linking.openURL(b.artifacts.buildUrl)}
                            />
                          ));
                      } catch {
                        return null;
                      }
                    })()}
                  </View>
                ))}
            </>
          )}
        </View>
      </ScrollView>
      {!wide && (
        <View
          style={{
            flexDirection: 'row',
            paddingVertical: 9,
            paddingHorizontal: 8,
            borderTopWidth: 1,
            borderColor: C.line,
            backgroundColor: C.white,
          }}
        >
          {tabs.map((t) => (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: tab === t.key }}
              onPress={() => setTab(t.key)}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: 4,
                paddingVertical: 6,
                borderRadius: 12,
                backgroundColor: tab === t.key ? C.soft : 'transparent',
              }}
            >
              <Icon name={t.icon} size={19} color={tab === t.key ? C.ink : C.muted} />
              <Txt size={9} bold={tab === t.key} color={tab === t.key ? C.ink : C.muted}>
                {t.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      )}
      <Sheet
        visible={!!confirm}
        title={
          confirm === 'start'
            ? 'クラウド環境の起動'
            : confirm === 'restore'
              ? 'この状態に復元しますか？'
              : 'クラウドビルドの実行'
        }
        onClose={() => setConfirm('')}
      >
        <Txt>
          {confirm === 'start'
            ? 'ご自身のE2Bアカウントでプロジェクト専用環境を起動します。使用量に応じて料金が発生する場合があります。操作がない場合は約10分で一時停止します。'
            : confirm === 'restore'
              ? '現在の内容も履歴に残し、選択した時点のファイルに戻します。'
              : 'ご自身のExpoアカウントで配布用ビルドを要求します。料金・利用枠・署名設定を確認して実行してください。'}
        </Txt>
        <Button
          label={confirm === 'restore' ? '復元する' : '実行する'}
          onPress={() => {
            const action = confirm;
            setConfirm('');
            if (action === 'restore') void restore();
            else
              void job(
                action === 'start' ? '/runtime/start' : '/build',
                action === 'start' ? { confirmed: true } : { platform: action, confirmed: true },
              );
          }}
        />
      </Sheet>
      <Sheet visible={!!snapshot} title="現在の状態との差分" onClose={() => setSnapshot(null)} wide>
        <Txt size={12} bold>
          {snapshot?.label}
        </Txt>
        <ScrollView horizontal>
          <Txt selectable style={[s.mono, { minWidth: 600 }]}>
            {diff}
          </Txt>
        </ScrollView>
        <Button
          label="この時点に復元"
          icon="rotate-ccw"
          onPress={() => void restore()}
          disabled={locked || codeDirty}
        />
      </Sheet>
    </View>
  );
}
