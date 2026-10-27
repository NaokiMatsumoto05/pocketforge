import { z } from 'zod';
export { normalizeServerUrl } from './server-url.ts';

export const AI_PROVIDERS = ['openai', 'anthropic', 'xai', 'gemini'] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];
export const INTEGRATION_PROVIDERS = [...AI_PROVIDERS, 'e2b', 'expo'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];
export const AI_PROVIDER_INFO = {
  openai: {
    label: 'OpenAI',
    settingsLabel: 'OpenAI',
    guide: 'https://developers.openai.com/api/docs/quickstart',
  },
  anthropic: {
    label: 'Claude',
    settingsLabel: 'Anthropic',
    guide: 'https://platform.claude.com/docs/en/api/overview',
  },
  xai: {
    label: 'Grok',
    settingsLabel: 'Grok (xAI)',
    guide: 'https://docs.x.ai/developers/quickstart',
  },
  gemini: {
    label: 'Gemini',
    settingsLabel: 'Gemini',
    guide: 'https://ai.google.dev/gemini-api/docs/api-key',
  },
} as const;
export function isAIProvider(provider: string): provider is AIProvider {
  return AI_PROVIDERS.some((p) => p === provider);
}

export const MAX_FILES = 250;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
export type Files = Record<string, string>;
export const filePath = z
  .string()
  .min(1)
  .max(180)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('\\') &&
      !/[\x00-\x1f]/.test(p) &&
      p
        .split('/')
        .every(
          (s) =>
            !!s &&
            s !== '.' &&
            s !== '..' &&
            !['.git', 'node_modules', '.expo', '__proto__', 'constructor', 'prototype'].includes(s),
        ) &&
      !p.split('/').some((s) => s === '.env' || (s.startsWith('.env.') && s !== '.env.example')),
    '相対パスを指定してください。.git・node_modules・秘密情報ファイルは編集対象外です。',
  );
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const designSchema = z
  .object({
    title: z.string().min(1).max(80),
    subtitle: z.string().max(180),
    button: z.string().min(1).max(40),
    accent: color,
    background: color,
    text: color,
    radius: z.number().int().min(0).max(40),
    spacing: z.number().int().min(8).max(48),
    fontSize: z.number().int().min(18).max(42),
    cards: z
      .array(z.object({ title: z.string().min(1).max(80), body: z.string().max(180) }))
      .max(6),
  })
  .strict();
