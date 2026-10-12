# Changelog

本项目版本号与 `package.json` 同步，遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
Windows 桌面安装包由 GitHub Actions 在推送 `v*` 标签后自动构建并挂到 Releases。

## [1.0.0-beta.2] - 2026-10-12

### 🐛 修复

- **安装包启动即崩（beta.1 实机踩坑）**：`bridge/**` 未进 app.asar，后端 import
  `src/api/routes/ruimeiyun.js` → `bridge/cockpit.js` 时 `Cannot find module`。
  `files` 列表补上 `bridge/**/*`（凭据 `accounts.json` / 审计日志仍强制排除）；
  smoke 测试新增 asar 条目硬校验 + 睿美云路由 ESM 模块图探针，此类漏包在 CI 就红。
- **LLM 长答案间歇性截断**：Ark plan 偶发断流（缺 terminal / incomplete）时旧逻辑
  对带正文的错误一律不重试，直接交付半截答案。现两种断流码带正文也整条重发
  （800/2500ms 退避，最坏 3 次），耗尽后用 partial 兜底交付；`length` 截断
  （撞 max_output_tokens，确定性失败）跳过重试直接交付已有正文。

### ✨ 新增

- **出厂默认人格：全球长寿医学超级专家**（`src/persona-default.js`）。安装包所有
  用户首次启动自动 seed；被问"你是谁"/健康长寿问题时以"融汇全球长寿医学智慧的
  超级医学专家"身份回答——通读全球长寿医学论文/文献/临床数据，循证标注证据等级
  （人体临床试验 / 观察性 / 动物实验 / 假说），涉及疾病诊疗明确建议就医。
  可被 `[UPDATE_PERSONA: ...]` 正常改写，是可覆盖的出厂默认而非硬锁。

## [1.0.0-beta.1] - 2026-10-12

方舟大脑（ArkBrain-Agent）首个 Beta 版本，二开基线 2.2.120。

### ✨ 新增

- **方舟业务台**（6 视图驾驶舱）：会员 360、检测台、方案签发、偏好看板等面板接入。
- **A5 纵切片**：检测录入 → diff 签发 → PG 偏好对落库 → 看板计数（3721 薄代理 → ark-api → PostgreSQL）。
- **睿美云 RM-Bridge**：服务层 + 驾驶舱接入（mock 全链路验收）。
- **公网隧道预览**：`ARKBRAIN_EXTRA_ALLOWED_ORIGINS` 来源白名单放行非敏感预览面
  （页面 / 聊天 / 语音 / SSE）；**敏感面（设置、管理、记忆、看板、/scene）永远需要口令**——
  用带口令链接（`…/#token=<口令>`）打开即获完整会话，与桌面端局域网配对模型一致。
  信任模型详见 README「公网预览白名单」。
- **火山方舟 Agent Plan 语音**：TTS/ASR 端点切换至 `openspeech.bytedance.com/api/v3/plan/*`
  （ark-* Key 计费入口，避免 `ark.cn-beijing.volces.com/api/v3` 语音额外计费）。
- **Windows 桌面版 CI**：`.github/workflows/windows-release.yml` —
  push `v*` tag 自动在 `windows-latest` 构建 NSIS 安装包并发布到 Releases。
- 403 拒绝服务端留痕日志（`[API 403] 门禁名 方法 路径 origin=…`）。

### 🔄 变更

- 版本号方案：`2.2.120`（上游基线）→ `1.0.0-beta.1`（方舟大脑独立发版线）。
- 安装包产物名统一为 `ArkBrain-Setup-<version>.exe`
  （修复重品牌引入的 `artifactName` 与构建脚本期望不一致、Windows 构建必败的存量 bug）。
- 前端配对门禁收窄：仅私网主机要求配对口令，公网隧道域名交由后端白名单把关。
- `config.json`（含 API key）移出 git，`.gitignore` 兜底。
- 页面标题 / i18n / 人卡 / 提示词种子中 Longma 残留全部替换为「方舟大脑 / ArkBrain」。

### 🐛 修复

- 隧道预览下「发送失败 — 请检查本地服务是否运行」（Origin 门禁误拦）。
- 隧道预览下语音麦克风无反应（前端配对门禁 + WS `forbidden_origin` 双重拦截）。
- 隧道预览下设置页音色下拉空白 / 保存失败（敏感面 `requireLocalOrToken` 误拦隧道 Origin）。
- favicon / 站点图标缓存（`?v=2` 版本戳）。

### ⚠️ 已知问题

- `src/test-active-policies.js` 1 条子断言失败（"unrelated web policy does not activate
  for screenshot task"）— 二开前存量问题，干净基线同样失败，召回评分对
  `agent` 类通用词的匹配偏宽，低影响，后续版本优化。
- `test-recognizer` / `test-runner` 为真实 LLM 交互用例，依赖网络与模型服务时耗时较长。
- 自动更新通道沿用上游 generic feed 配置（`updates.arkbrain.ai`，本 fork 未发布到该通道）；
  Beta 期请以 Release 页手动安装为准，版本号 `1.0.0-beta.1` 低于上游 `2.2.x` 序，
  后续正式版需单独规划更新通道（独立 beta channel 或显式 allowDowngrade）。

### 📦 发布

- Windows x64 NSIS 安装包：`ArkBrain-Setup-1.0.0-beta.1.exe`（Release 页下载，未签名 —
  首次运行需在 SmartScreen 提示中选择「仍要运行」）。
