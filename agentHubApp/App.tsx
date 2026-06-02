import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { LinearGradient } from 'expo-linear-gradient'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { AgentGlyph } from './src/components/AgentGlyph'
import { GlassCard } from './src/components/GlassCard'
import { Pill } from './src/components/Pill'
import {
  agents,
  artifacts,
  codeFiles,
  messages,
  workspaces,
  type Agent,
  type Artifact,
  type ChatMessage,
  type IconName,
  type Workspace,
} from './src/data/mockData'

const background = require('./assets/background/mainBackground.png')
const homeIcon = require('./assets/home/icon.png')

type TabKey = 'home' | 'workspaces' | 'ai' | 'code' | 'agents'
type LayoutTier = 'compact' | 'standard' | 'wide'

const tabs: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'home', label: '首页', icon: 'home-variant-outline' },
  { key: 'workspaces', label: '工作区', icon: 'view-dashboard-outline' },
  { key: 'ai', label: 'AI', icon: 'creation-outline' },
  { key: 'code', label: '代码', icon: 'code-braces' },
  { key: 'agents', label: '我的/Agent', icon: 'account' },
]

function AnimatedHomeIcon({ size }: { size: number }) {
  const floatValue = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatValue, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(floatValue, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    )

    loop.start()
    return () => loop.stop()
  }, [floatValue])

  const translateY = floatValue.interpolate({
    inputRange: [0, 1],
    outputRange: [3, -5],
  })
  const scale = floatValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.04],
  })

  return (
    <Animated.View
      style={[
        styles.animatedHomeIcon,
        {
          width: size,
          height: size * 0.98,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      <Image source={homeIcon} resizeMode="contain" style={styles.animatedHomeIconImage} />
    </Animated.View>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home')
  const [navExpanded, setNavExpanded] = useState(false)
  const { width } = useWindowDimensions()
  const layoutTier: LayoutTier = width < 380 ? 'compact' : width < 430 ? 'standard' : 'wide'
  const tightChatHeader = activeTab === 'ai' && layoutTier !== 'wide'
  const activeWorkspace = workspaces[0]
  const runningAgents = agents.filter(agent => agent.status !== 'idle').length
  const title = useMemo(() => {
    if (activeTab === 'home') return '多 Agent 协作工作台'
    if (activeTab === 'workspaces') return '多工作区'
    if (activeTab === 'ai') return 'AI 协作'
    if (activeTab === 'code') return '代码与交付'
    return '我的 Agent'
  }, [activeTab])

  return (
    <SafeAreaProvider>
      <ImageBackground source={background} style={styles.shell} resizeMode="cover">
        <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.08)', 'rgba(241,245,249,0.26)']} style={styles.overlay} />
        <SafeAreaView style={styles.safe}>
          <StatusBar style="dark" />
          <View style={[styles.header, activeTab === 'agents' && styles.agentHeader, (activeTab === 'code' || activeTab === 'ai') && styles.codeHeader]}>
            {activeTab === 'code' || activeTab === 'ai' ? (
              <GlassCard compact style={styles.codeHeaderButton}>
                <MaterialCommunityIcons name="chevron-left" size={28} color="#0f172a" />
              </GlassCard>
            ) : null}
            <View style={[styles.headerLeft, (activeTab === 'code' || activeTab === 'ai') && styles.codeHeaderLeft, tightChatHeader && styles.chatHeaderLeftTight]}>
              {tightChatHeader ? null : <AgentGlyph agentId="orchestrator" size={activeTab === 'agents' || activeTab === 'code' || activeTab === 'ai' ? 46 : 54} />}
              <View style={styles.headerCopy}>
                {activeTab === 'ai' ? null : <Text style={styles.eyebrow}>AGENTHUB</Text>}
                <Text style={[styles.headerTitle, activeTab === 'ai' && styles.chatHeaderTitle]} numberOfLines={1}>
                  {activeTab === 'ai' ? activeWorkspace.name : title}
                </Text>
                {activeTab === 'code' ? <Text style={styles.codeSubtitle}>校园 AI 助手 App / repo</Text> : null}
                {activeTab === 'ai' ? (
                  <View style={styles.chatSubtitleRow}>
                    <View style={styles.chatLiveDot} />
                    <Text style={styles.codeSubtitle} numberOfLines={1}>群聊 · 3 个 Agent 协作中</Text>
                  </View>
                ) : null}
                {activeTab === 'ai' && tightChatHeader ? (
                  <View style={styles.chatStreamingRow}>
                    <GlassCard compact style={styles.streamingPill}>
                      <MaterialCommunityIcons name="chart-timeline-variant-shimmer" size={17} color="#10b981" />
                      <Text style={styles.streamingText}>streaming</Text>
                    </GlassCard>
                  </View>
                ) : null}
              </View>
            </View>
            {activeTab === 'ai' ? (
              <View style={styles.chatHeaderActions}>
                <GlassCard compact style={styles.codeHeaderButton}>
                  <MaterialCommunityIcons name="refresh" size={25} color="#0f172a" />
                </GlassCard>
              </View>
            ) : activeTab === 'workspaces' ? (
              <View style={styles.workspaceHeaderActions}>
                <GlassCard compact style={styles.headerIconButton}>
                  <MaterialCommunityIcons name="plus" size={28} color="#0f172a" />
                </GlassCard>
                <GlassCard compact style={styles.headerIconButton}>
                  <View style={styles.bellWrap}>
                    <MaterialCommunityIcons name="bell-outline" size={24} color="#0f172a" />
                    <View style={styles.bellDot} />
                  </View>
                </GlassCard>
              </View>
            ) : activeTab === 'code' ? (
              <GlassCard compact style={styles.codeHeaderButton}>
                <MaterialCommunityIcons name="refresh" size={25} color="#0f172a" />
              </GlassCard>
            ) : activeTab === 'agents' ? (
              <View style={styles.headerActions}>
                <GlassCard compact style={[styles.agentCreateButton, layoutTier === 'compact' && styles.agentCreateButtonCompact]}>
                  <MaterialCommunityIcons name="plus" size={23} color="#0f172a" />
                  <Text style={styles.agentCreateText}>新建</Text>
                </GlassCard>
                <GlassCard compact style={styles.headerAction}>
                  <MaterialCommunityIcons name="cog-outline" size={24} color="#0f172a" />
                </GlassCard>
              </View>
            ) : (
              <GlassCard compact style={styles.headerAction}>
                <View style={styles.bellWrap}>
                  <MaterialCommunityIcons name="bell-outline" size={20} color="#1f2937" />
                  <View style={styles.bellDot} />
                </View>
              </GlassCard>
            )}
          </View>

          {activeTab === 'ai' ? (
            <View style={styles.contentFill}>
              <ChatScreen workspace={activeWorkspace} layoutTier={layoutTier} />
            </View>
          ) : (
            <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
              {activeTab === 'home' ? <HomeScreen runningAgents={runningAgents} workspace={activeWorkspace} layoutTier={layoutTier} /> : null}
              {activeTab === 'workspaces' ? <WorkspaceScreen layoutTier={layoutTier} /> : null}
              {activeTab === 'code' ? <CodeScreen layoutTier={layoutTier} /> : null}
              {activeTab === 'agents' ? <AgentScreen layoutTier={layoutTier} /> : null}
            </ScrollView>
          )}

          <SideTabs activeTab={activeTab} onChange={setActiveTab} expanded={navExpanded} onToggle={() => setNavExpanded(value => !value)} />
        </SafeAreaView>
      </ImageBackground>
    </SafeAreaProvider>
  )
}

function HomeScreen({ runningAgents, workspace, layoutTier }: { runningAgents: number; workspace: Workspace; layoutTier: LayoutTier }) {
  const isCompact = layoutTier === 'compact'

  return (
    <View style={[styles.homeScreen, isCompact && styles.homeScreenCompact]}>
      <View style={styles.homeGreetingRow}>
        <View style={styles.homeGreetingText}>
          <Text style={styles.homeGreeting}>Hi, Susanna</Text>
          <Text style={styles.homeGreetingSub}>很高兴为您服务</Text>
        </View>
        <View style={styles.homeHeroOrb}>
          <AnimatedHomeIcon size={isCompact ? 112 : layoutTier === 'standard' ? 132 : 146} />
        </View>
      </View>

      <View style={styles.homeStatGrid}>
        <StatCard label="工作区" value={String(workspaces.length)} icon="view-grid-outline" tone="#2563eb" />
        <StatCard label="运行中" value={String(runningAgents)} icon="lightning-bolt-outline" tone="#db2777" />
        <StatCard label="产物" value={String(artifacts.length)} icon="package-variant-closed" tone="#059669" />
      </View>

      <Text style={styles.homeSectionTitle}>全部功能</Text>
      <View style={styles.homeFeatureGrid}>
        <Feature icon="message-processing-outline" label="群聊协作" />
        <Feature icon="robot-outline" label="Agent 管理" />
        <Feature icon="code-braces" label="代码文件" />
        <Feature icon="cellphone-screenshot" label="预览产物" />
        <Feature icon="source-branch" label="Diff 摘要" />
        <Feature icon="shield-check-outline" label="审查结论" />
      </View>

      <GlassCard style={styles.homeWorkspaceCard}>
        <View style={styles.homeWorkspaceHead}>
          <View>
            <Text style={styles.homeWorkspaceEyebrow}>ACTIVE WORKSPACE</Text>
            <Text style={styles.homeWorkspaceTitle}>{workspace.name}</Text>
          </View>
          <View style={styles.homeStatusPill}>
            <MaterialCommunityIcons name="waveform" size={16} color="#2563eb" />
            <Text style={styles.homeStatusText}>running</Text>
          </View>
        </View>
        <Text style={styles.homeWorkspaceDesc} numberOfLines={2}>{workspace.goal}</Text>
        <View style={styles.homeWorkspaceMetaRow}>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextBlue}>{workspace.type}</Text>
          </View>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextGreen}>{workspace.artifactCount} 产物</Text>
          </View>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextGray}>{workspace.messageCount} 消息</Text>
          </View>
        </View>
        <View style={styles.homeAvatarRow}>
          {workspace.agents.slice(0, 4).map((agentId, index) => (
            <View key={agentId} style={{ marginLeft: index === 0 ? 0 : -10 }}>
              <AgentGlyph agentId={agentId} size={36} />
            </View>
          ))}
          <Text style={styles.homeAvatarText}>{workspace.latestEventLabel}</Text>
        </View>
      </GlassCard>
    </View>
  )
}

