/**
 * 方舟业务台 · 控制器（brain-ui 五件套之二）
 * setBizPanelMode 开合 · tab 切换 · 6 视图渲染 · 方案签发交互（借假修真，v1 本地状态）。
 * 动效遵守 token：只动 transform/opacity，时长走 --dur-*。
 */
import { BIZ_DATA } from "./biz-data.js";
import { COCKPIT_SEED } from "./cockpit-data.js";

const $ = (id) => document.getElementById(id);

const VIEW_META = {
  dashboard: { kicker: "01 · FLYWHEEL", title: "看板 · 飞轮总览" },
  members: { kicker: "02 · MEMBER 360", title: "会员 360" },
  lab: { kicker: "03 · LAB CONSOLE", title: "检测台" },
  plan: { kicker: "04 · PLAN REVIEW", title: "方案审阅台 · diff 签发" },
  audit: { kicker: "05 · GATEWAY AUDIT", title: "Agent 审计流" },
  gates: { kicker: "06 · MODEL GATES", title: "模型四闸门" },
  cockpit: { kicker: "07 · RM COCKPIT", title: "驾驶舱 · 睿美云经营总览" },
};

// 可变业务状态（签发会增长；v1 内存态，A5 接库后由 API 回读）
const state = {
  active: false,
  view: "dashboard",
  memberId: BIZ_DATA.members[0].id,
  planStatus: BIZ_DATA.plan.status, // pending_sign → signed
  prefPairs: BIZ_DATA.metrics.preferencePairs,
  prefToday: BIZ_DATA.metrics.preferenceToday,
  plansSigned: BIZ_DATA.metrics.plansSigned,
  feed: [...BIZ_DATA.agentFeed],
  signedAt: null,
};

const fmt = (n) => Number(n).toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));

function sparkPath(values, w, h) {
  if (!values?.length) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  return values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
}

