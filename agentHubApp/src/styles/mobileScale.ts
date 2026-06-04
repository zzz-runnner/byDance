import { Platform } from 'react-native'

export type LayoutTier = 'compact' | 'standard' | 'wide'

const isAndroid = Platform.OS === 'android'
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function scaledSize(size: number, androidScale = 0.88) {
  return Math.round(size * (isAndroid ? androidScale : 1))
}

export function tieredSize(tier: LayoutTier, values: { compact: number; standard: number; wide: number }, androidScale = 0.88) {
  return scaledSize(values[tier], androidScale)
}

export function fluidFontSize(size: number, screenWidth: number, options?: { min?: number; max?: number; androidScale?: number }) {
  const baselineWidth = isAndroid ? 430 : 390
  const widthScale = clamp(screenWidth / baselineWidth, isAndroid ? 0.72 : 0.82, isAndroid ? 0.96 : 1.08)
  const platformScale = isAndroid ? options?.androidScale ?? 0.82 : 1
  const min = options?.min ?? size * 0.72
  const max = options?.max ?? size
  return Math.round(clamp(size * widthScale * platformScale, min, max))
}

export function createMobileScale(tier: LayoutTier, screenWidth: number) {
  return {
    headerAvatar: tieredSize(tier, { compact: 40, standard: 46, wide: 54 }, 0.86),
    headerButton: tieredSize(tier, { compact: 46, standard: 50, wide: 54 }, 0.9),
    headerIcon: tieredSize(tier, { compact: 23, standard: 25, wide: 28 }, 0.9),
    pageTitle: fluidFontSize(25, screenWidth, { min: 17, max: 25, androidScale: 0.78 }),
    chatTitle: fluidFontSize(20, screenWidth, { min: 16, max: 20, androidScale: 0.82 }),
    heroTitle: fluidFontSize(26, screenWidth, { min: 18, max: 26, androidScale: 0.72 }),
    registryTitle: fluidFontSize(26, screenWidth, { min: 18, max: 26, androidScale: 0.72 }),
    sectionTitle: fluidFontSize(19, screenWidth, { min: 15, max: 19, androidScale: 0.78 }),
    panelTitle: fluidFontSize(17, screenWidth, { min: 14, max: 17, androidScale: 0.82 }),
    workspaceCardTitle: fluidFontSize(21, screenWidth, { min: 16, max: 21, androidScale: 0.76 }),
    agentCardTitle: fluidFontSize(21, screenWidth, { min: 16, max: 21, androidScale: 0.76 }),
    cardTitle: fluidFontSize(14, screenWidth, { min: 12, max: 14, androidScale: 0.88 }),
    labelText: fluidFontSize(12, screenWidth, { min: 10, max: 12, androidScale: 0.88 }),
    metaText: fluidFontSize(13, screenWidth, { min: 11, max: 13, androidScale: 0.88 }),
    bodyText: fluidFontSize(15, screenWidth, { min: 12, max: 15, androidScale: 0.86 }),
    bodyLineHeight: fluidFontSize(22, screenWidth, { min: 18, max: 22, androidScale: 0.9 }),
    messageText: fluidFontSize(16, screenWidth, { min: 13, max: 16, androidScale: 0.82 }),
    messageLineHeight: fluidFontSize(25, screenWidth, { min: 20, max: 25, androidScale: 0.86 }),
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
