# UI 品质提升 · 开源项目 / 技能 / 插件调研

> 2026-09-25 全网调研。背景：demo/ 静态页是另起炉灶重写的，审美不达标。
> 决策：**不重写，在白龙马原 UI（`src/ui/brain-ui/`）基础上做得更好**。本报告回答"用什么资源做得更好"。

---

## 〇、结论先说

1. **本机已装的设计类 Skill 非常全**（见 §1），大部分不用再装——直接用。
2. 真正缺的不是 skill，是**执行策略**：原 UI 是 vanilla JS + 自有 CSS tokens（无 React/Tailwind），
   外部组件库**不能直接 import**，只能作为**视觉对标 + 转译来源**。
3. 推荐组合拳：
   `frontend-design（定方向） + ui-ux-pro-max（系统化） + emilkowalski/skills（动效） + image-to-code（对标截图→代码） + ai-slop-cleaner（验收兜底）`

---

## 1. 设计类 Skills / 插件（让 AI 生成的 UI 不丑）

### 1a. 本机已安装（`~/.claude/skills/`，直接可用）

| Skill | 用途 | 备注 |
|---|---|---|
| `frontend-design` | Anthropic 官方，反模板化生产级前端 | 主力，定视觉方向 |
| `design-taste-frontend` / `-v1` | 设计品味（双版本） | 二选一对比用 |
| `stitch-design-taste` | Google Stitch 系设计品味 | 正面范式 |
| `taste-skill` / `-v1` | 设计口味旋钮（克制↔电影感等维度） | 风格调参 |
| `gpt-taste` / `gpt-tasteskill` | GPT 系品味 | 对照参考 |
| `high-end-visual-design` | 高端视觉 | 深色科技风适配 |
| `ui-ux-pro-max`（plugin） | 设计系统/组件系统化 | 社区安装量第一的设计类 |
| `redesign-existing-projects` | **改现有项目 UI（非重写）** | ⭐ 本次场景最对口 |
| `redesign-skill` | 重设计流程 | 与上配合 |
| `image-to-code` / `-skill` | 截图→代码（视觉对标转译） | 抄外部好设计用 |
| `ai-slop-cleaner` | 清 AI 味（deslop 触发词） | 验收兜底 |
| `dashboard-builder` | 看板生成 | 看板视图用 |
| `visual-verdict` | 视觉验收裁决 | 出图后把关 |
| `industrial-brutalist-ui` / `brutalist-skill` / `liquid-glass-design` / `minimalist-ui` | 风格包 | 备选风格 |

### 1b. 值得补装的外部 Skill / 插件

