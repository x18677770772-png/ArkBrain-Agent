# brain-ui 视觉审计 · 基线差距清单（2026-09-25）

基线截图：`/tmp/ui-baseline.png`（http://127.0.0.1:3721/brain-ui，1600×900，默认 midnight 主题）

## 观察到的问题（按优先级）

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| 1 | **无字号/间距/圆角 token** | `styles.css` fontSize 直写 9~13px 高频、radius 8/12/16 直写，`:root` 无对应变量 | 补 `--fs-*` `--space-*` `--radius-*`，新面板强制走 token |
| 2 | **无动效规则** | transition/easing 分散直写，无统一时长/曲线 | 补 `--dur-*` `--ease-*`（按 emil: fast 120 / base 240 / slow 400，`cubic-bezier(.2,0,0,1)`） |
| 3 | **无语义 diff 色阶** | 只有 cool/warm/ok/warn/danger，方案 diff 需要「青=增 / 琥珀=删」（蓝图强制） | 补 `--add` / `--del` 双语义色 |
| 4 | **右栏卡片同权重、无 hero** | Status/Heartbeat/ActionLog/Cognition 四卡等大等距，缺主锚点 | 业务台看板用 HeroMetric 打破均匀；主界面后续再调 |
| 5 | **中央死区** | 节点图小、四周大片空白，首屏无视觉锚 | 业务台占满中央；主界面保持现状（v1 不动结构） |
| 6 | **小字对比偏低** | `--dim:#778397` on `--bg0:#111821`，9~11px mono 密集 | 新面板正文 ≥12px，关键数字用大号 mono |
| 7 | **mono 泛用** | JetBrains Mono 77 处（含非数字文本） | 新面板：数字/标签 mono，正文 Inter |
| 8 | **业务视图缺失** | 无看板/会员360/检测/方案/审计/闸门入口 | 新增「方舟业务台」全屏面板（单面板 6 tab） |

## 接入决策（v1）

- **单面板 6 tab**（而非 6 个独立面板）：只加 1 套五件套挂载点，回归面最小；tab 内容后续可拆。
- 挂载走 `knowledge-panel` 同款模式（markup 导出 + body mode class + init/setMode + SSE case 预留）。
- **后端工具 `biz_panel_mode` 延后**：v1 入口 = L1 头部按钮 + 自然语言关键词（“业务台/看板/方案审阅”），与 hotspot 同款 NL 打开。
- 数据 v1 用 seed（接口形状对齐蓝图），真实落库等 A5 切片接。
- 图表沿用 d3，不引 echarts。
