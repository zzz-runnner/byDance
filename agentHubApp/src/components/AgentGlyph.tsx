import { Image, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { agents } from '../data/mockData'

type AgentGlyphProps = {
  agentId: string
  size?: number
  showRing?: boolean
  label?: string
  color?: string
  provider?: string
}

const brand = require('../../assets/brand/ai-core.png')

function colorForAgent(agentId: string, provider?: string): string {
  if (provider === 'codex') return '#10b981'
  if (provider === 'claude') return '#7c3aed'

  const palette = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2']
  const index = [...agentId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length
  return palette[index]
}

export function AgentGlyph({ agentId, size = 38, showRing = true, label, color, provider }: AgentGlyphProps) {
  const agent = agents.find(item => item.id === agentId)
  const displayName = label ?? agent?.name
  const displayColor = color ?? agent?.color ?? colorForAgent(agentId, provider)

  if (agentId === 'orchestrator' && !label) {
    return (
      <View style={[styles.orbWrap, showRing && styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
        <Image source={brand} style={{ width: size, height: size }} resizeMode="contain" />
      </View>
    )
  }

  return (
    <LinearGradient
      colors={[displayColor, '#ffffff']}
      start={{ x: 0.15, y: 0.1 }}
      end={{ x: 1, y: 1 }}
      style={[styles.generated, showRing && styles.ring, { width: size, height: size, borderRadius: size / 2 }]}
    >
      {displayName ? (
        <Text style={[styles.initial, { fontSize: Math.max(12, size * 0.36) }]}>{displayName.slice(0, 1)}</Text>
      ) : (
        <MaterialCommunityIcons name="account" size={size * 0.5} color="#fff" />
      )}
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  orbWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  generated: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.76)',
  },
  initial: {
    color: '#172033',
    fontWeight: '900',
  },
})