/* ── 看板 ────────────────────────────────────────────── */
function renderDashboard() {
  $("biz-hero-pref").textContent = fmt(state.prefPairs);
  $("biz-hero-today").textContent = `今日 +${state.prefToday}`;
  $("biz-spark").innerHTML = `<path d="${sparkPath(BIZ_DATA.preferenceDaily, 140, 32)}" fill="none" stroke="var(--warm)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  $("biz-m-coverage").textContent = `${BIZ_DATA.metrics.trajectoryCoverage}%`;
  $("biz-m-signed").textContent = fmt(state.plansSigned);
  $("biz-m-llm").textContent = fmt(BIZ_DATA.metrics.llmCalls);

  const max = Math.max(...BIZ_DATA.funnel.map((f) => f.value));
  $("biz-funnel").innerHTML = BIZ_DATA.funnel.map((f) => `
    <div class="biz-funnel-row">
      <span class="biz-funnel-label">${esc(f.label)}</span>
      <span class="biz-funnel-track"><span class="biz-funnel-bar" style="width:${(f.value / max) * 100}%"></span></span>
      <span class="biz-funnel-val">${f.value}<i>${esc(f.unit)}</i></span>
    </div>`).join("");

  $("biz-dash-stream").innerHTML = state.feed.slice(0, 6).map((e) => `
    <div class="biz-stream-row">
      <span class="biz-stream-dot biz-risk-${esc(e.risk || "low")}"></span>
      <span class="biz-stream-text">${esc(e.text)}</span>
      <time class="biz-stream-time">${esc(e.t)}</time>
    </div>`).join("");

  $("biz-pref-chip").textContent = `偏好对 ${fmt(state.prefPairs)}`;
  $("biz-rail-pref-n").textContent = `+${state.prefToday}`;
}

/* ── 会员360 ─────────────────────────────────────────── */
function renderMembers() {
  $("biz-member-count").textContent = BIZ_DATA.members.length;
  $("biz-member-list").innerHTML = BIZ_DATA.members.map((m) => `
    <button class="biz-member-item${m.id === state.memberId ? " is-active" : ""}" data-member="${m.id}" type="button" role="option" aria-selected="${m.id === state.memberId}">
      <span class="biz-member-name">${esc(m.name)}<i>${esc(m.gender)} · ${m.age}</i></span>
      <span class="biz-member-meta">${esc(m.stage)}</span>
      <span class="biz-member-delta ${m.delta <= 0 ? "is-good" : "is-bad"}">${m.delta > 0 ? "+" : ""}${m.delta} 岁</span>
    </button>`).join("");

  const m = BIZ_DATA.members.find((x) => x.id === state.memberId) || BIZ_DATA.members[0];
  const stageChips = BIZ_DATA.stages.map((s, i) => `
    <span class="biz-journey-step ${i + 1 === m.stageIdx ? "is-current" : i + 1 < m.stageIdx ? "is-done" : ""}">${esc(s)}</span>
    ${i < BIZ_DATA.stages.length - 1 ? '<span class="biz-journey-sep"></span>' : ""}`).join("");

  $("biz-member-detail").innerHTML = `
    <div class="biz-member-head">
      <div>
        <div class="biz-card-kicker">${esc(m.id)} · ${esc(m.city)} · ${esc(m.plan)}</div>
        <h2 class="biz-member-title">${esc(m.name)}<span class="biz-member-sub">${esc(m.gender)} · ${m.age}岁 · 主诊 ${esc(m.doctor)}</span></h2>
      </div>
      <button class="biz-btn biz-btn-primary" id="biz-open-lab" type="button">查看检测 →</button>
    </div>
    <div class="biz-member-hero-row">
      <div class="biz-bioage">
        <div class="biz-card-kicker">生物年龄</div>
        <div class="biz-bioage-num">${m.bioAge}<i>岁</i></div>
        <div class="biz-bioage-delta ${m.delta <= 0 ? "is-good" : "is-bad"}">${m.delta > 0 ? "+" : ""}${m.delta} vs 实际 ${m.age}岁</div>
      </div>
      <div class="biz-journey">
        <div class="biz-card-kicker">六阶段旅程</div>
        <div class="biz-stages">${stageChips}</div>
        <div class="biz-consent">
          <span class="biz-card-kicker">同意</span>
          ${m.consent.map((c) => `<span class="biz-chip biz-chip-ok">${esc(c)}</span>`).join("")}
          ${m.tags.map((t) => `<span class="biz-chip">${esc(t)}</span>`).join("")}
        </div>
      </div>
    </div>
    <div class="biz-member-grid">
      <div class="biz-kv"><span>手机号</span><b class="mono">${esc(m.phoneMask)}</b></div>
      <div class="biz-kv"><span>最近检测</span><b class="mono">${esc(m.lastLab)}</b></div>
      <div class="biz-kv"><span>忠诚度</span><b class="mono">${Math.round(m.loyalty * 100)}</b></div>
      <div class="biz-kv"><span>方案</span><b>${esc(m.plan)}</b></div>
    </div>
    <div class="biz-member-note">${esc(m.notes)}</div>`;

  $("biz-member-list").querySelectorAll("[data-member]").forEach((el) => {
    el.addEventListener("click", () => {
      state.memberId = el.dataset.member;
      renderMembers();
      renderLab();
    });
  });
  $("biz-open-lab")?.addEventListener("click", () => switchView("lab"));
}

/* ── 检测台 ──────────────────────────────────────────── */
function renderLab() {
  const lab = BIZ_DATA.labs[state.memberId];
  const wrap = $("biz-lab-hero");
  const grid = $("biz-lab-grid");
  if (!lab) {
    wrap.innerHTML = `<div class="biz-empty">该会员尚无结构化检测（${esc(state.memberId)}）。</div>`;
    $("biz-lab-age").innerHTML = "";
    grid.innerHTML = "";
    $("biz-lab-note").innerHTML = "";
    return;
  }
  const h = lab.hero;
  const [lo, hi] = h.range;
  const pos = Math.max(0, Math.min(1, (h.value - lo) / ((hi - lo) || 1)));
  wrap.innerHTML = `
    <div class="biz-lab-hero-main">
      <div class="biz-card-kicker">${esc(lab.panel)} · ${esc(lab.date)} · ${esc(lab.lab)}</div>
      <div class="biz-lab-hero-name">${esc(h.name)}<span class="mono dim">${esc(h.code)}</span></div>
      <div class="biz-lab-hero-value status-${esc(h.status)}">${h.value}<i>${esc(h.unit)}</i></div>
      <div class="biz-lab-range">
        <div class="biz-lab-range-track">
          <span class="biz-lab-range-ok" style="left:${lo === 0 && hi ? 0 : (lo / (hi * 1.4)) * 100}%;width:${hi > 0 ? (hi / (hi * 1.4)) * 100 - (lo > 0 ? (lo / (hi * 1.4)) * 100 : 0) : 100}%"></span>
          <span class="biz-lab-range-mark" style="left:${pos * 100}%"></span>
        </div>
        <div class="biz-lab-range-labels mono"><span>${lo}</span><span>参考 ${lo}–${hi} ${esc(h.unit)}</span><span>${hi}</span></div>
      </div>
    </div>
    <div class="biz-lab-trend">
      <div class="biz-card-kicker">趋势 · 近5次</div>
      <svg viewBox="0 0 160 48" preserveAspectRatio="none" class="biz-spark-lg">
        <path d="${sparkPath(h.trend, 160, 44)}" fill="none" stroke="var(--warm)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="biz-lab-trend-vals mono">${h.trend.map((t) => `<span>${t}</span>`).join("")}</div>
    </div>`;

  $("biz-lab-age").innerHTML = `
    <div class="biz-card-kicker">生物年龄 vs 实际</div>
    <div class="biz-age-bars">
      <div class="biz-age-row"><span>生物</span><span class="biz-age-track"><span class="biz-age-fill is-bio" style="width:${(lab.bioAge / 60) * 100}%"></span></span><b class="mono">${lab.bioAge}</b></div>
      <div class="biz-age-row"><span>实际</span><span class="biz-age-track"><span class="biz-age-fill" style="width:${(lab.chronological / 60) * 100}%"></span></span><b class="mono">${lab.chronological}</b></div>
    </div>`;

  grid.innerHTML = lab.items.map((it) => `
    <div class="biz-lab-item status-${esc(it.status)}">
      <div class="biz-lab-item-name">${esc(it.name)}<i class="mono">${esc(it.code)}</i></div>
      <div class="biz-lab-item-val mono">${it.value}<i>${esc(it.unit)}</i></div>
      <div class="biz-lab-item-range mono">${it.range[0]}–${it.range[1]}</div>
    </div>`).join("");

  $("biz-lab-note").innerHTML = `
    <div class="biz-card-kicker">AI 初稿解读</div>
    <p>${esc(lab.aiNote)}</p>
    <div class="biz-legal">AI 生成 · 需医学顾问审核 · 未审核禁止外发</div>`;
}

/* ── 方案 diff 签发 ─────────────────────────────────── */
function diffSeg(a, b) {
  // 公共前后缀剥离 → 中间为改动段（v1 逐段级，A5 落库换 difflib 逐字）
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return {
    pre: a.slice(0, p),
    oldMid: a.slice(p, a.length - s),
    newMid: b.slice(p, b.length - s),
    post: a.slice(a.length - s),
  };
}

function renderPlan() {
  const plan = BIZ_DATA.plan;
  const signed = state.planStatus === "signed";
  const steps = [
    { key: "draft", label: "AI 初稿" },
    { key: "pending_review", label: "待审阅" },
    { key: "signed", label: "已签发" },
    { key: "active", label: "执行中" },
  ];
  const order = { draft: 0, pending_review: 1, signed: 2, active: 3 };
  const cur = order[state.planStatus];

  $("biz-plan-head").innerHTML = `
    <div class="biz-plan-head-main">
      <div class="biz-card-kicker">${esc(plan.id)} · ${esc(plan.memberId)} · ReviewGate</div>
      <h2 class="biz-plan-title">${esc(plan.title)}</h2>
      <div class="biz-gate-steps">
        ${steps.map((s, i) => `<span class="biz-gate-step ${i < cur ? "is-done" : i === cur ? "is-current" : ""}">${esc(s.label)}</span>`).join('<span class="biz-gate-arrow">→</span>')}
      </div>
    </div>
    <div class="biz-plan-actions">
      <div class="biz-revision-chips">${plan.revisions.map((r) => `<span class="biz-chip biz-chip-diff">${esc(r)}</span>`).join("")}</div>
      <button class="biz-btn biz-btn-sign${signed ? " is-signed" : ""}" id="biz-sign-btn" type="button" ${signed ? "disabled" : ""}>
        ${signed ? "✓ 已签发 · 偏好对已落库" : "签发并落库偏好对"}
      </button>
    </div>`;

  // 单 grid 行对齐（draft | gutter | final 同行等高，换行不错位）
  const n = Math.max(plan.draft.length, plan.final.length);
  const changedIdx = [];
  let rows = `
    <div class="biz-diff-titlecell"><span class="biz-dot biz-dot-ai"></span>AI 初稿 · 灰阶</div>
    <div class="biz-diff-titlecell biz-diff-titlecell-mid">修订</div>
    <div class="biz-diff-titlecell"><span class="biz-dot biz-dot-md"></span>医生终版 · 签发稿</div>`;
  for (let i = 0; i < n; i++) {
    const d = plan.draft[i] ?? "";
    const f = plan.final[i] ?? "";
    const same = d === f;
    const k = same ? -1 : changedIdx.push(i) - 1;
    const seg = same ? null : diffSeg(d, f);
    rows += same
      ? `<div class="biz-diff-line is-same"><span>${esc(d)}</span></div>
         <div class="biz-diff-gutter-cell"></div>
         <div class="biz-diff-line is-same"><span>${esc(f)}</span></div>`
      : `<div class="biz-diff-line is-del"><span>${esc(seg.pre)}<mark class="biz-del">${esc(seg.oldMid)}</mark>${esc(seg.post)}</span></div>
         <div class="biz-diff-gutter-cell"><span class="biz-chip biz-chip-diff">${esc(plan.revisions[k] || "修订")}</span></div>
         <div class="biz-diff-line is-add"><span>${esc(seg.pre)}<mark class="biz-add">${esc(seg.newMid)}</mark>${esc(seg.post)}</span></div>`;
  }
  $("biz-diff-grid").innerHTML = rows;

  $("biz-plan-source").innerHTML = `
    <span class="mono">model ${esc(plan.model)}</span>
    <span class="mono">${fmt(plan.tokens)} tok</span>
    <span class="mono">¥${plan.cost.toFixed(2)}</span>
    <span class="mono">审核人 周慕白</span>
    <span class="mono">${state.signedAt || "待签发"}</span>
    <span class="biz-legal-inline">AI 生成 · 需医学顾问审核</span>`;

  $("biz-sign-btn")?.addEventListener("click", signPlan);
}

function signPlan() {
  if (state.planStatus === "signed") return;
  state.planStatus = "signed";
  state.prefPairs += 1;
  state.prefToday += 1;
  state.plansSigned += 1;
  const now = new Date();
  state.signedAt = now.toISOString().slice(0, 16).replace("T", " ");
  state.feed.unshift({
    t: now.toTimeString().slice(0, 8),
    type: "audit",
    text: `偏好对落库 · ${BIZ_DATA.plan.id} 逐字 diff`,
    risk: "low",
    ok: true,
  });
  renderPlan();
  renderDashboard();
  renderAudit();
  toast(`偏好对 +1 · ${BIZ_DATA.plan.id} 已签发并落库`);
}

/* ── Agent 审计 ─────────────────────────────────────── */
function renderAudit() {
  $("biz-providers").innerHTML = `
    <div class="biz-card-kicker">网关 Provider</div>
    <div class="biz-provider-row">
      ${BIZ_DATA.providers.map((p) => `
        <div class="biz-provider status-${esc(p.status)}">
          <span class="biz-provider-dot"></span>
          <span class="biz-provider-name">${esc(p.name)}</span>
          <span class="biz-provider-lat mono">${p.latency ? `${p.latency}ms` : "—"}</span>
        </div>`).join("")}
      <div class="biz-provider-metrics">
        <span class="mono">LLM ${fmt(BIZ_DATA.metrics.llmCalls)}</span>
        <span class="mono">脱敏命中 ${fmt(BIZ_DATA.metrics.desensitizeHits)}</span>
        <span class="mono">周活医师 ${BIZ_DATA.metrics.weeklyActiveClinicians}</span>
      </div>
    </div>`;
  $("biz-feed").innerHTML = state.feed.map((e) => `
    <div class="biz-feed-row">
      <time class="mono">${esc(e.t)}</time>
      <span class="biz-feed-type type-${esc(e.type)}">${esc(e.type)}</span>
      <span class="biz-feed-text">${esc(e.text)}</span>
      <span class="biz-feed-risk risk-${esc(e.risk || "low")}">${esc(e.risk === "med" ? "中" : "低")}</span>
    </div>`).join("");
}

/* ── 四闸门 ─────────────────────────────────────────── */
function renderGates() {
  const open = BIZ_DATA.gates.filter((g) => g.ok).length;
  $("biz-gates-state").innerHTML = `<b class="mono">${open} / ${BIZ_DATA.gates.length}</b> 放行 · 未放行前训练与导出关闭`;
  $("biz-gates-grid").innerHTML = BIZ_DATA.gates.map((g) => `
    <div class="biz-card biz-gate ${g.ok ? "is-open" : "is-locked"}">
      <div class="biz-gate-icon">${g.ok ? "○" : "●"}</div>
      <div class="biz-gate-name">${esc(g.name)}</div>
      <div class="biz-gate-note mono">${esc(g.note)}</div>
      <div class="biz-gate-state">${g.ok ? "放行" : "锁定"}</div>
    </div>`).join("");
}

/* ── 驾驶舱（唯一接真实数据的视图） ─────────────────── */
// 数据源：GET /rm/cockpit → RM-Bridge → 睿美云。
// 失败/未配置一律降级到 COCKPIT_SEED，并在 UI 上明示「非实时」——不假装有数据。
const cockpit = {
  data: COCKPIT_SEED,
  loading: false,
  loaded: false,
  note: null,
};

async function loadCockpit({ refresh = false } = {}) {
  if (cockpit.loading) return;
  cockpit.loading = true;
  renderCockpit();
  try {
    const res = await fetch(`/rm/cockpit${refresh ? "?refresh=1" : ""}`);
    const json = await res.json();
    if (json.ok) {
      cockpit.data = json;
      cockpit.note = json.partial ? `${json.meta?.errorCount ?? 0} 项指标未取到` : null;
    } else {
      cockpit.data = COCKPIT_SEED;
      cockpit.note = json.reason === "not_configured"
        ? "睿美云未配置凭据，显示占位数据"
        : (json.error || "拉取失败，显示占位数据");
    }
  } catch (err) {
    cockpit.data = COCKPIT_SEED;
    cockpit.note = `拉取失败：${err.message}`;
  } finally {
    // loaded 一律置位：失败也视为「已尝试」，否则后端挂掉时每次切 tab 都会重新打一枪
    cockpit.loaded = true;
    cockpit.loading = false;
    renderCockpit();
  }
}

function barRows(rows, unit = "人") {
  if (!rows?.length) return `<div class="biz-empty">暂无数据</div>`;
  const max = Math.max(...rows.map((r) => Number(r.customers) || 0)) || 1;
  return rows.map((r) => `
    <div class="biz-funnel-row">
      <span class="biz-funnel-label">${esc(r.name)}</span>
      <span class="biz-funnel-track"><span class="biz-funnel-bar" style="width:${((Number(r.customers) || 0) / max) * 100}%"></span></span>
      <span class="biz-funnel-val">${fmt(Number(r.customers) || 0)}<i>${unit}</i></span>
    </div>`).join("");
}

function renderCockpit() {
  const d = cockpit.data || COCKPIT_SEED;
  const k = d.kpi || {};
  const src = d.meta?.source;
  const live = src === "ruimeiyun";
  // 三态，不混淆：实时 / 部分取到 / 完全取不到 / 未配置占位
  const chipText = live
    ? (d.meta?.partial ? `睿美云 · 部分指标（${d.meta.errorCount} 项失败）` : "睿美云 · 实时")
    : src === "unavailable" ? "睿美云 · 取数失败"
    : "占位数据 · 非实时";
  const pctText = (v) => (v == null ? "—" : `${v}%`);

  $("biz-cockpit-source").innerHTML = `
    <div class="biz-card-kicker">数据源</div>
    <div class="biz-cockpit-src-row">
      <span class="biz-chip ${live ? "biz-chip-ok" : ""}">${esc(chipText)}</span>
      <span class="biz-chip biz-chip-mono">角色 ${esc(d.meta?.role || "—")}</span>
      <span class="biz-chip biz-chip-mono">年度 ${esc(d.meta?.year || "—")}</span>
      ${d.meta?.fetchedAt ? `<span class="biz-chip biz-chip-mono">拉取 ${esc(String(d.meta.fetchedAt).slice(11, 19))}</span>` : ""}
      <button class="biz-btn" id="biz-cockpit-refresh" type="button" ${cockpit.loading ? "disabled" : ""}>${cockpit.loading ? "拉取中…" : "刷新"}</button>
    </div>
    ${cockpit.note ? `<div class="biz-cockpit-note">${esc(cockpit.note)}</div>` : ""}`;

  // foot 一律标出睿美云来源字段名。
  // 原因：三个「率」的字段映射来自侦察文档的返回样例，而样例里 getCustomerActiveRate
  // 返回的是 waistRate（腰率），与接口名对不上 —— 未经真实数据校验前不假装确定。
  // 接入真库后若发现错配，foot 上的字段名能一眼看出来。
  const cards = [
    { kicker: "客户总量", value: fmt(k.totalCustomers || 0), foot: `totalCustomers · 个人池 ${fmt(k.personalPoolCount || 0)}` },
    { kicker: "今日待办", value: fmt(k.todoMessages || 0), foot: `msgNum · 待办任务 ${fmt(k.todoTasks || 0)}` },
    { kicker: "客户活跃率", value: pctText(k.activeRate), foot: "睿美云字段 · customerRate" },
    { kicker: "客户复购率", value: pctText(k.repurchaseRate), foot: k.repurchaseSuspect ? "两接口返回全等 · 疑似占位未采信" : "睿美云字段 · repurchaseRate" },
    { kicker: "消费腰率", value: pctText(k.waistRate), foot: "睿美云字段 · waistRate" },
  ];
  $("biz-cockpit-kpi").innerHTML = cards.map((c) => `
    <div class="biz-card biz-card-metric">
      <div class="biz-card-kicker">${esc(c.kicker)}</div>
      <div class="biz-metric-num">${esc(c.value)}</div>
      <div class="biz-card-foot">${esc(c.foot)}</div>
    </div>`).join("");

  // 注：原「渠道分布·客户数」已移除 —— 真库核对发现 getAllChannel 只返回渠道字典，
  // 不含客户数，那个图是错的（见 bridge/cockpit.js 注释）。
  $("biz-cockpit-pools").innerHTML = barRows(d.pools);

  const cons = d.consumption;
  $("biz-cockpit-consumption").innerHTML = cons
    ? `<div class="biz-kv"><span>人均消费</span><b class="mono">¥${fmt(cons.average)}</b></div>
       <div class="biz-kv"><span>消费总额</span><b class="mono">¥${fmt(cons.customerAmount)}</b></div>
       <div class="biz-kv"><span>超均值客户</span><b class="mono">${fmt(cons.overAvgCusNum)}</b></div>`
    : `<div class="biz-empty">暂无数据</div>`;

  const errs = d.errors || [];
  const errEl = $("biz-cockpit-errors");
  if (errs.length) {
    errEl.hidden = false;
    errEl.innerHTML = `<div class="biz-card-kicker">未取到的指标</div>` +
      errs.map((e) => `<div class="biz-feed-row"><span class="biz-feed-type type-error">${esc(e.metric)}</span><span class="biz-feed-text">${esc(e.error || "")}</span></div>`).join("");
  } else {
    errEl.hidden = true;
    errEl.innerHTML = "";
  }

  $("biz-cockpit-refresh")?.addEventListener("click", () => loadCockpit({ refresh: true }));
}

/* ── 视图切换 / 开合 ───────────────────────────────── */
function switchView(view) {
  if (!VIEW_META[view]) return;
  state.view = view;
  document.querySelectorAll(".biz-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
  document.querySelectorAll(".biz-view").forEach((v) => v.classList.toggle("is-active", v.dataset.view === view));
  $("biz-view-kicker").textContent = VIEW_META[view].kicker;
  $("biz-view-title").textContent = VIEW_META[view].title;
  // 驾驶舱首次进入才拉数据：冷启动要打 ~7 个睿美云接口（受 1.5s 限流串行，约 10s），
  // 不能拖慢面板开合。先渲种子，数据到了再重渲。
  if (view === "cockpit" && !cockpit.loaded && !cockpit.loading) loadCockpit();
}

let toastTimer = null;
function toast(msg) {
  const el = $("biz-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 3200);
}

export function setBizPanelMode(visible, { view } = {}) {
  state.active = Boolean(visible);
  const panel = $("biz-panel");
  document.body.classList.toggle("biz-panel-mode", state.active);
  panel?.setAttribute("aria-hidden", String(!state.active));
  if (state.active) {
    if (view && VIEW_META[view]) switchView(view);
    renderDashboard();
    renderMembers();
    renderLab();
    renderPlan();
    renderAudit();
    renderGates();
    renderCockpit();
  }
}

export function initBizPanel() {
  $("biz-close")?.addEventListener("click", () => setBizPanelMode(false));
  $("biz-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".biz-tab");
    if (tab) switchView(tab.dataset.view);
  });
  $("biz-btn")?.addEventListener("click", () => setBizPanelMode(!state.active));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.active) setBizPanelMode(false);
  });
}