function WorkspaceScreen({ layoutTier }: { layoutTier: LayoutTier }) {
  const isCompact = layoutTier === 'compact'
  return (
    <View style={[styles.workspaceScreen, isCompact && styles.workspaceScreenCompact]}>
      <GlassCard style={styles.searchCard}>
        <MaterialCommunityIcons name="magnify" size={24} color="#64748b" />
        <TextInput placeholder="搜索工作区" placeholderTextColor="#94a3b8" style={styles.searchInput} />
      </GlassCard>
      <View style={styles.workspaceFilterLine}>
        <Pill label="Active" tone="blue" icon="check-circle-outline" />
        <Pill label="Updated" tone="muted" icon="sort-clock-descending-outline" />
        <Pill label="Pinned first" tone="amber" icon="pin-outline" />
        <Pill label="归档" tone="muted" icon="archive-outline" />
      </View>
      {workspaces.slice(0, 3).map(workspace => (
        <WorkspaceCard key={workspace.id} workspace={workspace} layoutTier={layoutTier} />
      ))}
      <Pressable style={styles.loadMoreButton}>
        <Text style={styles.loadMoreText}>加载更多工作区</Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
      </Pressable>
    </View>
  )
}

function ChatScreen({ workspace, layoutTier }: { workspace: Workspace; layoutTier: LayoutTier }) {
  const isCompact = layoutTier === 'compact'
  const insets = useSafeAreaInsets()
  const keyboardOffset = Platform.OS === 'ios' ? 8 : 0

  return (
    <KeyboardAvoidingView
      style={styles.chatScreen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardOffset + insets.top}
    >
      <ScrollView
        style={styles.chatScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.chatScrollInner, { paddingBottom: 18 + insets.bottom }]}
      >
        <View style={styles.userMessageRow}>
          <GlassCard style={styles.userPromptBubble}>
            <Text style={styles.userPromptText}>
              <Text style={styles.mentionText}>@engineer</Text>
              {'  '}先把移动端 app 的主 UI 做出来，按 web 端功能做 mock。
            </Text>
          </GlassCard>
          <AgentGlyph agentId="product-manager" size={44} />
        </View>

        <View style={styles.agentMessageBlock}>
          <View style={styles.agentMessageMetaRow}>
            <AgentGlyph agentId="orchestrator" size={56} />
            <Text style={styles.agentMessageName}>协调 Agent</Text>
            <View style={styles.agentSmallBadge}>
              <Text style={styles.agentSmallBadgeText}>协调中</Text>
            </View>
          </View>
          <GlassCard style={styles.chatBubbleLarge}>
            <Text style={styles.chatBubbleText}>我先快速梳理目标：移动端保留工作区、群聊、Agent 管理、代码/产物查看和交付状态。</Text>
          </GlassCard>
        </View>

        <GlassCard style={styles.chatProcessCard}>
          <View style={styles.chatProcessHead}>
            <View style={styles.chatProcessTitleLine}>
              <MaterialCommunityIcons name="robot-outline" size={22} color="#2563eb" />
              <Text style={styles.chatProcessTitle}>本轮过程</Text>
            </View>
            <View style={styles.processStatePill}>
              <Text style={styles.processStateText}>进行中</Text>
            </View>
          </View>
          {[
            { icon: 'check-circle-outline' as IconName, title: '路由完成', summary: '已识别任务并分配给工程师 Agent', time: '21:12', tone: 'done' },
            { icon: 'code-tags' as IconName, title: '工程执行中', summary: '正在生成移动端主 UI mock', time: '21:13', tone: 'running' },
            { icon: 'clock-outline' as IconName, title: '等待审查', summary: '工程师完成后将提交给审查 Agent', time: '-', tone: 'waiting' },
          ].map(step => (
            <View key={step.title} style={styles.chatProcessRow}>
              <View style={[styles.chatProcessIcon, step.tone === 'done' && styles.chatProcessIconDone, step.tone === 'running' && styles.chatProcessIconRunning]}>
                <MaterialCommunityIcons name={step.icon} size={19} color={step.tone === 'waiting' ? '#fff' : step.tone === 'done' ? '#10b981' : '#fff'} />
              </View>
              <Text style={styles.chatProcessStepTitle}>{step.title}</Text>
              <Text style={styles.chatProcessSummary} numberOfLines={1}>{step.summary}</Text>
              <Text style={styles.chatProcessTime}>{step.time}</Text>
            </View>
          ))}
        </GlassCard>

        <View style={styles.agentMessageBlock}>
          <View style={styles.agentMessageMetaRow}>
            <AgentGlyph agentId="reviewer" size={50} />
            <Text style={styles.agentMessageName}>工程师</Text>
            <View style={styles.engineerBadge}>
              <Text style={styles.engineerBadgeText}>执行中</Text>
            </View>
          </View>
          <GlassCard style={styles.engineerBubble}>
            <Text style={styles.chatBubbleText}>我会把 Monaco 和 iframe 能力先转成移动端摘要卡，后续再接真实接口。</Text>
            <Text style={styles.chatBubbleTime}>21:14</Text>
          </GlassCard>
        </View>

        <GlassCard style={styles.currentArtifactsPanel}>
          <Text style={styles.currentArtifactsTitle}>当前产出（工程师）</Text>
          <View style={[styles.currentArtifactGrid, isCompact && styles.currentArtifactGridCompact]}>
            <CurrentArtifactCard icon="cellphone-screenshot" title="移动首页预览" meta="1 张" />
            <CurrentArtifactCard icon="code-tags" title="代码变更" meta="+428 / -0" tone="blue" />
            <CurrentArtifactCard icon="shield-check-outline" title="审查结论" meta="pass" tone="green" />
            <CurrentArtifactCard icon="cube-outline" title="源码快照" meta="v0.1.0" tone="muted" />
          </View>
        </GlassCard>
      </ScrollView>

      <GlassCard style={styles.chatComposer}>
        <TextInput placeholder="给工作区发送任务，支持 @Agent 和代码引用" placeholderTextColor="#94a3b8" style={styles.chatComposerInput} />
        <Pressable style={styles.composerToolButton}>
          <Text style={styles.composerToolText}>@</Text>
        </Pressable>
        <Pressable style={styles.composerToolButton}>
          <MaterialCommunityIcons name="code-tags" size={20} color="#0f172a" />
        </Pressable>
        <Pressable style={styles.chatSendButton}>
          <MaterialCommunityIcons name="arrow-up" size={25} color="#fff" />
        </Pressable>
      </GlassCard>
    </KeyboardAvoidingView>
  )
}