| 项目 | Star/热度 | 说明 | 安装 |
|---|---|---|---|
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | ~38k★ | Vercel 设计工程师十年经验 → 13 个 markdown：缓动曲线、时长、性能坑、Apple 流体交互原则；**专治动效僵硬** | `git clone` 进 `~/.claude/skills/` |
| [superdesigndev/superdesign-skill](https://github.com/superdesigndev/superdesign) | ~6.7k★ | 开源 IDE 内设计 Agent + skill，生成多风格 UI 草图供选 | `npx skills add superdesigndev/superdesign-skill` |
| [google-labs-code/stitch-skills](https://github.com/google-labs-code/stitch-skills) | Google Labs | "正面范式"设计 skill（照这个做） | clone |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | — | 与本机 `taste-skill` 同源，可对照版本 | 已有同名 |
| [anthropics frontend-design 官方插件](https://github.com/anthropics/claude-code) | 官方 | `/plugin marketplace add anthropics/claude-code` 后 install | **本机已有 skill 版，无需重装** |
| [marvkr/better-design](https://github.com/marvkr/better-design) | — | design MCP + shadcn registry，给 Claude Code/Cursor 喂设计系统 | MCP 方式 |
| Refactoring UI skill（shyft.ai/skills/refactoring-ui-skill） | — | 《Refactoring UI》战术规则（间距/层级/用色） | clone |

---

## 2. 高品质开源 UI 项目（视觉对标 + Web 模块转译用）

### 2a. 组件 / 区块库（React + Tailwind 生态为主）

| 项目 | 定位 | 对本项目用途 |
|---|---|---|
| [shadcn/ui](https://ui.shadcn.com) | 事实标准，源码所有权模式 | Web 四件套（蓝图是 Vue3）→ 用 **shadcn-vue** 移植版 |
| [Aceternity UI](https://ui.aceternity.com) | 200+ 电影感组件（发光/3D 卡/粒子） | Hero、落地页级视觉对标；`npx shadcn add ...` |
| [Magic UI](https://magicui.design) | 动效组件（ beams / 后光等） | 打开动画、空状态动效参考 |
| [Motion Primitives](https://motion-primitives.com) | shadcn 官方 registry，克制的动效 | 面板进出场、微交互对标 |
| [21st.dev](https://21st.dev) | 社区组件市场（AI 原生） | 找灵感 + `npx skills add` 生态 |
| [Cult UI / Shadcnblocks](https://shadcnblocks.com) | 1,557 区块 + Figma | 布局结构对标 |
| [Untitled UI](https://www.untitledui.com) | 精致度标杆（免费+付费） | 表单/选择器/徽章细节对标 |
| [Flowbite](https://flowbite.com) | Tailwind + 开源 admin | 深色 admin 参考 |

### 2b. 开源 Dashboard 模板（看板视图对标）

| 项目 | 说明 |
|---|---|
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | 免费开源，10+ 页面，明暗主题，WAI-ARIA — **看板结构首选对标** |
| [shadcndashboard.dev](https://shadcndashboard.dev) | 2026 新出的开源完整 Dashboard kit |
| [Modernize (MUI)](https://github.com/coreui/coreui-free-react-admin-template) / [CoreUI](https://coreui.io) | React/MUI 系开源模板 |
| [DarkAdminDashboard](https://github.com/shrek82/DarkAdminDashboard) | 通用深色后台，颜值在线 |
| [startbootstrap/sb-admin](https://github.com/startbootstrap/sb-admin) | 老牌经典 Bootstrap 后台 |

### 2c. Vue 生态（蓝图 WEB 模块 = Vue3+Vite，React 库用不上）

- **shadcn-vue** — shadcn 官方 Vue 移植（首选）
- **PrimeVue / Naive UI / Varlet** — 深色主题完善的 Vue 组件库
- **Flowbite Vue** — 深色 admin 参考

---

## 3. ⚠️ 关键约束：原 UI 是 vanilla JS，怎么用上面这些

- `src/ui/brain-ui/` = 手写 CSS（6264 行 `styles.css`）+ 手写 JS 面板，**无 React/Vue/Tailwind 构建链**。
- 因此外部库的正确用法：
  1. **视觉对标**：截图 → `image-to-code` skill 转译成本地 CSS 面板；
  2. **token 吸收**：把 shadcn/Untitled 的 spacing/层次/色阶规则吸收进 `:root` token（原库字号/圆角**没有 token**，直写值泛滥 — 已知债）；
  3. **动效规则**：emilkowalski/skills 的缓动/时长规则直接写进 `styles.css` 过渡层（纯 CSS 可用，无需框架）；
  4. **新 Web 模块**（蓝图 F1–F4 四件套，Vue3+Vite）：直接上 shadcn-vue + daisy/Flowbite。
- 禁止：给 brain-ui 引入 React/Tailwind 构建链"为了用组件库" — 与既有架构冲突，回归风险大。

---

## 4. 执行路径（基于原 UI 做得更好）

1. **视觉审计**：用 `redesign-existing-projects` + `visual-verdict` 对 brain-ui 现有 6 主题做审计，产出差距清单。
2. **补 token 地基**：在 `styles.css:1-32` `:root` 补字号/圆角/间距/**双语义色阶（青=增 / 琥珀=删，方案 diff 用）** token —— 探查确认原库没有。
3. **6 个业务视图按原 UI 模式接入**（不另写静态页），双轨：
   - 轨道 A（重视图：会员360/检测台/方案diff/Agent审计/闸门/看板）：抄 `knowledge-panel.js` 面板五件套
     （panel 模板 + 控制器 + app-shell 挂载 + app.js 接线 + 工具 schema + CSS），约 0.5–1.5 人日/视图；
   - 轨道 B（轻量 KPI 卡）：走 scene-shell 现成 `metric` kind（`scene-shell/kinds/metric.js`，带 morph 翻数动画）。
   - 可先抽 `panel-factory` 注册表，把每视图 6 个改动点压成 1 个注册文件（预计省 30%）。
4. **动效升级**：按 emilkowalski 规则统一过渡曲线/时长；看板 HeroMetric 借鉴 scene metric 的翻数动画。
5. **验收**：`visual-verdict` + `ai-slop-cleaner` 双关，截图存 `demo/screenshots/` 对比。
6. 图表沿用已引入的 **d3**（不加 echarts，控依赖体积）。

## 5. 已知地雷（探查结论）

- `src/ui-bridge.js` ACUI 通道是**断链死代码**（import 的符号不存在）——不要沿用。
- `styles.css` 已 6264 行、99 处 `body.*-mode` —— 新面板前先补 token，别再堆直写值。
- demo/ 6 视图是零构建静态页，**仅作交互/叙事原型保留**，正式实现一律进 brain-ui。
