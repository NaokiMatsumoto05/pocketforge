import React, { useState, useEffect, useRef } from 'react';
import { View, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { readDesign, type Project, type Design as DesignData } from '@pocketforge/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { C, s, Txt, Icon, Button, Field, Badge, Empty } from './ui';

export function Design({
  project,
  onProject,
  locked,
  notify,
  previewOnly = false,
}: {
  project: Project;
  onProject: (p: Project) => void;
  locked: boolean;
  notify: (e: unknown) => void;
  previewOnly?: boolean;
}) {
  const parsed = readDesign(project.files),
    [design, setDesign] = useState<DesignData | null>(parsed?.design ?? null),
    [selected, setSelected] = useState('title'),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [count, setCount] = useState(0);
  const { width } = useWindowDimensions(),
    wide = width >= 1150;
  const designBase = useRef(project.revision),
    draftKey = 'pf-design:' + project.id;
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (!previewOnly)
      void AsyncStorage.getItem(draftKey)
        .then((raw) => {
          if (raw) {
            const d = JSON.parse(raw);
            setDesign(d.design);
            designBase.current = d.revision;
            setDirty(true);
            setConflict(d.revision !== project.revision);
          }
        })
        .catch(() => {});
  }, []);
  useEffect(() => {
    if (dirty && !previewOnly) {
      setConflict(project.revision !== designBase.current);
      return;
    }
    setDesign(readDesign(project.files)?.design ?? null);
    designBase.current = project.revision;
    setDirty(false);
  }, [project.revision]);
  if (!design || !parsed?.supported)
    return (
      <Empty
        icon="shield"
        title="この画面は手動編集されています"
        body="対応コンポーネントの構造が変わっているため、デザイン編集と簡易プレビューを停止しました。コードを確認するか、履歴から対応する状態へ復元してください。"
      />
    );
  const update = (p: Partial<DesignData>) => {
    const next = { ...design, ...p };
    setDesign(next);
    setDirty(true);
    void AsyncStorage.setItem(
      draftKey,
      JSON.stringify({ design: next, revision: designBase.current }),
    ).catch(() => notify(new Error('デザインの端末保存に失敗しました。変更を適用してください。')));
  };
  async function save() {
    setSaving(true);
    try {
      const p = await api<Project>('/projects/' + project.id + '/design', 'PUT', {
        design,
        revision: designBase.current,
      });
      designBase.current = p.revision;
      setDirty(false);
      setConflict(false);
      onProject(p);
      await AsyncStorage.removeItem(draftKey);
    } catch (e) {
      notify(e);
    } finally {
      setSaving(false);
    }
  }
  function selectable(key: string) {
    return {
      borderWidth: !previewOnly && selected === key ? 1 : 0,
      borderColor: '#18181B',
      borderStyle: 'dashed' as const,
      borderRadius: 4,
      padding: !previewOnly && selected === key ? 3 : 4,
    };
  }
  return (
    <View style={{ gap: 16 }}>
      {conflict && (
        <View style={[s.card, { backgroundColor: '#F4F4F5', gap: 10 }]}>
          <Txt size={12}>
            デザインの下書きを保持しています。別の操作でソースが更新されました。最新版を確認してから適用してください。
          </Txt>
          <Button
            small
            label="この下書きを新しい編集として適用"
            onPress={() => {
              designBase.current = project.revision;
              setConflict(false);
            }}
          />
        </View>
      )}
      <View style={s.between}>
        <View style={s.row}>
          <Badge label="対応コンポーネント" />
          <Txt size={10} color={C.muted}>
            HomeScreen.tsx
          </Txt>
        </View>
        {previewOnly ? (
          <Button
            small
            kind="secondary"
            label="リロード"
            icon="rotate-cw"
            onPress={() => setCount(0)}
          />
        ) : (
          <Button
            small
            label={dirty ? '変更を適用' : 'ソースに反映済み'}
            icon={dirty ? 'check' : 'check-circle'}
            onPress={() => void save()}
            disabled={!dirty || locked || conflict}
            loading={saving}
          />
        )}
      </View>
      <View
        style={{
          flexDirection: wide && !previewOnly ? 'row' : 'column',
          gap: 20,
          alignItems: wide ? 'flex-start' : 'stretch',
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: '#F4F4F5',
            borderRadius: 22,
            padding: 22,
            alignItems: 'center',
            gap: 12,
          }}
        >
          <View style={s.row}>
            <Icon name="smartphone" size={14} color={C.muted} />
            <Txt size={10} color={C.muted}>
              DESIGN PREVIEW
            </Txt>
          </View>
          <View
            style={{
              width: '100%',
              maxWidth: 335,
              backgroundColor: design.background,
              borderWidth: 6,
              borderColor: C.dark,
              borderRadius: 34,
              overflow: 'hidden',
              minHeight: 510,
            }}
          >
            <View style={[s.between, { paddingHorizontal: 22, paddingTop: 12 }]}>
              <Txt size={10} bold>
                9:41
              </Txt>
              <View style={s.row}>
                <Icon name="wifi" size={11} />
                <Icon name="battery" size={14} />
              </View>
            </View>
            <View
              style={{
                width: 65,
                height: 5,
                borderRadius: 4,
                backgroundColor: C.ink,
                alignSelf: 'center',
                marginTop: 8,
              }}
            />
            <View style={{ padding: design.spacing, paddingTop: 30, gap: 18 }}>
              <Txt size={9} color={design.text} style={{ letterSpacing: 2 }}>
                MAKE ROOM FOR TODAY
              </Txt>
              <Pressable onPress={() => setSelected('title')} style={selectable('title')}>
                <Txt
                  size={design.fontSize}
                  bold
                  color={design.text}
                  style={{ lineHeight: design.fontSize * 1.35 }}
                >
                  {design.title}
                </Txt>
              </Pressable>
              <Pressable onPress={() => setSelected('subtitle')} style={selectable('subtitle')}>
                <Txt size={13} color={design.text} style={{ opacity: 0.6 }}>
                  {design.subtitle}
                </Txt>
              </Pressable>
              {design.cards.map((card, i) => (
                <Pressable
                  key={i}
                  onPress={() => setSelected('card' + i)}
                  style={{
                    padding: 18,
                    borderRadius: design.radius,
                    backgroundColor: C.white,
                    gap: 7,
                    borderColor: '#18181B',
                    borderWidth: !previewOnly && selected === 'card' + i ? 1 : 0,
                  }}
                >
                  <View style={s.row}>
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 7,
                        backgroundColor: design.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={i % 2 ? 'book-open' : 'sun'} size={12} color={design.text} />
                    </View>
                    <Txt size={14} bold color={design.text}>
                      {card.title}
                    </Txt>
                  </View>
                  <Txt size={11} color={design.text} style={{ opacity: 0.6 }}>
                    {card.body}
                  </Txt>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSelected('button');
                  setCount(count + 1);
                }}
                style={{ padding: 16, borderRadius: design.radius, backgroundColor: design.accent }}
              >
                <Txt size={13} bold color={design.text} style={{ textAlign: 'center' }}>
                  {design.button}
                  {count > 0 ? ' · ' + count : ''}
                </Txt>
              </Pressable>
            </View>
            <View
              style={{
                width: 90,
                height: 4,
                borderRadius: 4,
                backgroundColor: C.ink,
                alignSelf: 'center',
                marginBottom: 12,
                marginTop: 'auto',
              }}
            />
          </View>
          <Txt size={10} color={C.muted}>
            対応デザインの表示確認 · ネイティブ実行ではありません
          </Txt>
        </View>
        {!previewOnly && (
          <View style={[s.card, { width: wide ? 280 : '100%', gap: 18, padding: 20 }]}>
            <View style={s.row}>
              <Icon name="sliders" size={17} />
              <Txt bold>インスペクター</Txt>
            </View>
            <Txt size={11} color={C.muted}>
              プレビューの要素をタップして選択
            </Txt>
            <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>
              {['title', 'subtitle', 'button', ...design.cards.map((_, i) => 'card' + i)].map(
                (key) => (
                  <Button
                    key={key}
                    small
                    kind={selected === key ? 'primary' : 'secondary'}
                    label={
                      key === 'title'
                        ? '見出し'
                        : key === 'subtitle'
                          ? '説明'
                          : key === 'button'
                            ? 'ボタン'
                            : 'カード ' + (Number(key.slice(4)) + 1)
                    }
                    onPress={() => setSelected(key)}
                  />
                ),
              )}
            </ScrollView>
            {selected.startsWith('card') ? (
              (() => {
                const index = Number(selected.slice(4)),
                  card = design.cards[index];
                return card ? (
                  <>
                    <Field
                      label="カードの見出し"
                      value={card.title}
                      onChangeText={(v) =>
                        update({
                          cards: design.cards.map((c, i) => (i === index ? { ...c, title: v } : c)),
                        })
                      }
                    />
                    <Field
                      label="カードの説明"
                      multiline
                      value={card.body}
                      onChangeText={(v) =>
                        update({
                          cards: design.cards.map((c, i) => (i === index ? { ...c, body: v } : c)),
                        })
                      }
                    />
                  </>
                ) : null;
              })()
            ) : (
              <Field
                label={
                  selected === 'title'
                    ? '見出し'
                    : selected === 'subtitle'
                      ? '説明文'
                      : 'ボタンのテキスト'
                }
                value={design[selected as 'title' | 'subtitle' | 'button']}
                onChangeText={(v) => update({ [selected]: v })}
                multiline={selected !== 'button'}
              />
            )}
            <View style={s.divider} />
            <Txt size={11} bold color={C.muted}>
              アクセントカラー
            </Txt>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {['#B9F27C', '#A8C8F8', '#D6B5F5', '#F3BC9E', '#9CDBC6'].map((color) => (
                <Pressable
                  key={color}
                  accessibilityRole="button"
                  accessibilityLabel={'カラー ' + color}
                  onPress={() => update({ accent: color })}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: color,
                    borderWidth: design.accent === color ? 2 : 0,
                    borderColor: C.ink,
                  }}
                />
              ))}
            </View>
            <Field
              label="カラーコード"
              value={design.accent}
              onChangeText={(v) => update({ accent: v })}
              autoCapitalize="none"
              maxLength={7}
            />
            {(
              [
                { key: 'fontSize', label: '文字サイズ', min: 18, max: 42 },
                { key: 'radius', label: '角の丸み', min: 0, max: 40 },
                { key: 'spacing', label: '余白', min: 8, max: 48 },
              ] as const
            ).map((x) => (
              <View key={x.key} style={s.between}>
                <Txt size={12}>{x.label}</Txt>
                <View style={s.row}>
                  <Button
                    small
                    kind="secondary"
                    label="−"
                    onPress={() => update({ [x.key]: Math.max(x.min, design[x.key] - 2) })}
                  />
                  <Txt size={12} bold>
                    {design[x.key]}
                  </Txt>
                  <Button
                    small
                    kind="secondary"
                    label="＋"
                    onPress={() => update({ [x.key]: Math.min(x.max, design[x.key] + 2) })}
                  />
                </View>
              </View>
            ))}
            <Txt size={10} color={C.muted}>
              適用するとdesign.jsonとHomeScreen.tsxが同時に更新され、履歴に保存されます。
            </Txt>
          </View>
        )}
      </View>
      {previewOnly && (
        <View style={[s.card, { gap: 9 }]}>
          <Txt bold>実機で確かめるには</Txt>
          <Txt size={12} color={C.muted}>
            クラウド環境でExpoを起動し、Expo GoまたはDevelopment
            Buildから接続します。通知・カメラ・独自ネイティブ機能はDevelopment
            Buildで検証してください。この簡易プレビューは任意のソースコードを実行しません。
          </Txt>
        </View>
      )}
    </View>
  );
}