function CurrentArtifactCard({ icon, title, meta, tone = 'blue' }: { icon: IconName; title: string; meta: string; tone?: 'blue' | 'green' | 'muted' }) {
  return (
    <View style={styles.currentArtifactCard}>
      <MaterialCommunityIcons name={icon} size={30} color={tone === 'green' ? '#10b981' : tone === 'muted' ? '#334155' : '#5572ff'} />
      <Text style={styles.currentArtifactTitle}>{title}</Text>
      <Text style={[styles.currentArtifactMeta, tone === 'green' && styles.currentArtifactMetaGreen, tone === 'muted' && styles.currentArtifactMetaMuted]}>{meta}</Text>
    </View>
  )
}

function CodeScreen({ layoutTier }: { layoutTier: LayoutTier }) {
  const isCompact = layoutTier === 'compact'

  return (
    <View style={styles.codeScreen}>
      <GlassCard compact style={styles.codeSegment}>
        <View style={styles.codeSegmentItemActive}>
          <MaterialCommunityIcons name="code-tags" size={20} color="#2563eb" />
          <Text style={styles.codeSegmentTextActive}>文件</Text>
        </View>
        <View style={styles.codeSegmentDivider} />
        <View style={styles.codeSegmentItem}>
          <MaterialCommunityIcons name="source-branch" size={20} color="#64748b" />
          <Text style={styles.codeSegmentText}>Diff</Text>
        </View>
        <View style={styles.codeSegmentDivider} />
        <View style={styles.codeSegmentItem}>
          <MaterialCommunityIcons name="eye-outline" size={21} color="#64748b" />
          <Text style={styles.codeSegmentText}>预览</Text>
        </View>
      </GlassCard>

      <GlassCard style={styles.codePanel}>
        <View style={styles.codePanelHead}>
          <View style={styles.codePanelTitleRow}>
            <Text style={styles.codePanelTitle}>文件树</Text>
            <View style={styles.diffBadge}>
              <Text style={styles.diffAdd}>+428</Text>
              <Text style={styles.diffSlash}> / </Text>
              <Text style={styles.diffRemove}>-0</Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-up" size={25} color="#475569" />
        </View>
        {codeFiles.map(file => (
          <View key={file.path} style={styles.codeFileRow}>
            <View style={[styles.fileTypeIcon, file.language === 'png' && styles.fileImageIcon]}>
              <Text style={styles.fileTypeText}>{file.language === 'png' ? '' : file.language.toUpperCase()}</Text>
              {file.language === 'png' ? <MaterialCommunityIcons name="image-outline" size={22} color="#42cfa6" /> : null}
            </View>
            <View style={styles.fileCopy}>
              <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
              <Text style={styles.fileMeta}>{file.language}{file.lines ? ` · ${file.lines} lines` : ''}</Text>
            </View>
            <View style={styles.fileStatusWrap}>
              <View style={[styles.fileStatusDot, file.changed === 'added' && styles.fileStatusAdded, file.changed === 'modified' && styles.fileStatusModified]} />
              <Text style={[styles.fileStatusText, file.changed === 'added' && styles.changeAdded, file.changed === 'modified' && styles.changeModified]}>
                {file.changed}
              </Text>
            </View>
            <MaterialCommunityIcons name="dots-horizontal" size={21} color="#64748b" />
          </View>
        ))}
      </GlassCard>

      <GlassCard style={[styles.previewShowcase, isCompact && styles.previewShowcaseCompact]}>
        <View style={styles.codePanelTitleRow}>
          <Text style={styles.codePanelTitle}>移动首页预览</Text>
        </View>
        <View style={styles.previewStage}>
          <Pressable style={styles.previewArrow}>
            <MaterialCommunityIcons name="chevron-left" size={25} color="#64748b" />
          </Pressable>
          <View style={styles.previewPhoneMini}>
            <View style={styles.miniStatusBar} />
            <View style={styles.miniHeaderLine}>
              <AgentGlyph agentId="orchestrator" size={18} />
              <Text style={styles.miniTinyText}>多 Agent 协作工作台</Text>
            </View>
            <Text style={styles.miniGreeting}>Hi, Susanna</Text>
            <Text style={styles.miniTitle}>很高兴为您服务</Text>
            <View style={styles.miniStatsRow}>
              <View style={styles.miniStat} />
              <View style={styles.miniStat} />
              <View style={styles.miniStat} />
            </View>
            <View style={styles.miniListBlock} />
            <View style={styles.miniNav}>
              <MaterialCommunityIcons name="home-variant" size={10} color="#fff" />
              <MaterialCommunityIcons name="layers-outline" size={10} color="#fff" />
              <Text style={styles.miniAi}>AI</Text>
              <MaterialCommunityIcons name="message-text-outline" size={10} color="#fff" />
              <MaterialCommunityIcons name="account-outline" size={10} color="#fff" />
            </View>
          </View>
          <Pressable style={styles.previewArrow}>
            <MaterialCommunityIcons name="chevron-right" size={25} color="#334155" />
          </Pressable>
        </View>
        <View style={styles.previewDots}>
          <View style={styles.previewDotActive} />
          <View style={styles.previewDot} />
          <View style={styles.previewDot} />
          <View style={styles.previewDot} />
        </View>
      </GlassCard>

      <GlassCard style={styles.deliveryStatusPanel}>
        <Text style={styles.codePanelTitle}>交付状态</Text>
        <View style={[styles.deliveryStatusGrid, isCompact && styles.deliveryStatusGridCompact]}>
          <DeliveryStatusCard icon="layers-triple" title="源码快照" status="ready" body="v0.1.0 已保存" time="今天 09:36" tone="blue" />
          <DeliveryStatusCard icon="cube-outline" title="构建产物" status="running" body="等待 RN 依赖安装后检查" time="今天 09:41" tone="purple" />
          <DeliveryStatusCard icon="cloud-upload-outline" title="部署入口" status="idle" body="移动端 mock 阶段暂不部署" time="-" tone="green" />
        </View>
        <View style={[styles.deliveryActionRow, isCompact && styles.deliveryActionRowCompact]}>
          <Pressable style={styles.deliveryOutlineButton}>
            <Text style={styles.deliveryOutlineText}>保存版本</Text>
          </Pressable>
          <Pressable style={styles.deliveryPrimaryButton}>
            <Text style={styles.deliveryPrimaryText}>开始构建</Text>
          </Pressable>
          <Pressable style={styles.deliveryGreenButton}>
            <Text style={styles.deliveryGreenText}>打开预览</Text>
            <MaterialCommunityIcons name="open-in-new" size={15} color="#22c59e" />
          </Pressable>
        </View>
      </GlassCard>
    </View>
  )
}

