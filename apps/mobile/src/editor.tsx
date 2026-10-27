import React, { useState, useEffect, useRef } from 'react';
import { View, ScrollView, TextInput, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Project } from '@pocketforge/core';
import { api } from './api';
import { C, s, Txt, Icon, Button, Field, Sheet, Badge } from './ui';

export function Editor({
  project,
  onProject,
  userId,
  locked,
  onAskAI,
  onDirty,
}: {
  project: Project;
  onProject: (p: Project) => void;
  userId: string;
  locked: boolean;
  onAskAI: (text: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [path, setPath] = useState('App.tsx'),
    [content, setContent] = useState(project.files['App.tsx'] || ''),
    [dirty, setDirty] = useState(false),
    [status, setStatus] = useState('保存済み');
  const [filesOpen, setFilesOpen] = useState(false),
    [search, setSearch] = useState(''),
    [operation, setOperation] = useState(''),
    [newPath, setNewPath] = useState(''),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 }),
    [ready, setReady] = useState(false),
    [undo, setUndo] = useState<string[]>([]);
  const latest = useRef(project),
    draft = useRef(content),
    base = useRef(project.revision),
    original = useRef(content),
    saving = useRef(false),
    dirtyRef = useRef(false),
    pathRef = useRef(path),
    mounted = useRef(true);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null),
    storage = useRef(Promise.resolve());
  const key = (p: string) => 'pf-draft:' + userId + ':' + project.id + ':' + p;
  latest.current = project;
  draft.current = content;
  dirtyRef.current = dirty;
  pathRef.current = path;
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    onDirty(dirty);
  }, [dirty]);
  const persist = (p: string, c: string, b: number) => {
    storage.current = storage.current
      .then(() => AsyncStorage.setItem(key(p), JSON.stringify({ content: c, base: b })))
      .catch(() => {
        if (mounted.current) setStatus('端末への下書き保存に失敗');
      });
  };
  useEffect(() => {
    let active = true;
    setReady(false);
    const p = latest.current;
    original.current = p.files[path] || '';
    base.current = p.revision;
    setContent(original.current);
    setDirty(false);
    setConflict(false);
    setStatus('保存済み');
    setUndo([]);
    void AsyncStorage.getItem(key(path))
      .then((raw) => {
        if (!active) return;
        if (raw) {
          const d = JSON.parse(raw);
          if (d.content !== original.current) {
            setContent(d.content);
            setDirty(true);
            base.current = d.base;
            setStatus('下書きを復元しました');
            setConflict(d.base !== p.revision);
          }
        }
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setReady(true);
          setError('下書きの読み込みに失敗しました。');
        }
      });
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    if (!ready || saving.current) return;
    if (!dirty) {
      original.current = project.files[path] || '';
      base.current = project.revision;
      setContent(original.current);
    } else if ((project.files[path] || '') === original.current) {
      base.current = project.revision;
    } else if (project.revision !== base.current) {
      setConflict(true);
      setStatus('競合 · 下書きを保持');
    }
  }, [project.revision, ready]);
  async function save(force = false): Promise<boolean> {
    if (saving.current) return false;
    if (!dirtyRef.current) return true;
    if (locked || (!force && conflict)) return false;
    saving.current = true;
    setStatus('保存中…');
    const sent = draft.current,
      savePath = pathRef.current;
    try {
      const p = await api<Project>('/projects/' + project.id + '/file', 'PUT', {
        path: savePath,
        content: sent,
        revision: force ? latest.current.revision : base.current,
      });
      base.current = p.revision;
      original.current = sent;
      latest.current = p;
      onProject(p);
      if (mounted.current && pathRef.current === savePath) {
        setConflict(false);
        if (draft.current === sent) {
          setDirty(false);
          dirtyRef.current = false;
          setStatus('保存済み');
          storage.current = storage.current.then(() => AsyncStorage.removeItem(key(savePath)));
        } else {
          setStatus('変更を保存待ち');
          persist(savePath, draft.current, p.revision);
        }
      }
      return true;
    } catch (e) {
      if (mounted.current) {
        setStatus('未保存 · 下書き保持');
        setError(e instanceof Error ? e.message : String(e));
        setConflict(true);
        try {
          onProject(await api<Project>('/projects/' + project.id));
        } catch {}
      }
      return false;
    } finally {
      saving.current = false;
    }
  }
  useEffect(() => {
    if (!ready || !dirty || locked || conflict) return;
    const timer = setTimeout(() => void save(), 850);
    return () => clearTimeout(timer);
  }, [content, dirty, ready, locked, conflict, project.revision]);
  function change(value: string) {
    setUndo((u) => [...u.slice(-29), content]);
    setContent(value);
    draft.current = value;
    setDirty(true);
    dirtyRef.current = true;
    setStatus('下書きを保存中');
    persist(path, value, base.current);
  }
  async function selectFile(p: string) {
    if (dirtyRef.current && !(await save())) {
      setError('現在の下書きを保存するか、競合を解決してからファイルを切り替えてください。');
      return;
    }
    setPath(p);
    setFilesOpen(false);
  }
  function insert(value: string) {
    change(content.slice(0, selection.start) + value + content.slice(selection.end));
    input.current?.focus();
  }
  async function operate() {
    try {
      if (dirtyRef.current && !(await save())) return;
      const p = latest.current;
      let updated: Project;
      if (operation === 'rename')
        updated = await api<Project>('/projects/' + p.id + '/rename', 'POST', {
          from: path,
          to: newPath,
          revision: p.revision,
        });
      else if (operation === 'delete')
        updated = await api<Project>('/projects/' + p.id + '/file', 'DELETE', {
          path,
          revision: p.revision,
        });
      else {
        const target = operation === 'folder' ? newPath + '/.gitkeep' : newPath;
        if (target in p.files) throw new Error('同名のファイルが存在します。');
        updated = await api<Project>('/projects/' + p.id + '/file', 'PUT', {
          path: target,
          content: '',
          revision: p.revision,
        });
      }
      onProject(updated);
      setPath(
        operation === 'delete'
          ? Object.keys(updated.files)[0] || 'App.tsx'
          : operation === 'folder'
            ? newPath + '/.gitkeep'
            : newPath,
      );
      setOperation('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={s.between}>
        <Button
          small
          kind="secondary"
          label={path}
          icon="file-text"
          onPress={() => setFilesOpen(true)}
        />
        <View style={s.row}>
          <Badge label={status} color={dirty ? '#52525B' : '#52525B'} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ファイル操作"
            onPress={() => {
              setOperation('menu');
              setNewPath(path);
            }}
            style={{ padding: 9 }}
          >
            <Icon name="more-horizontal" />
          </Pressable>
        </View>
      </View>
      {conflict && (
        <View style={[s.card, { backgroundColor: '#F4F4F5', padding: 14, gap: 9 }]}>
          <Txt size={12}>
            保存済みの内容と下書きを比較してください。下書きは端末に残っています。
          </Txt>
          <Button
            small
            kind="secondary"
            label="最新の内容と比較"
            onPress={() => setOperation('conflict')}
          />
        </View>
      )}
      <View
        style={{
          backgroundColor: '#18181B',
          borderRadius: 18,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: '#3F3F46',
        }}
      >
        <View style={[s.between, { padding: 14, borderBottomWidth: 1, borderColor: '#3F3F46' }]}>
          <View style={s.row}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: dirty ? '#A1A1AA' : C.highlight,
              }}
            />
            <Txt size={11} color="#D4D4D8">
              {path}
            </Txt>
          </View>
          <Txt size={10} color="#A1A1AA">
            UTF-8 · {path.endsWith('tsx') ? 'TSX' : 'TEXT'}
          </Txt>
        </View>
        <ScrollView horizontal keyboardShouldPersistTaps="handled">
          <View
            style={{ flexDirection: 'row', minWidth: 650, minHeight: 360, paddingVertical: 15 }}
          >
            <View style={{ paddingHorizontal: 16, borderRightWidth: 1, borderColor: '#3F3F46' }}>
              {content.split('\n').map((_, i) => (
                <Txt
                  key={i}
                  size={12}
                  color="#A1A1AA"
                  style={{ fontFamily: 'monospace', lineHeight: 23, textAlign: 'right' }}
                >
                  {i + 1}
                </Txt>
              ))}
            </View>
            <TextInput
              ref={input}
              accessibilityLabel="ソースコード"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              value={content}
              onChangeText={change}
              onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
              editable={ready && !locked}
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 23,
                color: '#E4E4E7',
                minWidth: 580,
                paddingHorizontal: 16,
                paddingVertical: 0,
                textAlignVertical: 'top',
                flex: 1,
              }}
            />
          </View>
        </ScrollView>
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 7, padding: 12, borderTopWidth: 1, borderColor: '#3F3F46' }}
        >
          {['  ', '{ }', '( )', '[ ]', '=>', ';', '/'].map((t) => (
            <Pressable
              key={t}
              accessibilityRole="button"
              accessibilityLabel={t === '  ' ? 'インデント' : t + 'を入力'}
              onPress={() => insert(t)}
              disabled={locked}
              style={{
                minWidth: 38,
                backgroundColor: '#3F3F46',
                padding: 9,
                borderRadius: 7,
                alignItems: 'center',
              }}
            >
              <Txt size={12} color="#E4E4E7" style={{ fontFamily: 'monospace' }}>
                {t === '  ' ? '⇥' : t}
              </Txt>
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              if (undo.length) {
                const v = undo[undo.length - 1];
                setUndo(undo.slice(0, -1));
                setContent(v);
                draft.current = v;
                setDirty(true);
                persist(path, v, base.current);
              }
            }}
            style={{ padding: 9 }}
          >
            <Icon name="corner-up-left" size={16} color="#E4E4E7" />
          </Pressable>
        </ScrollView>
      </View>
      <View style={s.between}>
        <Button
          label="保存する"
          small
          icon="save"
          onPress={() => void save()}
          disabled={!dirty || locked || conflict}
        />
        <Button
          label="選択部分をAIに相談"
          small
          kind="secondary"
          icon="zap"
          onPress={() =>
            onAskAI(
              'ファイル ' +
                path +
                ' の次のコードについて相談したいです。\n\n' +
                content.slice(selection.start, selection.end || Math.min(content.length, 1200)),
            )
          }
          disabled={locked}
        />
      </View>
      <Txt size={11} color={C.muted}>
        入力後に自動保存します。未保存の下書きはこの端末に保持されます。
      </Txt>
      <Sheet visible={filesOpen} title="ファイル" onClose={() => setFilesOpen(false)}>
        <Field placeholder="ファイル名・コードを検索" value={search} onChangeText={setSearch} />
        <View style={s.row}>
          <Button
            small
            label="ファイルを追加"
            icon="file-plus"
            onPress={() => {
              setFilesOpen(false);
              setNewPath('');
              setOperation('create');
            }}
          />
          <Button
            small
            kind="secondary"
            label="フォルダを追加"
            icon="folder-plus"
            onPress={() => {
              setFilesOpen(false);
              setNewPath('');
              setOperation('folder');
            }}
          />
        </View>
        {Object.entries(project.files)
          .filter(
            ([p, c]) =>
              !search ||
              p.toLowerCase().includes(search.toLowerCase()) ||
              c.toLowerCase().includes(search.toLowerCase()),
          )
          .map(([p, c]) => (
            <Pressable
              key={p}
              onPress={() => void selectFile(p)}
              style={[
                s.row,
                { padding: 12, borderRadius: 12, backgroundColor: p === path ? C.soft : C.white },
              ]}
            >
              <Icon name="file-text" size={16} />
              <View style={{ flex: 1 }}>
                <Txt size={12} bold={p === path}>
                  {p}
                </Txt>
                {search && !p.includes(search) && (
                  <Txt size={10} color={C.muted}>
                    {c
                      .split('\n')
                      .find((l) => l.toLowerCase().includes(search.toLowerCase()))
                      ?.slice(0, 90)}
                  </Txt>
                )}
              </View>
              <Txt size={10} color={C.muted}>
                {c.length} chars
              </Txt>
            </Pressable>
          ))}
      </Sheet>
      <Sheet
        visible={!!operation}
        title={operation === 'conflict' ? '保存内容の比較' : 'ファイル操作'}
        onClose={() => setOperation('')}
      >
        {operation === 'menu' ? (
          <>
            <Button
              label="名前を変更"
              icon="edit-2"
              kind="secondary"
              onPress={() => setOperation('rename')}
            />
            <Button
              label="ファイルを削除"
              icon="trash-2"
              kind="danger"
              onPress={() => setOperation('delete')}
            />
          </>
        ) : operation === 'conflict' ? (
          <>
            <Txt bold size={12}>
              サーバーの最新版
            </Txt>
            <Txt style={s.mono}>{project.files[path] || '(ファイルなし)'}</Txt>
            <Txt bold size={12}>
              この端末の下書き
            </Txt>
            <Txt style={s.mono}>{content}</Txt>
            <Button
              label="この下書きで保存し直す"
              onPress={() =>
                void save(true).then((ok) => {
                  if (ok) setOperation('');
                })
              }
            />
            <Button
              label="最新版を読み込む（下書きは退避）"
              kind="secondary"
              onPress={() => {
                void AsyncStorage.setItem(key(path) + ':backup', content);
                void AsyncStorage.removeItem(key(path));
                setContent(project.files[path] || '');
                original.current = project.files[path] || '';
                base.current = project.revision;
                setDirty(false);
                setConflict(false);
                setStatus('保存済み');
                setOperation('');
              }}
            />
          </>
        ) : (
          <>
            {operation === 'delete' ? (
              <Txt>{path} を削除します。削除前の状態は履歴から復元できます。</Txt>
            ) : (
              <Field
                label={operation === 'folder' ? 'フォルダパス' : 'ファイルパス'}
                placeholder="src/NewScreen.tsx"
                value={newPath}
                onChangeText={setNewPath}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            <Button
              label={operation === 'delete' ? '削除する' : '適用する'}
              kind={operation === 'delete' ? 'danger' : 'primary'}
              onPress={() => void operate()}
              disabled={locked}
            />
          </>
        )}
      </Sheet>
      <Sheet visible={!!error} title="下書きは保持されています" onClose={() => setError('')}>
        <Txt>{error}</Txt>
        <Button label="閉じる" onPress={() => setError('')} />
      </Sheet>
    </View>
  );
}
