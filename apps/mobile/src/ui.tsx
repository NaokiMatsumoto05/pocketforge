import React, { type ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';

export const C = {
  bg: '#FAFAFA',
  white: '#FFFFFF',
  ink: '#18181B',
  muted: '#71717A',
  line: '#E4E4E7',
  accent: '#18181B',
  highlight: '#E4E4E7',
  dark: '#18181B',
  soft: '#F4F4F5',
  danger: '#B94436',
};
export function Icon({
  name,
  size = 20,
  color = C.ink,
}: {
  name: React.ComponentProps<typeof Feather>['name'];
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}
export function Txt({
  children,
  size = 14,
  color = C.ink,
  bold = false,
  style,
  selectable = false,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  bold?: boolean;
  style?: any;
  selectable?: boolean;
}) {
  return (
    <Text
      selectable={selectable}
      style={[
        { fontSize: size, color, fontWeight: bold ? '700' : '400', lineHeight: size * 1.6 },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Button({
  label,
  onPress,
  icon,
  kind = 'primary',
  disabled = false,
  small = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>['name'];
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
  loading?: boolean;
}) {
  const fg = kind === 'primary' ? C.white : kind === 'danger' ? C.danger : C.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor:
            kind === 'primary'
              ? C.accent
              : kind === 'secondary'
                ? C.white
                : kind === 'danger'
                  ? C.soft
                  : 'transparent',
          borderColor: kind === 'secondary' ? C.line : 'transparent',
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
          paddingHorizontal: small ? 13 : 19,
          minHeight: small ? 38 : 48,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={small ? 15 : 18} color={fg} />
      ) : null}
      <Txt size={small ? 12 : 14} bold color={fg}>
        {label}
      </Txt>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label && (
        <Txt size={12} bold color={C.muted}>
          {label}
        </Txt>
      )}
      <TextInput
        {...props}
        placeholderTextColor="#A1A1AA"
        style={[
          s.input,
          props.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null,
          props.style,
        ]}
      />
    </View>
  );
}
export function Badge({
  label,
  color = C.muted,
  dot = false,
}: {
  label: string;
  color?: string;
  dot?: boolean;
}) {
  return (
    <View
      style={[
        s.row,
        {
          gap: 5,
          backgroundColor: C.soft,
          borderRadius: 20,
          paddingHorizontal: 10,
          paddingVertical: 5,
        },
      ]}
    >
      {dot && <View style={{ width: 5, height: 5, borderRadius: 5, backgroundColor: color }} />}
      <Txt size={10} color={color} bold>
        {label}
      </Txt>
    </View>
  );
}
export function Sheet({
  visible,
  title,
  children,
  onClose,
  wide = false,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { maxWidth: wide ? 800 : 480 }]}>
          <View style={[s.between, { padding: 24, borderBottomWidth: 1, borderColor: C.line }]}>
            <Txt size={20} bold>
              {title}
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              onPress={onClose}
              style={{ padding: 8 }}
            >
              <Icon name="x" />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 24, gap: 18 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function Empty({
  icon = 'layers',
  title,
  body,
  children,
}: {
  icon?: React.ComponentProps<typeof Feather>['name'];
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', padding: 30, gap: 14 }}>
      <View style={[s.iconBox, { width: 58, height: 58, backgroundColor: C.soft }]}>
        <Icon name={icon} size={25} />
      </View>
      <Txt size={18} bold style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt color={C.muted} style={{ textAlign: 'center', maxWidth: 360 }}>
        {body}
      </Txt>
      {children}
    </View>
  );
}
export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  card: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    padding: 22,
  },
  button: {
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: C.white,
    padding: 13,
    color: C.ink,
    fontSize: 14,
    minHeight: 48,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: C.bg,
    borderRadius: 20,
    overflow: 'hidden',
  },
  iconBox: {
    width: 40,
    height: 40,
    backgroundColor: C.highlight,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mono: { fontFamily: 'monospace', fontSize: 12, lineHeight: 21 },
  label: { letterSpacing: 2, fontSize: 10, fontWeight: '700', color: C.muted },
  divider: { height: 1, backgroundColor: C.line },
  panel: { flex: 1, gap: 18 },
});
