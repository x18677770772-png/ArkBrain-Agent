/**
 * 方舟业务台 · 面板模板（brain-ui 五件套之一）
 * 单面板 7 tab：看板 / 会员 / 检测 / 方案 / 审计 / 闸门 / 驾驶舱。
 * 结构见 docs/ui-audit-baseline.md；数据由 biz.js 从 biz-data.js 渲染。
 * 驾驶舱（07）是唯一接真实数据的视图：经 /rm/cockpit 拉睿美云，失败降级 cockpit-data.js。
 */
export const createBizPanel = () => `
<section id="biz-panel" class="biz-panel" aria-hidden="true" aria-label="方舟业务台">
  <nav class="biz-rail" aria-label="业务台导航">
    <div class="biz-brand">
      <div class="biz-kicker"><span class="biz-kicker-dot"></span>ARKBRAIN CONSOLE</div>
      <div class="biz-brand-title">方舟业务台</div>
    </div>
    <div class="biz-tabs" role="tablist" id="biz-tabs">
      <button class="biz-tab is-active" role="tab" data-view="dashboard" type="button">
        <span class="biz-tab-glyph">01</span><span class="biz-tab-label">看板</span>
        <span class="biz-tab-name">飞轮总览</span>
      </button>
      <button class="biz-tab" role="tab" data-view="members" type="button">
        <span class="biz-tab-glyph">02</span><span class="biz-tab-label">会员</span>
        <span class="biz-tab-name">会员 360</span>
      </button>
      <button class="biz-tab" role="tab" data-view="lab" type="button">
        <span class="biz-tab-glyph">03</span><span class="biz-tab-label">检测</span>
        <span class="biz-tab-name">检测台</span>
      </button>
      <button class="biz-tab" role="tab" data-view="plan" type="button">
        <span class="biz-tab-glyph">04</span><span class="biz-tab-label">方案</span>
        <span class="biz-tab-name">diff 审阅台</span>
      </button>
      <button class="biz-tab" role="tab" data-view="audit" type="button">
        <span class="biz-tab-glyph">05</span><span class="biz-tab-label">审计</span>
        <span class="biz-tab-name">Agent 审计流</span>
      </button>
      <button class="biz-tab" role="tab" data-view="gates" type="button">
        <span class="biz-tab-glyph">06</span><span class="biz-tab-label">闸门</span>
        <span class="biz-tab-name">模型四闸门</span>
      </button>
      <button class="biz-tab" role="tab" data-view="cockpit" type="button">
        <span class="biz-tab-glyph">07</span><span class="biz-tab-label">驾驶舱</span>
        <span class="biz-tab-name">睿美云经营总览</span>
      </button>
      <div class="biz-rail-foot">
        <div class="biz-pref-line" id="biz-rail-pref" title="今日新增偏好对">今日偏好对 <b id="biz-rail-pref-n">+36</b></div>
        <div class="biz-demo-chip">DEMO · 假数据</div>
      </div>
    </div>
  </nav>

  <div class="biz-main">
    <header class="biz-topbar">
      <div class="biz-topbar-head">
        <div class="biz-topbar-kicker" id="biz-view-kicker">01 · FLYWHEEL</div>
        <h1 class="biz-topbar-title" id="biz-view-title">看板</h1>
      </div>
      <div class="biz-topbar-meta">
        <span class="biz-chip" id="biz-site-chip">生命方舟 · 金融城旗舰店</span>
        <span class="biz-chip biz-chip-mono" id="biz-pref-chip">偏好对 12,847</span>
        <button class="biz-close" id="biz-close" type="button" title="关闭业务台" aria-label="关闭业务台">×</button>
      </div>
    </header>

    <div class="biz-stage" id="biz-stage">
      <!-- 01 看板 -->
      <section class="biz-view is-active" data-view="dashboard" aria-label="看板">
        <div class="biz-bento">
          <div class="biz-card biz-card-hero">
            <div class="biz-card-kicker">PREFERENCE PAIRS · 偏好对累积</div>
            <div class="biz-hero-metric" id="biz-hero-pref">12,847</div>
            <div class="biz-hero-sub">
              <span class="biz-delta-up" id="biz-hero-today">今日 +36</span>
              <span class="biz-chip" id="biz-dash-source">种子数据</span>
              <svg class="biz-spark" id="biz-spark" viewBox="0 0 140 36" preserveAspectRatio="none" aria-hidden="true"></svg>
            </div>
            <div class="biz-card-foot">垂直模型原料 · 不可回溯 · 竞对无法事后补齐</div>
          </div>
          <div class="biz-card biz-card-metric">
            <div class="biz-card-kicker">轨迹覆盖</div>
            <div class="biz-metric-num" id="biz-m-coverage">97.2%</div>
            <div class="biz-card-foot">五层轨迹 · 硬验收 100%</div>
          </div>
          <div class="biz-card biz-card-metric">
            <div class="biz-card-kicker">方案已签</div>
            <div class="biz-metric-num" id="biz-m-signed">89</div>
            <div class="biz-card-foot">医生签字 · 全程留痕</div>
          </div>
          <div class="biz-card biz-card-metric">
            <div class="biz-card-kicker">AI 网关调用</div>
            <div class="biz-metric-num" id="biz-m-llm">8,421</div>
            <div class="biz-card-foot">脱敏命中 216 · 审计 100%</div>
          </div>
          <div class="biz-card biz-card-funnel">
            <div class="biz-card-kicker">五层轨迹漏斗</div>
            <div class="biz-funnel" id="biz-funnel"></div>
          </div>
          <div class="biz-card biz-card-stream">
            <div class="biz-card-kicker">AGENT 最近活动</div>
            <div class="biz-stream" id="biz-dash-stream"></div>
          </div>
        </div>
      </section>

      <!-- 02 会员360 -->
      <section class="biz-view" data-view="members" aria-label="会员360">
        <div class="biz-members">
          <aside class="biz-card biz-member-list-wrap">
            <div class="biz-card-kicker">会员 · <span id="biz-member-count">5</span></div>
            <div class="biz-member-list" id="biz-member-list" role="listbox"></div>
          </aside>
          <div class="biz-card biz-member-detail" id="biz-member-detail"></div>
        </div>
      </section>

      <!-- 03 检测台 -->
      <section class="biz-view" data-view="lab" aria-label="检测台">
        <div class="biz-lab">
          <div class="biz-card biz-lab-entry-card">
            <div class="biz-lab-entry-head">
              <div class="biz-card-kicker">手工录入 · 简版（落 PG lab_results，status 服务端重算）</div>
              <button class="biz-btn" id="biz-lab-entry-toggle" type="button" aria-expanded="false" aria-controls="biz-lab-entry">＋ 录入</button>
            </div>
            <div class="biz-lab-form" id="biz-lab-entry" hidden>
              <input class="biz-input" id="biz-lf-name" type="text" placeholder="项目名 *" aria-label="项目名" maxlength="40">
              <input class="biz-input biz-input-mono" id="biz-lf-code" type="text" placeholder="代码" aria-label="代码" maxlength="16">
              <input class="biz-input biz-input-mono" id="biz-lf-value" type="number" step="any" placeholder="数值 *" aria-label="数值">
              <input class="biz-input" id="biz-lf-unit" type="text" placeholder="单位" aria-label="单位" maxlength="12">
              <input class="biz-input biz-input-mono" id="biz-lf-lo" type="number" step="any" placeholder="下限 *" aria-label="下限">
              <input class="biz-input biz-input-mono" id="biz-lf-hi" type="number" step="any" placeholder="上限 *" aria-label="上限">
              <button class="biz-btn biz-btn-primary" id="biz-lf-add" type="button">加入并落库</button>
            </div>
          </div>
          <div class="biz-card biz-lab-hero" id="biz-lab-hero"></div>
          <div class="biz-card biz-lab-age" id="biz-lab-age"></div>
          <div class="biz-card biz-lab-grid-wrap">
            <div class="biz-card-kicker">检测项 · 参考区间三态</div>
            <div class="biz-lab-grid" id="biz-lab-grid"></div>
          </div>
          <div class="biz-card biz-lab-note" id="biz-lab-note"></div>
        </div>
      </section>

      <!-- 04 方案 diff 签发 -->
      <section class="biz-view" data-view="plan" aria-label="方案审阅台">
        <div class="biz-plan">
          <div class="biz-card biz-plan-head" id="biz-plan-head"></div>
          <div class="biz-card biz-plan-diff">
            <div class="biz-diff-grid" id="biz-diff-grid"></div>
            <footer class="biz-source-strip" id="biz-plan-source"></footer>
          </div>
        </div>
      </section>

      <!-- 05 Agent 审计 -->
      <section class="biz-view" data-view="audit" aria-label="Agent审计">
        <div class="biz-audit">
          <div class="biz-card biz-providers" id="biz-providers"></div>
          <div class="biz-card biz-feed-wrap">
            <div class="biz-card-kicker">审计事件流 · 脱敏 / 工具 / 合同 / 埋点</div>
            <div class="biz-feed" id="biz-feed"></div>
          </div>
        </div>
      </section>

      <!-- 06 模型闸门 -->
      <section class="biz-view" data-view="gates" aria-label="模型闸门">
        <div class="biz-gates">
          <div class="biz-gates-intro biz-card">
            <div class="biz-card-kicker">四闸门 · 先产轨迹不训模型</div>
            <p>闸门未全部放行前，模型训练与权重导出保持关闭；MVP 只做埋点与人工闭环。
               当前允许：轨迹采集 · 方案审阅 · 人工签发。</p>
            <div class="biz-gates-state" id="biz-gates-state"></div>
          </div>
          <div class="biz-gates-grid" id="biz-gates-grid"></div>
        </div>
      </section>

      <!-- 07 驾驶舱（睿美云真实数据） -->
      <section class="biz-view" data-view="cockpit" aria-label="驾驶舱">
        <div class="biz-cockpit">
          <div class="biz-card biz-cockpit-source" id="biz-cockpit-source"></div>
          <div class="biz-cockpit-kpi" id="biz-cockpit-kpi"></div>
          <div class="biz-cockpit-split">
            <div class="biz-card">
              <div class="biz-card-kicker">客户池分布 · 当前客户数</div>
              <div class="biz-funnel" id="biz-cockpit-pools"></div>
            </div>
            <div class="biz-card">
              <div class="biz-card-kicker">消费概况</div>
              <div class="biz-cockpit-consumption" id="biz-cockpit-consumption"></div>
            </div>
          </div>
          <div class="biz-card biz-cockpit-errors" id="biz-cockpit-errors" hidden></div>
        </div>
      </section>
    </div>
  </div>

  <div class="biz-toast" id="biz-toast" role="status" aria-live="polite"></div>
</section>
`;
