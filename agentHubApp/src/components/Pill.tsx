import { StyleSheet, Text, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import type { IconName } from '../data/mockData'

type PillProps = {
  label: string
  icon?: IconName
  tone?: 'blue' | 'green' | 'pink' | 'amber' | 'muted' | 'danger'
}

const toneColors = {
  blue: '#2563eb',
  green: '#059669',
  pink: '#db2777',
  amber: '#d97706',
  muted: '#64748b',
  danger: '#dc2626',
}

export function Pill({ label, icon, tone = 'muted' }: PillProps) {
  return (
    <View style={styles.pill}>
      {icon ? <MaterialCommunityIcons name={icon} size={13} color={toneColors[tone]} /> : null}
      <Text style={[styles.text, { color: toneColors[tone] }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.36)',
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
  },
})
