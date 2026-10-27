import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import type { ProjectSummary } from '@pocketforge/core';
import { C, s, Txt, Icon, Button, Field, Badge, Empty } from './ui';

export function Home({
  name,
  projects,
  wide,
  onCreate,
  onOpen,
}: {
  name: string;
  projects: ProjectSummary[];
  wide: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState(''),
    compact = useWindowDimensions().width < 380;
  return (
    <ScrollView
      contentContainerStyle={{ padding: wide ? 38 : 20, paddingBottom: 50, gap: 28 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[s.between, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, gap: 6 }}>
          <Txt size={11} color={C.muted}>
            {compact ? 'おかえりなさい' : 'おかえりなさい、' + name + 'さん'}
          </Txt>
          <Txt size={wide ? 28 : compact ? 22 : 24} bold>
            {compact ? 'スタジオ' : 'あなたのスタジオ'}
          </Txt>
        </View>
        <Button
          label={wide ? '新規プロジェクト' : '新規作成'}
          icon="plus"
          onPress={onCreate}
          small={!wide}
        />
      </View>
      <View style={[a.hero, { padding: wide ? 34 : 26, flexDirection: wide ? 'row' : 'column' }]}>
        <View style={{ flex: 1, gap: 19, zIndex: 1 }}>
          <View style={s.row}>
            <View style={{ width: 22, height: 1, backgroundColor: '#A1A1AA' }} />
            <Txt size={10} bold color="#52525B" style={{ letterSpacing: 2 }}>
              IDEAS GO EVERYWHERE.
            </Txt>
          </View>
          <Txt
            size={wide ? 37 : compact ? 24 : 30}
            bold
            style={{ lineHeight: wide ? 52 : compact ? 36 : 44, letterSpacing: -1 }}
          >
            アイデアを、{'\n'}その手で動かそう。
          </Txt>
          <Txt color="#71717A" size={13}>
            AIとつくる。コードでこだわる。{'\n'}スマートフォンから、あなたのアプリを。
          </Txt>
          <View style={s.row}>
            <Pressable onPress={onCreate} style={[s.row, { paddingVertical: 8 }]}>
              <Txt size={12} bold>
                最初の一歩をはじめる
              </Txt>
              <Icon name="arrow-up-right" size={16} />
            </Pressable>
            {wide && (
              <>
                <View style={{ width: 1, height: 18, backgroundColor: '#D4D4D8' }} />
                <Txt size={10} color="#71717A">
                  React Native + Expo
                </Txt>
              </>
            )}
          </View>
        </View>
        <View
          style={{
            width: wide ? 240 : '100%',
            height: wide ? 250 : 100,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={[a.orbit, { width: wide ? 225 : 155, height: wide ? 225 : 155 }]} />
          <View
            style={[
              a.phone,
              { transform: [{ rotate: '9deg' }], width: wide ? 117 : 80, height: wide ? 201 : 125 },
            ]}
          >
            <View
              style={{
                width: 30,
                height: 5,
                borderRadius: 9,
                backgroundColor: '#52525B',
                alignSelf: 'center',
                marginBottom: 12,
              }}
            />
            <View
              style={{
                height: wide ? 65 : 35,
                borderRadius: 10,
                backgroundColor: C.highlight,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Icon name="code" size={wide ? 30 : 23} />
            </View>
            {wide && (
              <>
                <View
                  style={{
                    height: 5,
                    width: '72%',
                    backgroundColor: '#A1A1AA',
                    borderRadius: 5,
                    marginTop: 15,
                  }}
                />
                <View
                  style={{
                    height: 4,
                    width: '93%',
                    backgroundColor: '#52525B',
                    borderRadius: 5,
                    marginTop: 7,
                  }}
                />
                <View
                  style={{
                    height: 4,
                    width: '60%',
                    backgroundColor: '#52525B',
                    borderRadius: 5,
                    marginTop: 7,
                  }}
                />
                <View
                  style={{ height: 17, backgroundColor: '#52525B', borderRadius: 5, marginTop: 14 }}
                />
              </>
            )}
          </View>
          <View
            style={[
              a.float,
              { right: wide ? 4 : 30, top: wide ? 48 : 17, backgroundColor: C.white },
            ]}
          >
            <Icon name="zap" size={16} />
            <Txt size={10} bold>
              Build your next.
            </Txt>
          </View>
          {wide && (
            <View style={[a.float, { left: -10, bottom: 29, backgroundColor: '#FFFFFF' }]}>
              <View style={{ width: 6, height: 6, borderRadius: 4, backgroundColor: '#52525B' }} />
              <Txt size={10} bold>
                Your pocket. Your studio.
              </Txt>
            </View>
          )}
        </View>
      </View>
      <View style={{ gap: 15 }}>
        <View style={s.between}>
          <View style={s.row}>
            <Txt size={compact ? 16 : 18} bold>
              プロジェクト
            </Txt>
            <Badge label={String(projects.length)} />
          </View>
          <View style={{ width: wide ? 230 : compact ? 120 : 145 }}>
            <Field
              placeholder="プロジェクトを検索"
              value={query}
              onChangeText={setQuery}
              style={{ minHeight: 38, paddingVertical: 8, fontSize: 11 }}
            />
          </View>
        </View>
        {projects.length === 0 ? (
          <View style={[s.card, { borderStyle: 'dashed' }]}>
            <Empty
              icon="folder-plus"
              title="まだ、白紙。それがいい。"
              body="あなたのアイデアを、最初のプロジェクトに。ソースはいつでも編集・エクスポートできます。"
            >
              <Button label="プロジェクトをつくる" icon="plus" onPress={onCreate} />
            </Empty>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {projects
              .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
              .map((p, i) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={p.name + 'を開く'}
                  onPress={() => onOpen(p.id)}
                  style={({ pressed }) => [
                    s.card,
                    {
                      width: wide ? '48%' : '100%',
                      padding: 0,
                      overflow: 'hidden',
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <View
                    style={{
                      height: 122,
                      backgroundColor: ['#F4F4F5', '#EEEEEF', '#E4E4E7'][i % 3],
                      padding: 22,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <View style={{ gap: 8 }}>
                      <Txt size={9} bold color="#71717A" style={{ letterSpacing: 2 }}>
                        EXPO PROJECT
                      </Txt>
                      <Txt size={25} bold>
                        {p.name.slice(0, 18)}
                      </Txt>
                    </View>
                    <View
                      style={{
                        width: 50,
                        height: 68,
                        borderRadius: 10,
                        backgroundColor: C.white,
                        transform: [{ rotate: '8deg' }],
                        padding: 7,
                        gap: 6,
                      }}
                    >
                      <View
                        style={{
                          height: 22,
                          backgroundColor: ['#3F3F46', '#52525B', '#71717A'][i % 3],
                          borderRadius: 5,
                        }}
                      />
                      <View style={{ height: 3, backgroundColor: C.line, borderRadius: 3 }} />
                      <View
                        style={{
                          height: 3,
                          width: '70%',
                          backgroundColor: C.line,
                          borderRadius: 3,
                        }}
                      />
                    </View>
                  </View>
                  <View style={{ padding: 20, gap: 12 }}>
                    <View style={s.between}>
                      <Txt size={16} bold>
                        {p.name}
                      </Txt>
                      <Icon name="arrow-up-right" size={18} />
                    </View>
                    <Txt size={12} color={C.muted}>
                      {p.description || '新しいアプリの可能性を、ここから。'}
                    </Txt>
                    <View style={s.between}>
                      <Badge label={p.fileCount + ' files · Expo'} />
                      <Txt size={10} color={C.muted}>
                        {new Date(p.updatedAt).toLocaleDateString('ja-JP')} 更新
                      </Txt>
                    </View>
                  </View>
                </Pressable>
              ))}
          </View>
        )}
      </View>
      <View style={{ gap: 14 }}>
        <Txt size={15} bold>
          つくり方は、あなた次第。
        </Txt>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12 }}>
          {(
            [
              {
                icon: 'zap',
                title: 'AIに相談する',
                body: 'アイデアを言葉に。AIと一緒に形に。',
                color: '#F4F4F5',
              },
              {
                icon: 'code',
                title: 'コードでつくる',
                body: 'ファイルもターミナルも、手のひらで。',
                color: '#F4F4F5',
              },
              {
                icon: 'layout',
                title: '見た目からつくる',
                body: '色や余白を整えて、ソースに反映。',
                color: '#F4F4F5',
              },
            ] as const
          ).map((x) => (
            <View
              key={x.title}
              style={[
                s.card,
                { flex: 1, padding: 18, borderRadius: 18, flexDirection: 'row', gap: 13 },
              ]}
            >
              <View style={[s.iconBox, { backgroundColor: x.color }]}>
                <Icon name={x.icon} size={18} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Txt size={12} bold>
                  {x.title}
                </Txt>
                <Txt size={10} color={C.muted}>
                  {x.body}
                </Txt>
              </View>
            </View>
          ))}
        </View>
      </View>
      <View style={[s.between, { paddingTop: 8 }]}>
        <Txt size={10} color={C.muted}>
          少しのひらめきから、大きな可能性へ。
        </Txt>
        <Txt size={10} color={C.muted}>
          PocketForge / 0.1
        </Txt>
      </View>
    </ScrollView>
  );
}
const a = StyleSheet.create({
  hero: {
    backgroundColor: '#F4F4F5',
    borderRadius: 20,
    overflow: 'hidden',
    gap: 22,
    minHeight: 280,
  },
  orbit: {
    position: 'absolute',
    borderRadius: 200,
    borderWidth: 1,
    borderColor: '#D4D4D8',
    transform: [{ rotate: '20deg' }],
  },
  phone: {
    backgroundColor: '#18181B',
    borderRadius: 22,
    padding: 12,
    borderWidth: 4,
    borderColor: '#3F3F46',
    shadowColor: '#18181B',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  float: {
    position: 'absolute',
    borderRadius: 12,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    shadowColor: '#18181B',
    shadowOpacity: 0.08,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
  },
});