function DeliveryStatusCard({ icon, title, status, body, time, tone }: { icon: IconName; title: string; status: string; body: string; time: string; tone: 'blue' | 'purple' | 'green' }) {
  return (
    <View style={styles.deliveryStatusCard}>
      <View style={[styles.deliveryStatusIcon, tone === 'purple' && styles.deliveryStatusIconPurple, tone === 'green' && styles.deliveryStatusIconGreen]}>
        <MaterialCommunityIcons name={icon} size={28} color={tone === 'purple' ? '#9b6cf0' : tone === 'green' ? '#22c59e' : '#3d74ff'} />
      </View>
      <Text style={styles.deliveryStatusTitle}>{title}</Text>
      <View style={styles.deliveryStatusPill}>
        <Text style={[styles.deliveryStatusPillText, status === 'running' && styles.deliveryStatusRunning, status === 'idle' && styles.deliveryStatusIdle]}>{status}</Text>
      </View>
      <Text style={styles.deliveryStatusBody}>{body}</Text>
      <Text style={styles.deliveryStatusTime}>{time}</Text>
    </View>
  )
}

function AgentScreen({ layoutTier }: { layoutTier: LayoutTier }) {
  const runningCount = agents.filter(agent => agent.status !== 'idle').length
  const builtinCount = agents.filter(agent => agent.id === 'orchestrator' || agent.id === 'engineer').length
  const showFullRegistry = layoutTier === 'wide'

  return (
    <View style={styles.agentScreen}>
      <GlassCard style={[styles.agentSummary, !showFullRegistry && styles.agentSummaryCompact]}>
        <View style={[styles.agentSummaryHero, !showFullRegistry && styles.agentSummaryHeroCompact]}>
          <View style={styles.registryIcon}>
            <MaterialCommunityIcons name="layers-triple" size={35} color="#5572ff" />
          </View>
          <View style={styles.registryCopy}>
            <Text style={styles.registryTitle}>Agent Registry</Text>
            <Text style={styles.agentSummaryText}>管理模型、提示词、工具权限和上下文策略</Text>
          </View>
        </View>
        {showFullRegistry ? (
          <View style={styles.agentMetricRow}>
            <View style={styles.agentMetricBox}>
              <Text style={styles.agentMetricValue}>{agents.length}</Text>
              <Text style={styles.agentMetricLabel}>Agents</Text>
            </View>
            <View style={styles.agentMetricBox}>
              <View style={styles.metricValueLine}>
                <View style={styles.metricDot} />
                <Text style={styles.agentMetricValue}>{runningCount}</Text>
              </View>
              <Text style={styles.agentMetricLabel}>运行中</Text>
            </View>
            <View style={styles.agentMetricBox}>
              <View style={styles.metricValueLine}>
                <MaterialCommunityIcons name="cube-outline" size={26} color="#7658d8" />
                <Text style={styles.agentMetricValue}>{builtinCount}</Text>
              </View>
              <Text style={styles.agentMetricLabel}>内置</Text>
            </View>
          </View>
        ) : null}
      </GlassCard>

      <View style={[styles.agentSearchRow, layoutTier === 'compact' && styles.agentSearchRowCompact]}>
        <GlassCard compact style={styles.agentSearchBox}>
          <MaterialCommunityIcons name="magnify" size={22} color="#64748b" />
          <Text style={styles.agentSearchPlaceholder}>搜索 Agent</Text>
        </GlassCard>
        <GlassCard compact style={styles.agentFilterButton}>
          <MaterialCommunityIcons name="filter-outline" size={21} color="#475569" />
          <Text style={styles.agentFilterText}>全部状态</Text>
          <MaterialCommunityIcons name="menu-down" size={19} color="#64748b" />
        </GlassCard>
      </View>

      {agents.slice(0, 4).map(agent => (
        <AgentCard key={agent.id} agent={agent} layoutTier={layoutTier} />
      ))}
      <Text style={styles.agentLoadedText}>已加载全部 {agents.length} 个 Agent</Text>
    </View>
  )
}

function SideTabs({ activeTab, onChange, expanded, onToggle }: { activeTab: TabKey; onChange: (tab: TabKey) => void; expanded: boolean; onToggle: () => void }) {
  const insets = useSafeAreaInsets()
  const active = tabs.find(tab => tab.key === activeTab) ?? tabs[0]

  if (!expanded) {
    return (
      <GlassCard style={[styles.navFab, { bottom: Platform.select({ android: 18, default: 24 }) + insets.bottom }]}>
        <Pressable style={styles.navFabButton} onPress={onToggle}>
          <MaterialCommunityIcons name={active.icon} size={24} color="#fff" />
        </Pressable>
      </GlassCard>
    )
  }

  return (
    <GlassCard style={[styles.sideRail, { bottom: Platform.select({ android: 14, default: 22 }) + insets.bottom }]}>
      <Pressable style={styles.sideRailToggle} onPress={onToggle}>
        <MaterialCommunityIcons name="chevron-left" size={22} color="#e5edf7" />
      </Pressable>
      <View style={styles.sideRailStack}>
        {tabs.map(tab => {
          const active = tab.key === activeTab
          const isAi = tab.key === 'ai'
          return (
            <Pressable
              key={tab.key}
              style={[
                styles.sideRailItem,
                styles.sideRailItemExpanded,
                active && styles.sideRailItemActive,
                isAi && styles.sideRailAi,
                isAi && active && styles.sideRailAiActive,
              ]}
              onPress={() => onChange(tab.key)}
            >
              <View style={[styles.sideRailIconWrap, active && !isAi && styles.sideRailIconWrapActive, isAi && styles.sideRailAiIconWrap]}>
                <MaterialCommunityIcons name={tab.icon} size={isAi ? 28 : 22} color={active || isAi ? '#fff' : '#dbe4ee'} />
              </View>
              {expanded ? <Text style={[styles.sideRailLabel, active && styles.sideRailLabelActive, isAi && styles.sideRailAiLabel]}>{tab.label}</Text> : null}
            </Pressable>
          )
        })}
      </View>
    </GlassCard>
  )
}

function StatCard({ label, value, icon, tone }: { label: string; value: string; icon: IconName; tone: string }) {
  return (
    <GlassCard style={styles.statCard}>
      <View style={styles.statIcon}>
        <MaterialCommunityIcons name={icon} size={24} color={tone} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </GlassCard>
  )
}

function Feature({ icon, label }: { icon: IconName; label: string }) {
  return (
    <GlassCard style={styles.featureCard}>
      <View style={styles.featureIcon}>
        <MaterialCommunityIcons name={icon} size={24} color="#0f172a" />
      </View>
      <Text style={styles.featureLabel}>{label}</Text>
    </GlassCard>
  )
}

