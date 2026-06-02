import type { PropsWithChildren } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'

type GlassCardProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>
  compact?: boolean
}>

export function GlassCard({ children, style, compact = false }: GlassCardProps) {
  return (
    <BlurView intensity={26} tint="light" style={[styles.card, compact && styles.compact, style]}>
      <View style={styles.highlight} />
      {children}
    </BlurView>
  )
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.34)',
    shadowColor: '#5b5078',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
  },
  compact: {
    borderRadius: 999,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '38%',
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
})
