import { Platform } from 'react-native'

export type LayoutTier = 'compact' | 'standard' | 'wide'

const isAndroid = Platform.OS === 'android'

export function scaledSize(size: number, androidScale = 0.88) {
  return Math.round(size * (isAndroid ? androidScale : 1))
}

export function tieredSize(tier: LayoutTier, values: { compact: number; standard: number; wide: number }, androidScale = 0.88) {
  return scaledSize(values[tier], androidScale)
}

export function createMobileScale(tier: LayoutTier) {
  return {
    headerAvatar: tieredSize(tier, { compact: 40, standard: 46, wide: 54 }, 0.86),
    headerButton: tieredSize(tier, { compact: 46, standard: 50, wide: 54 }, 0.9),
    headerIcon: tieredSize(tier, { compact: 23, standard: 25, wide: 28 }, 0.9),
    pageTitle: tieredSize(tier, { compact: 22, standard: 25, wide: 25 }, 0.9),
    chatTitle: tieredSize(tier, { compact: 18, standard: 20, wide: 20 }, 0.9),
    workspaceHeroIcon: tieredSize(tier, { compact: 58, standard: 68, wide: 68 }, 0.86),
    workspaceCardIcon: tieredSize(tier, { compact: 76, standard: 84, wide: 96 }, 0.84),
    workspaceCardIconGlyph: tieredSize(tier, { compact: 38, standard: 42, wide: 48 }, 0.84),
    workspaceAgentAvatar: tieredSize(tier, { compact: 32, standard: 34, wide: 36 }, 0.88),
    chatMiniAvatar: tieredSize(tier, { compact: 30, standard: 32, wide: 34 }, 0.88),
    chatUserAvatar: tieredSize(tier, { compact: 38, standard: 40, wide: 44 }, 0.88),
    chatAgentAvatar: tieredSize(tier, { compact: 44, standard: 48, wide: 56 }, 0.88),
    chatReviewerAvatar: tieredSize(tier, { compact: 42, standard: 46, wide: 50 }, 0.88),
    agentCardAvatar: tieredSize(tier, { compact: 52, standard: 58, wide: 72 }, 0.86),
    agentDetailAvatar: tieredSize(tier, { compact: 50, standard: 54, wide: 58 }, 0.88),
    navFab: tieredSize(tier, { compact: 60, standard: 66, wide: 70 }, 0.84),
    sideRailWidth: tieredSize(tier, { compact: 70, standard: 74, wide: 78 }, 0.86),
    sideRailButton: tieredSize(tier, { compact: 48, standard: 52, wide: 56 }, 0.86),
    artifactCardMinHeight: tieredSize(tier, { compact: 104, standard: 112, wide: 118 }, 0.92),
    cardPadding: scaledSize(16, 0.9),
  }
}