function WorkspaceCard({ workspace, layoutTier }: { workspace: Workspace; layoutTier: LayoutTier }) {
  const isCompact = layoutTier === 'compact'
  const iconName = workspace.kind === 'group' ? 'school-outline' : 'account-group-outline'
  const typeLabel = workspace.type === 'dev' ? 'dev' : workspace.type === 'chat' ? 'chat' : workspace.type === 'research' ? 'research' : 'writing'
  const statusLabel = workspace.status === 'running' ? '运行中' : workspace.status === 'ready' ? 'ready' : 'failed'
  const primaryLabel = workspace.id === 'ws-campus' ? '主工作区' : workspace.type
  const extraAgents = Math.max(0, workspace.agents.length - 4)

  return (
    <GlassCard style={[styles.workspaceCard, isCompact && styles.workspaceCardCompact]}>
      <View style={styles.workspaceTopRow}>
        <LinearGradient colors={workspace.kind === 'group' ? ['#4f8dfc', '#6ea5ff'] : ['#8f71f6', '#a98df8']} start={{ x: 0.08, y: 0.1 }} end={{ x: 1, y: 1 }} style={styles.workspaceIconTile}>
          <MaterialCommunityIcons name={iconName} size={48} color="#fff" />
        </LinearGradient>
        <View style={styles.workspaceTitleWrap}>
          <View style={styles.workspaceTitleRow}>
            <Text style={styles.workspaceTitle} numberOfLines={1}>{workspace.name}</Text>
            <View style={styles.workspacePrimaryBadge}>
              <Text style={styles.workspacePrimaryText}>{primaryLabel}</Text>
            </View>
          </View>
          <Text style={styles.workspaceGoal} numberOfLines={2}>{workspace.goal}</Text>
          <View style={styles.workspaceStatRow}>
            <View style={styles.workspaceStatChip}>
              <View style={styles.workspaceRunningDot} />
              <Text style={styles.workspaceStatText}>{statusLabel}</Text>
            </View>
            <View style={styles.workspaceStatChip}>
              <MaterialCommunityIcons name="cube-outline" size={15} color="#2563eb" />
              <Text style={styles.workspaceStatTextBlue}>{workspace.artifactCount} 产物</Text>
            </View>
            <View style={styles.workspaceStatChip}>
              <MaterialCommunityIcons name="message-text-outline" size={15} color="#7c3aed" />
              <Text style={styles.workspaceStatTextPurple}>{workspace.messageCount} 消息</Text>
            </View>
          </View>
        </View>
        <View style={styles.workspaceActionColumn}>
          <MaterialCommunityIcons name="pin" size={22} color={workspace.pinned ? '#d97706' : '#c4c9d4'} />
          <MaterialCommunityIcons name="chevron-right" size={26} color="#64748b" />
        </View>
      </View>
      <View style={styles.workspaceAvatarRow}>
        {workspace.agents.slice(0, 4).map((agentId, index) => (
          <View key={agentId} style={{ marginLeft: index === 0 ? 0 : -10 }}>
            <AgentGlyph agentId={agentId} size={isCompact ? 36 : 38} />
          </View>
        ))}
        {extraAgents > 0 ? (
          <View style={styles.workspaceMoreAvatar}>
            <Text style={styles.workspaceMoreAvatarText}>+{extraAgents}</Text>
          </View>
        ) : null}
        <Text style={styles.workspaceAvatarText}>{workspace.updatedAt} · {workspace.latestEventLabel}</Text>
      </View>
      <View style={styles.workspaceEventRow}>
        <View style={styles.workspaceEventLeft}>
          <MaterialCommunityIcons name="clock-outline" size={18} color="#64748b" />
          <Text style={styles.workspaceEventLabel}>最新事件</Text>
          <Text style={styles.workspaceEventTime}>{workspace.updatedAt}</Text>
          <Text style={styles.workspaceEventText} numberOfLines={1}>{workspace.latestEventLabel}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color="#64748b" />
      </View>
    </GlassCard>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.sender === 'user'
  const agent = message.agentId ? agents.find(item => item.id === message.agentId) : undefined
  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      {!isUser ? <AgentGlyph agentId={message.agentId ?? 'orchestrator'} size={34} /> : null}
      <View style={[styles.messageStack, isUser && styles.messageStackUser]}>
        {!isUser ? <Text style={styles.messageMeta}>{agent?.name ?? 'Agent'} · {message.time}</Text> : null}
        <GlassCard style={[styles.bubble, isUser ? styles.userBubble : undefined]}>
          {message.quote ? <Text style={styles.quoteText}>{message.quote}</Text> : null}
          <Text style={styles.messageText}>{message.text}</Text>
        </GlassCard>
        {message.process ? <ProcessStrip steps={message.process} /> : null}
        {message.artifacts ? <ArtifactStrip artifacts={message.artifacts} /> : null}
      </View>
    </View>
  )
}

function ProcessStrip({ steps }: { steps: { title: string; summary: string; status: string; icon: IconName }[] }) {
  return (
    <GlassCard style={styles.processCard}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>本轮过程</Text>
        <Pill label="展开" tone="blue" icon="chevron-down" />
      </View>
      {steps.map(step => (
        <View key={step.title} style={styles.processRow}>
          <MaterialCommunityIcons name={step.icon} size={18} color={step.status === 'running' ? '#2563eb' : '#475569'} />
          <View style={styles.processCopy}>
            <Text style={styles.cardTitle}>{step.title}</Text>
            <Text style={styles.bodyText}>{step.summary}</Text>
          </View>
        </View>
      ))}
    </GlassCard>
  )
}

function ArtifactStrip({ artifacts: items }: { artifacts: Artifact[] }) {
  return (
    <View style={styles.artifactGrid}>
      {items.map(item => (
        <GlassCard key={item.id} style={styles.artifactCard}>
          <MaterialCommunityIcons name={item.icon} size={22} color="#2563eb" />
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.bodyText} numberOfLines={2}>{item.summary}</Text>
          <Text style={styles.artifactMetric}>{item.metric}</Text>
        </GlassCard>
      ))}
    </View>
  )
}