export type Design = z.infer<typeof designSchema>;
export const defaultDesign: Design = {
  title: '小さな一歩を、毎日に。',
  subtitle: 'あなたのペースで、今日をつくろう。',
  button: '今日の記録を追加',
  accent: '#B9F27C',
  background: '#F7F8F2',
  text: '#18241D',
  radius: 20,
  spacing: 24,
  fontSize: 28,
  cards: [
    { title: '朝の散歩', body: '外の空気を吸って、気持ちよくスタート。' },
    { title: '読書の時間', body: '10ページから、新しい発見を。' },
  ],
};
export function generateDesign(d: Design) {
  const serialized = JSON.stringify(d, null, 2);
  return `// PocketForge visual editor: edit design.json or use the Design tab.\nimport React, { useState } from 'react';\nimport { View, Text, Pressable, ScrollView } from 'react-native';\nexport const design = ${serialized};\nexport default function HomeScreen() {\n  const [count, setCount] = useState(0);\n  return <ScrollView style={{flex:1,backgroundColor:design.background}} contentContainerStyle={{padding:design.spacing,paddingTop:64,gap:18}}>\n    <Text style={{fontSize:12,letterSpacing:3,color:design.text}}>MAKE ROOM FOR TODAY</Text>\n    <Text style={{fontSize:design.fontSize,fontWeight:'700',color:design.text}}>{design.title}</Text>\n    <Text style={{fontSize:15,lineHeight:24,color:design.text,opacity:0.6}}>{design.subtitle}</Text>\n    {design.cards.map((card,i)=><View key={i} style={{padding:20,borderRadius:design.radius,backgroundColor:'#FFFFFF',gap:8}}><Text style={{fontSize:17,fontWeight:'600',color:design.text}}>{card.title}</Text><Text style={{fontSize:14,color:design.text,opacity:0.6}}>{card.body}</Text></View>)}\n    <Pressable accessibilityRole="button" onPress={()=>setCount(count+1)} style={{padding:18,borderRadius:design.radius,backgroundColor:design.accent}}><Text style={{textAlign:'center',fontWeight:'700',color:design.text}}>{design.button}{count > 0 ? ' · '+count : ''}</Text></Pressable>\n  </ScrollView>;\n}\n`;
}
export function templateFiles(name: string): Files {
  const d = { ...defaultDesign };
  return {
    'App.tsx':
      "import React from 'react';\nimport HomeScreen from './src/HomeScreen';\nexport default function App() { return <HomeScreen />; }\n",
    'index.ts':
      "import { registerRootComponent } from 'expo';\nimport App from './App';\nregisterRootComponent(App);\n",
    'src/HomeScreen.tsx': generateDesign(d),
    'design.json': JSON.stringify(d, null, 2) + '\n',
    'package.json':
      JSON.stringify(
        {
          name: 'my-mobile-app',
          version: '1.0.0',
          private: true,
          main: 'index.ts',
          scripts: { start: 'expo start', web: 'expo start --web', typecheck: 'tsc --noEmit' },
          dependencies: {
            expo: '~58.0.19',
            react: '19.3.0',
            'react-native': '0.88.0',
            'react-dom': '19.3.0',
            'react-native-web': '^0.21.0',
            '@expo/metro-runtime': '~58.0.15',
            'expo-dev-client': '~58.0.15',
          },
          devDependencies: { typescript: '~6.0.3', '@types/react': '~19.3.0' },
        },
        null,
        2,
      ) + '\n',
    'app.json':
      JSON.stringify(
        {
          expo: {
            name,
            slug: 'my-mobile-app',
            version: '1.0.0',
            orientation: 'portrait',
            userInterfaceStyle: 'light',
            web: { bundler: 'metro' },
          },
        },
        null,
        2,
      ) + '\n',
    'tsconfig.json': '{"extends":"expo/tsconfig.base","compilerOptions":{"strict":true}}\n',
    'eas.json':
      JSON.stringify(
        {
          cli: { appVersionSource: 'remote' },
          build: {
            development: { developmentClient: true, distribution: 'internal' },
            preview: { distribution: 'internal', android: { buildType: 'apk' } },
            production: { autoIncrement: true },
          },
        },
        null,
        2,
      ) + '\n',
    '.gitignore': 'node_modules/\n.expo/\ndist/\n.env\n',
    'README.md': `# ${name}\n\nCreated with PocketForge.\n\nEdit source code from your phone. Use the Design tab for supported components.\nCloud execution requires your E2B connection. EAS requires an Expo project and signing setup.\n`,
  };
}
export function readDesign(files: Files): { design: Design; supported: boolean } | null {
  try {
    const design = designSchema.parse(JSON.parse(files['design.json']));
    return { design, supported: files['src/HomeScreen.tsx'] === generateDesign(design) };
  } catch {
    return null;
  }
}
export type Project = {
  id: string;
  name: string;
  description: string;
  files: Files;
  revision: number;
  createdAt: string;
  updatedAt: string;
  sandboxId: string | null;
  sandboxState: string;
  sandboxExpiresAt: number | null;
};
export type ProjectSummary = Omit<Project, 'files'> & { fileCount: number };
export type Event = {
  id: number;
  projectId: string;
  kind: string;
  message: string;
  createdAt: string;
};
export type Snapshot = { id: string; label: string; createdAt: string; revision: number };
export type ConnectionStatus = {
  provider: IntegrationProvider;
  configured: boolean;
  model: string;
};
export type Job = {
  id: string;
  projectId: string;
  kind: string;
  status: 'running' | 'complete' | 'failed';
  result: string;
  createdAt: string;
};
