import { Image, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { agents } from '../data/mockData'

type AgentGlyphProps = {
  agentId: string
  size?: number
  showRing?: boolean
}

const brand = require('../../assets/brand/ai-core.png')

export function AgentGlyph({ agentId, size = 38, showRing = true }: AgentGlyphProps) {
  const agent = agents.find(item => item.id === agentId)

  if (agentId === 'orchestrator') {
    return (
      <View style={[styles.orbWrap, showRing && styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
        <Image source={brand} style={{ width: size, height: size }} resizeMode="contain" />
      </View>
    )
  }

  if (!agent) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
        <MaterialCommunityIcons name="account" size={size * 0.5} color="#fff" />
      </View>
    )
  }

  return (
    <LinearGradient
      colors={[agent.color, '#ffffff']}
      start={{ x: 0.15, y: 0.1 }}
      end={{ x: 1, y: 1 }}
      style={[styles.generated, showRing && styles.ring, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.initial, { fontSize: Math.max(12, size * 0.36) }]}>{agent.name.slice(0, 1)}</Text>
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
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
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
