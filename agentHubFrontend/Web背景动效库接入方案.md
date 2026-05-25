# Web 背景动效库接入方案

## 背景

当前 Web 工作台已经有 `BackgroundCanvas` 手写 canvas 背景层，但视觉流动感不够稳定，继续手搓会带来三个问题：

- 调参成本高：粒子密度、颜色、速度、移动端性能都要自己维护。
- 效果上限低：连线、闪烁、视差、响应式粒子数量等都需要继续补代码。
- 验证成本高：每次改动都要重新检查 canvas 生命周期、设备像素比、隐藏标签页恢复和性能。

因此建议把粒子系统交给成熟库，前端只保留配置和背景层样式。

## 推荐结论

优先使用 `tsParticles`，采用 `@tsparticles/react` + `@tsparticles/slim`。

推荐版本先固定在 3.x：

```bash
npm --prefix web install @tsparticles/react@3.0.0 @tsparticles/slim@3.9.1 @tsparticles/engine@3.9.1
```

原因：

- 最新 `@tsparticles/react@4.0.5` 当前发布包的 peer dependency 含有 `@tsparticles/engine: workspace:^`，本项目环境下 `npm --prefix web install @tsparticles/react @tsparticles/slim` 会报 `Unsupported URL Type "workspace:"`。
- `@tsparticles/react@3.0.0` 的 peer dependency 是 `@tsparticles/engine: ^3.0.2`，可以和 `@tsparticles/slim@3.9.1` / `@tsparticles/engine@3.9.1` 配套。
- 3.x 版本已经满足本项目需要的粒子、颜色、透明度、移动、连线和响应式配置，不需要上 4.x。

## 视觉目标

背景仍然保留用户准备好的背景图，粒子库只负责增强“活的背景”。

目标效果：

- 粉紫、蓝紫、玫红、浅蓝为主色。
- 粒子明显可见，但不抢聊天内容。
- 玻璃组件下方能看到背景颜色和粒子轻微变化。
- 背景动效只影响背景层，不影响任何组件点击、输入和滚动。
- 页面整体仍然是工作台，不做游戏化或过度科幻效果。

建议分成两层：

- CSS 渐变流光层：负责大面积粉紫蓝色彩变化。
- tsParticles 粒子层：负责漂移、闪烁、少量连线和空间感。

## 技术设计

### 组件结构

保留 `web/src/components/BackgroundCanvas.tsx` 文件名，内部实现改成库驱动，避免改动 `App.tsx` 的引用。

建议结构：

```tsx
import Particles, { initParticlesEngine } from '@tsparticles/react'
import { loadSlim } from '@tsparticles/slim'
import { useEffect, useMemo, useState } from 'react'

export function BackgroundCanvas() {
  // 初始化 tsParticles slim engine
  // 返回非交互背景粒子层
}
```

需要遵守 `developSkills.md`：新增或修改函数写英文注释，说明 purpose / input / output。

### 背景层级

继续沿用当前层级：

- `.app-shell`：背景图。
- `.background-canvas`：tsParticles 背景层，`pointer-events: none`。
- `.app-overlay`：轻量白雾和柔光，不要盖住粒子。
- `.app-content`：真实 UI，`z-index: 1`。

### 推荐粒子配置

桌面端：

- 粒子数量：100 到 130。
- 粒子大小：2 到 6。
- 透明度：0.25 到 0.75，带轻微动画。
- 移动速度：0.35 到 0.8。
- 连线：开启，但距离短、透明度低。
- 交互：关闭 hover / click，避免影响工作台。

移动端：

- 粒子数量降到 45 到 65。
- 连线透明度进一步降低。
- 降低移动速度，减少电量和性能压力。

示意配置方向：

```ts
const particleOptions = {
  fullScreen: { enable: false },
  detectRetina: true,
  fpsLimit: 60,
  particles: {
    number: { value: 120, density: { enable: true } },
    color: { value: ['#a855f7', '#ec4899', '#60a5fa', '#f0abfc'] },
    opacity: { value: { min: 0.25, max: 0.72 }, animation: { enable: true, speed: 0.6 } },
    size: { value: { min: 1.8, max: 5.5 }, animation: { enable: true, speed: 1.4 } },
    links: { enable: true, color: '#f0abfc', distance: 120, opacity: 0.16, width: 1 },
    move: { enable: true, speed: { min: 0.35, max: 0.8 }, direction: 'none', outModes: 'out' },
  },
  interactivity: { events: { onHover: { enable: false }, onClick: { enable: false } } },
  responsive: [
    { maxWidth: 760, options: { particles: { number: { value: 56 }, links: { opacity: 0.1 } } } },
  ],
}
```

最终代码要以实际 TypeScript 类型为准，不能直接照抄导致类型不通过。

## 文件改动范围

只改前端相关文件：

- `web/package.json`
- `web/package-lock.json`
- `web/src/components/BackgroundCanvas.tsx`
- `web/src/styles/effects.css`

可选：

- `README.md`：如果用户确认实施后，再同步项目现状。

不改：

- `src/server/**`
- `src/shared/**`
- 根目录后端依赖

## 实施步骤

1. 固定安装 3.x 依赖。
2. 将 `BackgroundCanvas.tsx` 从手写 canvas 改为 tsParticles React 组件。
3. 在 `effects.css` 增加 CSS 粉紫蓝流光层，可以用 `.background-canvas::before` 或单独 wrapper。
4. 保持 `pointer-events: none` 和现有层级，确保不影响前景 UI。
5. 调整粒子数量、透明度、连线距离和移动速度，让效果明显但不抢内容。
6. 更新 README 或方案记录。
7. 只暂存前端文件并提交。

## 验证计划

实施后至少执行：

```bash
npm run check:web
npm run build:web
git diff --check
Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing -TimeoutSec 5
```

如果根目录存在后端未提交改动，`npm run check` 可能会受后端类型错误影响；这类错误需要单独说明，不应该混入本次前端背景提交。

## 风险与回退

风险：

- 依赖版本解析失败：使用精确 3.x 版本规避 4.x 的 `workspace:^` peer dependency 问题。
- 背景过亮：降低粒子 opacity、links opacity 或 CSS 流光透明度。
- 移动端性能不足：通过 responsive 配置降低粒子数和连线。
- 类型不兼容：以 `@tsparticles/engine` 的实际类型为准，必要时把配置对象收敛为库接受的 options 类型。

回退：

- 如果 tsParticles 接入后效果或体积不合适，可以保留 CSS 渐变流光，移除粒子库，恢复到轻量 CSS 背景动效。
- 当前手写 `BackgroundCanvas` 已经提交过，必要时可以从 git history 恢复。

## 建议决策

建议下一步采用 `tsParticles 3.x + CSS 渐变流光`。

理由是粒子效果交给库，颜色氛围交给 CSS，前端只维护配置；这比继续手写 canvas 更稳定，也更方便按用户反馈快速调明显度。