function AgentCard({ agent, layoutTier }: { agent: Agent; layoutTier: LayoutTier }) {
  const isBuiltin = agent.id === 'orchestrator' || agent.id === 'engineer'
  const statusLabel = agent.status === 'running' ? '运行中' : agent.status === 'reviewing' ? '审查中' : '空闲中'
  const statusTone = agent.status === 'running' ? 'running' : agent.status === 'reviewing' ? 'reviewing' : 'idle'
  const isCompact = layoutTier === 'compact'
  const isStandard = layoutTier === 'standard'
  const avatarSize = isCompact ? 54 : isStandard ? 60 : 78

  return (
    <GlassCard style={[styles.agentCard, (isCompact || isStandard) && styles.agentCardResponsive]}>
      <AgentGlyph agentId={agent.id} size={avatarSize} />
      <View style={styles.agentCopy}>
        <View style={styles.agentCardTop}>
          <Text style={styles.agentName} numberOfLines={1}>{agent.name}</Text>
          <MaterialCommunityIcons name="chevron-right" size={26} color="#64748b" />
        </View>
        <View style={styles.agentBadgeRow}>
          <View style={[styles.agentTypeBadge, isBuiltin ? styles.agentTypeBuiltin : styles.agentTypeCustom]}>
            <Text style={[styles.agentTypeText, isBuiltin ? styles.agentTypeBuiltinText : styles.agentTypeCustomText]}>
              {isBuiltin ? '内置' : '自定义'}
            </Text>
          </View>
          <View style={[styles.agentStatusBadge, styles[statusTone]]}>
            <View style={[styles.agentStatusDot, styles[`${statusTone}Dot`]]} />
            <Text style={[styles.agentStatusText, styles[`${statusTone}Text`]]}>{statusLabel}</Text>
          </View>
        </View>
        <Text style={styles.agentProvider}>提供方： {agent.provider}</Text>
        <Text style={styles.agentRole} numberOfLines={1}>{agent.role}</Text>
        <View style={[styles.agentBottomRow, (isCompact || isStandard) && styles.agentBottomRowResponsive]}>
          <View style={styles.agentSkillLine}>
            {agent.skills.slice(0, 3).map(skill => (
              <View key={skill} style={[styles.agentSkillChip, agent.status === 'reviewing' ? styles.reviewSkillChip : agent.status === 'running' ? styles.runningSkillChip : undefined]}>
                <Text style={[styles.agentSkillText, agent.status === 'reviewing' ? styles.reviewSkillText : agent.status === 'running' ? styles.runningSkillText : undefined]}>{skill}</Text>
              </View>
            ))}
          </View>
          <View style={styles.agentToolLine}>
            {(['file-document-outline', 'console-line', 'web'] as IconName[]).map(icon => (
              <View key={icon} style={styles.agentToolBox}>
                <MaterialCommunityIcons name={icon} size={22} color="#334155" />
                <View style={styles.toolCheck}>
                  <MaterialCommunityIcons name="check" size={10} color="#fff" />
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </GlassCard>
  )
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  agentHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
  },
  codeHeader: {
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 8, android: 6, default: 8 }),
    paddingBottom: 14,
    gap: 12,
  },
  headerLeft: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  codeHeaderLeft: {
    flex: 1,
  },
  chatHeaderLeftTight: {
    gap: 0,
  },
  headerCopy: {
    minWidth: 0,
    flex: 1,
  },
  eyebrow: {
    color: 'rgba(51,65,85,0.62)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitle: {
    marginTop: 2,
    color: '#1f2937',
    fontSize: 25,
    fontWeight: '900',
  },
  codeSubtitle: {
    marginTop: 2,
    color: '#526173',
    fontSize: 14,
    fontWeight: '800',
  },
  headerAction: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeHeaderButton: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspaceHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconButton: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellWrap: {
    position: 'relative',
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 13,
    right: 13,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  agentCreateButton: {
    height: 48,
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  agentCreateButtonCompact: {
    minWidth: 82,
    paddingHorizontal: 12,
  },
  agentCreateText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
  },
  content: {
    flex: 1,
  },
  contentFill: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 20,
    paddingBottom: Platform.select({ ios: 52, android: 42, default: 48 }),
  },
  screenStack: {
    gap: 14,
  },
  homeScreen: {
    gap: 18,
    paddingTop: 4,
  },
  homeScreenCompact: {
    gap: 14,
  },
  homeGreetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeGreetingText: {
    flex: 1,
    minWidth: 0,
  },
  homeGreeting: {
    color: '#172033',
    fontSize: 34,
    fontWeight: '900',
  },
  homeGreetingSub: {
    marginTop: 10,
    color: '#172033',
    fontSize: 32,
    fontWeight: '900',
  },
  homeHeroOrb: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 124,
  },
  animatedHomeIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  animatedHomeIconImage: {
    width: '100%',
    height: '100%',
  },
  homeStatGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  homeSectionTitle: {
    color: '#172033',
    fontSize: 25,
    fontWeight: '900',
  },
  homeFeatureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  workspaceScreen: {
    gap: 14,
    paddingTop: 2,
  },
  workspaceScreenCompact: {
    gap: 12,
  },
  heroRow: {
    minHeight: 154,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroText: {
    flex: 1,
  },
  greeting: {
    color: '#252b36',
    fontSize: 35,
    fontWeight: '900',
  },
  heroTitle: {
    marginTop: 30,
    color: '#272d38',
    fontSize: 34,
    lineHeight: 47,
    fontWeight: '900',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    minHeight: 110,
    padding: 14,
    gap: 6,
    justifyContent: 'space-between',
  },
  statIcon: {
    alignSelf: 'flex-start',
  },
  statValue: {
    color: '#111827',
    fontSize: 32,
    fontWeight: '900',
  },
  statLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    color: '#202938',
    fontSize: 20,
    fontWeight: '900',
  },
  cardTitle: {
    color: '#273246',
    fontSize: 14,
    fontWeight: '900',
  },
  bodyText: {
    marginTop: 3,
    color: '#5d6b80',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  blockTitle: {
    marginTop: 8,
    color: '#1f2937',
    fontSize: 25,
    fontWeight: '900',
  },
  featureCard: {
    width: '31%',
    minHeight: 122,
    padding: 14,
    justifyContent: 'space-between',
  },
  featureIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
    backgroundColor: '#080b15',
  },
  featureLabel: {
    color: '#15304a',
    fontSize: 15,
    fontWeight: '900',
  },
  homeWorkspaceCard: {
    padding: 18,
    gap: 12,
    borderRadius: 28,
  },
  homeWorkspaceHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  homeWorkspaceEyebrow: {
    color: 'rgba(51,65,85,0.62)',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  homeWorkspaceTitle: {
    color: '#172033',
    fontSize: 26,
    fontWeight: '900',
  },
  homeStatusPill: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.48)',
  },
  homeStatusText: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '900',
  },
  homeWorkspaceDesc: {
    color: '#526173',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  homeWorkspaceMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  homeMetaChip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  homeMetaTextBlue: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '900',
  },
  homeMetaTextGreen: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '900',
  },
  homeMetaTextGray: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '900',
  },
  homeAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  homeAvatarText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
    color: '#526173',
    fontSize: 14,
    fontWeight: '700',
  },
  searchCard: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '700',
  },
  workspaceFilterLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
  },
  workspaceCard: {
    padding: 16,
    gap: 14,
    borderRadius: 26,
  },
  workspaceCardCompact: {
    padding: 14,
    gap: 12,
  },
  workspaceTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  workspaceIconTile: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    overflow: 'hidden',
  },
  workspaceTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  workspaceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  workspaceTitle: {
    flex: 1,
    minWidth: 0,
    color: '#172033',
    fontSize: 24,
    fontWeight: '900',
  },
  workspacePrimaryBadge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(237,233,254,0.82)',
  },
  workspacePrimaryText: {
    color: '#6d4ed8',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceGoal: {
    color: '#5d6b80',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  workspaceStatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  workspaceStatChip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  workspaceRunningDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#27bf83',
  },
  workspaceStatText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceStatTextBlue: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceStatTextPurple: {
    color: '#7c3aed',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceActionColumn: {
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 92,
    paddingTop: 2,
  },
  workspaceAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    gap: 0,
  },
  workspaceMoreAvatar: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
    borderWidth: 1,
    borderColor: '#d8dce3',
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  workspaceMoreAvatarText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '900',
  },
  workspaceAvatarText: {
    flex: 1,
    marginLeft: 10,
    color: '#526173',
    fontSize: 13,
    fontWeight: '700',
  },
  workspaceEventRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  workspaceEventLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workspaceEventLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  workspaceEventTime: {
    color: '#526173',
    fontSize: 12,
    fontWeight: '800',
  },
  workspaceEventText: {
    flex: 1,
    minWidth: 0,
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
  },
  loadMoreButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  loadMoreText: {
    color: '#526173',
    fontSize: 15,
    fontWeight: '800',
  },
  chatScreen: {
    flex: 1,
    gap: 14,
    paddingTop: 4,
  },
  chatScroll: {
    flex: 1,
  },
  chatScrollInner: {
    gap: 14,
    paddingBottom: 8,
  },
  chatHeaderTitle: {
    fontSize: 20,
  },
  chatSubtitleRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  chatLiveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#10b981',
  },
  chatHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  streamingPill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 13,
  },
  streamingText: {
    color: '#0f9f6e',
    fontSize: 14,
    fontWeight: '900',
  },
  chatStreamingRow: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  chatHeaderCard: {
    padding: 16,
    gap: 8,
  },
  userMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: 10,
  },
  userPromptBubble: {
    maxWidth: '78%',
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 24,
    backgroundColor: 'rgba(219,234,254,0.48)',
  },
  userPromptText: {
    color: '#172033',
    fontSize: 18,
    lineHeight: 31,
    fontWeight: '800',
  },
  mentionText: {
    color: '#2563eb',
    fontWeight: '900',
  },
  agentMessageBlock: {
    gap: 8,
  },
  agentMessageMetaRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  agentMessageName: {
    color: '#526173',
    fontSize: 16,
    fontWeight: '900',
  },
  agentSmallBadge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(237,233,254,0.72)',
  },
  agentSmallBadgeText: {
    color: '#7658d8',
    fontSize: 13,
    fontWeight: '900',
  },
  engineerBadge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(209,250,229,0.72)',
  },
  engineerBadgeText: {
    color: '#0f9f6e',
    fontSize: 13,
    fontWeight: '900',
  },
  chatBubbleLarge: {
    marginLeft: 66,
    maxWidth: '84%',
    padding: 18,
    borderRadius: 23,
  },
  engineerBubble: {
    marginLeft: 62,
    maxWidth: '78%',
    padding: 18,
    borderRadius: 23,
  },
  chatBubbleText: {
    color: '#172033',
    fontSize: 17,
    lineHeight: 30,
    fontWeight: '700',
  },
  chatBubbleTime: {
    marginTop: 8,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  chatProcessCard: {
    marginLeft: 66,
    maxWidth: '86%',
    padding: 14,
    gap: 9,
    borderRadius: 22,
  },
  chatProcessHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 2,
  },
  chatProcessTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatProcessTitle: {
    color: '#334155',
    fontSize: 16,
    fontWeight: '900',
  },
  processStatePill: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(239,246,255,0.8)',
  },
  processStateText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  chatProcessRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  chatProcessIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#94a3b8',
  },
  chatProcessIconDone: {
    backgroundColor: 'rgba(209,250,229,0.9)',
  },
  chatProcessIconRunning: {
    backgroundColor: '#5572ff',
  },
  chatProcessStepTitle: {
    color: '#172033',
    fontSize: 14,
    fontWeight: '900',
  },
  chatProcessSummary: {
    flex: 1,
    minWidth: 0,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  chatProcessTime: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  currentArtifactsPanel: {
    padding: 14,
    gap: 12,
    borderRadius: 24,
  },
  currentArtifactsTitle: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '900',
  },
  currentArtifactGrid: {
    flexDirection: 'row',
    gap: 9,
  },
  currentArtifactGridCompact: {
    flexWrap: 'wrap',
  },
  currentArtifactCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 118,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  currentArtifactTitle: {
    color: '#172033',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '900',
  },
  currentArtifactMeta: {
    color: '#2563eb',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '900',
  },
  currentArtifactMetaGreen: {
    color: '#10b981',
  },
  currentArtifactMetaMuted: {
    color: '#64748b',
  },
  chatComposer: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 24,
    marginTop: 2,
  },
  chatComposerInput: {
    flex: 1,
    minWidth: 0,
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '700',
  },
  composerToolButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  composerToolText: {
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '900',
  },
  chatSendButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#9ca3af',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageStack: {
    maxWidth: '86%',
    gap: 8,
  },
  messageStackUser: {
    alignItems: 'flex-end',
  },
  messageMeta: {
    marginLeft: 6,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  bubble: {
    padding: 13,
    borderRadius: 22,
  },
  userBubble: {
    backgroundColor: 'rgba(255,244,193,0.48)',
  },
  quoteText: {
    marginBottom: 8,
    padding: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    color: '#64748b',
    fontSize: 12,
  },
  messageText: {
    color: '#273246',
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '600',
  },
  processCard: {
    padding: 12,
    gap: 9,
  },
  processRow: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
  },
  processCopy: {
    flex: 1,
    minWidth: 0,
  },
  artifactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  artifactCard: {
    width: '47.8%',
    minHeight: 130,
    padding: 12,
    gap: 5,
  },
  artifactMetric: {
    marginTop: 'auto',
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    padding: 9,
    gap: 10,
  },
  composerInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 12,
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '700',
  },
  sendButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 25,
    backgroundColor: '#9ca3af',
  },
  segment: {
    flexDirection: 'row',
    gap: 8,
  },
  codeScreen: {
    gap: 14,
    paddingTop: 2,
  },
  codeSegment: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
  },
  codeSegmentItemActive: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(239,246,255,0.68)',
  },
  codeSegmentItem: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  codeSegmentDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(148,163,184,0.32)',
  },
  codeSegmentTextActive: {
    color: '#2563eb',
    fontSize: 18,
    fontWeight: '900',
  },
  codeSegmentText: {
    color: '#64748b',
    fontSize: 18,
    fontWeight: '900',
  },
  codePanel: {
    padding: 18,
    gap: 10,
    borderRadius: 28,
  },
  codePanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  codePanelTitleRow: {
    minWidth: 0,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  codePanelTitle: {
    color: '#172033',
    fontSize: 25,
    fontWeight: '900',
  },
  diffBadge: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  diffAdd: {
    color: '#10b981',
    fontSize: 15,
    fontWeight: '900',
  },
  diffSlash: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '900',
  },
  diffRemove: {
    color: '#f43f5e',
    fontSize: 15,
    fontWeight: '900',
  },
  codeFileRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  fileTypeIcon: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#3b82f6',
  },
  fileImageIcon: {
    backgroundColor: 'rgba(209,250,229,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,148,0.5)',
  },
  fileTypeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  fileCopy: {
    flex: 1,
    minWidth: 0,
  },
  filePath: {
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '900',
  },
  fileMeta: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  fileStatusWrap: {
    minWidth: 86,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  fileStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#aeb7c2',
  },
  fileStatusAdded: {
    backgroundColor: '#34c38f',
  },
  fileStatusModified: {
    backgroundColor: '#f6b422',
  },
  fileStatusText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'lowercase',
  },
  changeBadge: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  changeAdded: {
    color: '#059669',
  },
  changeModified: {
    color: '#2563eb',
  },
  previewPanel: {
    padding: 16,
  },
  previewShowcase: {
    minHeight: 318,
    padding: 18,
    borderRadius: 28,
  },
  previewShowcaseCompact: {
    minHeight: 292,
  },
  previewStage: {
    flex: 1,
    minHeight: 232,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewArrow: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  previewPhoneMini: {
    width: 132,
    height: 226,
    overflow: 'hidden',
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.1)',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.78)',
    shadowColor: '#475569',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  miniStatusBar: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#111827',
  },
  miniHeaderLine: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  miniTinyText: {
    color: '#172033',
    fontSize: 6,
    fontWeight: '900',
  },
  miniGreeting: {
    marginTop: 10,
    color: '#172033',
    fontSize: 10,
    fontWeight: '900',
  },
  miniTitle: {
    color: '#172033',
    fontSize: 13,
    fontWeight: '900',
  },
  miniStatsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 5,
  },
  miniStat: {
    flex: 1,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(226,232,240,0.72)',
  },
  miniListBlock: {
    marginTop: 10,
    height: 66,
    borderRadius: 11,
    backgroundColor: 'rgba(241,245,249,0.9)',
  },
  miniNav: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 9,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: 15,
    backgroundColor: 'rgba(15,23,42,0.84)',
  },
  miniAi: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  previewDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 9,
  },
  previewDotActive: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  previewDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: 'rgba(148,163,184,0.34)',
  },
  phonePreview: {
    overflow: 'hidden',
    minHeight: 260,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.44)',
  },
  previewTitle: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '900',
  },
  previewBig: {
    marginTop: 16,
    color: '#111827',
    fontSize: 26,
    fontWeight: '900',
  },
  previewCard: {
    height: 56,
    marginTop: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  previewDock: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: 28,
    backgroundColor: 'rgba(15,23,42,0.78)',
  },
  deliveryCard: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  deliveryCopy: {
    flex: 1,
    minWidth: 0,
  },
  deliveryStatusPanel: {
    padding: 18,
    gap: 16,
    borderRadius: 28,
  },
  deliveryStatusGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  deliveryStatusGridCompact: {
    flexDirection: 'column',
  },
  deliveryStatusCard: {
    flex: 1,
    minHeight: 150,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  deliveryStatusIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(219,234,254,0.82)',
  },
  deliveryStatusIconPurple: {
    backgroundColor: 'rgba(237,233,254,0.82)',
  },
  deliveryStatusIconGreen: {
    backgroundColor: 'rgba(209,250,229,0.82)',
  },
  deliveryStatusTitle: {
    marginTop: 9,
    color: '#172033',
    fontSize: 15,
    fontWeight: '900',
  },
  deliveryStatusPill: {
    alignSelf: 'flex-start',
    marginTop: 5,
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.48)',
  },
  deliveryStatusPillText: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '900',
  },
  deliveryStatusRunning: {
    color: '#2563eb',
  },
  deliveryStatusIdle: {
    color: '#64748b',
  },
  deliveryStatusBody: {
    marginTop: 12,
    color: '#273246',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  deliveryStatusTime: {
    marginTop: 'auto',
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  deliveryActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  deliveryActionRowCompact: {
    flexDirection: 'column',
  },
  deliveryOutlineButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  deliveryOutlineText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '900',
  },
  deliveryPrimaryButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#2563eb',
  },
  deliveryPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  deliveryGreenButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#22c59e',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  deliveryGreenText: {
    color: '#22c59e',
    fontSize: 16,
    fontWeight: '900',
  },
  agentScreen: {
    gap: 14,
    paddingTop: 4,
  },
  agentSummary: {
    minHeight: 220,
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderRadius: 28,
  },
  agentSummaryCompact: {
    minHeight: 112,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  agentSummaryHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  agentSummaryHeroCompact: {
    gap: 12,
  },
  registryIcon: {
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(221,229,255,0.68)',
  },
  registryCopy: {
    flex: 1,
    minWidth: 0,
  },
  registryTitle: {
    color: '#172033',
    fontSize: 26,
    fontWeight: '900',
  },
  agentSummaryText: {
    marginTop: 8,
    color: '#526173',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '800',
  },
  agentMetricRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  agentMetricBox: {
    flex: 1,
    minHeight: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  metricValueLine: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  metricDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#27bf83',
  },
  agentMetricValue: {
    color: '#172033',
    fontSize: 34,
    fontWeight: '900',
  },
  agentMetricLabel: {
    marginTop: 2,
    color: '#526173',
    fontSize: 15,
    fontWeight: '800',
  },
  agentSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 2,
  },
  agentSearchRowCompact: {
    gap: 8,
  },
  agentSearchBox: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  agentSearchPlaceholder: {
    color: '#64748b',
    fontSize: 16,
    fontWeight: '800',
  },
  agentFilterButton: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  agentFilterText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '900',
  },
  agentCard: {
    minHeight: 144,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: 28,
  },
  agentCardResponsive: {
    minHeight: 150,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  agentCopy: {
    flex: 1,
    minWidth: 0,
  },
  agentCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  agentBadgeRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  agentName: {
    flex: 1,
    minWidth: 0,
    color: '#172033',
    fontSize: 22,
    fontWeight: '900',
  },
  agentTypeBadge: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  agentTypeBuiltin: {
    backgroundColor: 'rgba(124,88,216,0.11)',
  },
  agentTypeCustom: {
    backgroundColor: 'rgba(37,99,235,0.1)',
  },
  agentTypeText: {
    fontSize: 13,
    fontWeight: '900',
  },
  agentTypeBuiltinText: {
    color: '#7658d8',
  },
  agentTypeCustomText: {
    color: '#2563eb',
  },
  agentStatusBadge: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  running: {
    backgroundColor: 'rgba(230,250,241,0.72)',
  },
  idle: {
    backgroundColor: 'rgba(241,245,249,0.76)',
  },
  reviewing: {
    backgroundColor: 'rgba(255,241,218,0.78)',
  },
  agentStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  runningDot: {
    backgroundColor: '#20b981',
  },
  idleDot: {
    backgroundColor: '#64748b',
  },
  reviewingDot: {
    backgroundColor: '#d97706',
  },
  agentStatusText: {
    fontSize: 14,
    fontWeight: '900',
  },
  runningText: {
    color: '#0f9f6e',
  },
  idleText: {
    color: '#475569',
  },
  reviewingText: {
    color: '#b45309',
  },
  agentProvider: {
    marginTop: 7,
    color: '#526173',
    fontSize: 14,
    fontWeight: '800',
  },
  agentRole: {
    marginTop: 8,
    color: '#334155',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '800',
  },
  agentBottomRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  agentBottomRowResponsive: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 10,
  },
  agentSkillLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  agentSkillChip: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 999,
    backgroundColor: 'rgba(239,232,255,0.56)',
  },
  runningSkillChip: {
    backgroundColor: 'rgba(222,247,236,0.66)',
  },
  reviewSkillChip: {
    backgroundColor: 'rgba(255,237,213,0.66)',
  },
  agentSkillText: {
    color: '#6d4ed8',
    fontSize: 14,
    fontWeight: '900',
  },
  runningSkillText: {
    color: '#119b68',
  },
  reviewSkillText: {
    color: '#b45309',
  },
  agentToolLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  agentToolBox: {
    width: 39,
    height: 39,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  toolCheck: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 15,
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#28bf7b',
  },
  agentLoadedText: {
    color: '#64748b',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
  },
  sideRail: {
    position: 'absolute',
    left: 12,
    minHeight: 320,
    width: 142,
    justifyContent: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderRadius: 34,
  },
  navFab: {
    position: 'absolute',
    left: 18,
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 29,
    backgroundColor: 'rgba(15,23,42,0.82)',
  },
  navFabButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  sideRailToggle: {
    width: 46,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sideRailStack: {
    marginTop: 8,
    gap: 8,
  },
  sideRailItem: {
    minHeight: 48,
    borderRadius: 24,
  },
  sideRailItemExpanded: {
    minWidth: 124,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
  },
  sideRailItemActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  sideRailIconWrap: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
  },
  sideRailIconWrapActive: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  sideRailAi: {
    minHeight: 62,
  },
  sideRailAiIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 36,
    backgroundColor: '#14e0ba',
  },
  sideRailAiActive: {
    backgroundColor: 'rgba(20,224,186,0.18)',
  },
  sideRailLabel: {
    flex: 1,
    minWidth: 0,
    color: '#dbe4ee',
    fontSize: 13,
    fontWeight: '800',
  },
  sideRailLabelActive: {
    color: '#fff',
  },
  sideRailAiLabel: {
    color: '#8ef5dd',
    fontSize: 15,
    fontWeight: '900',
  },
})
