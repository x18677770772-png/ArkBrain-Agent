/**
 * 睿美云 · 驾驶舱数据聚合
 * ============================================================
 * 把分散在多个睿美云接口的指标聚合成前端可直接消费的一棵树。
 *
 * 设计原则：
 *   1. 单个指标失败不拖垮整页 —— 全部走 tryCall，失败记入 errors[] 并在 meta.partial 标记。
 *      睿美云的权限裁剪是静默的（无权限常返回空数组而非 403），所以「取不到」是常态而非异常。
 *   2. 报表接口必须传 year，且限流严格（限流伪装成 401）—— 由 client.call 统一退避。
 *   3. 字段名做多路兜底 —— 侦察文档给出的是实测样例，但不同租户/版本可能有出入。
 *   4. 输出形状稳定 —— 前端不感知睿美云原始字段名，只认这里定义的契约。
 */

import { tryCall, num, norm } from './ruimeiyun-client.js'

/** 从候选字段名里取第一个有值的（睿美云不同接口命名不统一）。 */
export function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj == null) return undefined
    const v = norm(obj[k])
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

/** 百分比字符串 "10.00%" / 10.0 / "10" 统一成数字。 */
export function pct(v) {
  if (v == null) return null
  const s = String(norm(v))
  const n = parseFloat(s.replace('%', ''))
  return Number.isFinite(n) ? n : null
}

/**
 * 拉取驾驶舱全量数据。
 * @param {string} role 角色名（默认 admin）
 * @param {{year?:string|number}} opts
 * @returns {Promise<object>} 稳定的驾驶舱契约
 */
/**
 * 复购/活跃两接口是否返回全等载荷 —— 全等即疑似占位（真库 2026-09-29/10-07 两次实测全等）。
 * 两租户业务上不可能五个字段逐一相同（含 customerNum 集合计数），全等时不采信复购值。
 */
export function sameRatePayload(a, b) {
  if (!a || !b) return false
  const keys = ['cardNums', 'customerNum', 'customerRate', 'frequencyNums', 'memberRate']
  return keys.every(k => String(a[k] ?? 'null') === String(b[k] ?? 'null'))
}

export async function fetchCockpit(role = 'admin', { year } = {}) {
  const yr = String(year || new Date().getFullYear())
  const errors = []
  let metricCount = 0
  const note = (label, r) => {
    metricCount++  // 实际发出的指标数，供 allFailed 推导，避免手工常量漏更
    if (r && r.ok === false) errors.push({ metric: label, code: r.code, error: r.error })
    return r && r.ok ? r.data : null
  }

  // ---- 基础计数（GET，轻量）----
  // 已移除 getAllChannel：真库核对（2026-09-29）确认它只返回渠道字典 {label,type,value}，
  // 不含客户数 —— 拿它画「渠道分布·客户数」是错的。
  const [customerTotal, poolsRaw, todayTotal] = await Promise.all([
    tryCall(role, '/v1/channel/getCustomerNumber').then(r => note('customerNumber', r)),
    tryCall(role, '/v1/customerPool/customerPools').then(r => note('customerPools', r)),
    tryCall(role, '/v1/msg/todayTotal').then(r => note('todayTotal', r)),
  ])

  // ---- 报表族（POST + year，严格限流；串行避免触发限流）----
  const activeRateRaw = note('activeRate',
    await tryCall(role, '/report/v1/wym/celebrateCustomer/getCustomerActiveRate', { method: 'POST', body: { year: yr } }))
  const repurchaseRaw = note('repurchaseRate',
    await tryCall(role, '/report/v1/wym/celebrateCustomer/getCustomerRepurchaseRate', { method: 'POST', body: { year: yr } }))
  const waistRaw = note('waistRate',
    await tryCall(role, '/report/v1/wym/celebrateCustomer/getCustomerWaistRate', { method: 'POST', body: { year: yr } }))

  // ---- 组装稳定契约（字段名以 2026-09-29 真库核对为准，勿照侦察文档猜）----
  const tt = todayTotal || {}

  // 客户总数：真库返回**裸数字** 3428，不是 {totalCustomers:...}
  const totalCustomers = typeof customerTotal === 'number'
    ? customerTotal
    : num(pick(customerTotal || {}, 'totalCustomers', 'total', 'customerNum'), 0)

  // 客户池：真库形状 {customerPoolVoList:[{name, currentCount, type, specialType}]}
  // type=1 个人池 / type=2 非个人池（真库实测：客服部新客池 type=1；默认非个人池 type=2）
  const poolList = Array.isArray(poolsRaw?.customerPoolVoList) ? poolsRaw.customerPoolVoList : []
  const pools = poolList.map(p => ({
    name: pick(p, 'name', 'poolName') ?? '未命名池',
    type: num(p.type, 0),
    kind: pick(p, 'specialType') ?? '',
    customers: num(pick(p, 'currentCount', 'customerNum', 'count'), 0),
  })).sort((a, b) => b.customers - a.customers)
  const personalPoolCount = pools.filter(p => p.type === 1).reduce((s, p) => s + p.customers, 0)
  const nonPersonalPoolCount = pools.filter(p => p.type === 2).reduce((s, p) => s + p.customers, 0)

  // 全部指标都失败时不得谎称「实时」—— 否则前端会拿一串 0 冒充真实数据。
  const allFailed = metricCount > 0 && errors.length >= metricCount

  // ⚠️ 真库实测（2026-09-29 首测、2026-10-07 复验）：getCustomerRepurchaseRate 与
  // getCustomerActiveRate 返回**完全相同**的结构与数值。疑似接口占位 —— 全等时
  // 不采信复购值（置 null → 前端显示「—」+ 占位标注），两者不再全等时自动恢复展示。
  const repurchaseSuspect = sameRatePayload(repurchaseRaw, activeRateRaw)

  return {
    meta: {
      source: allFailed ? 'unavailable' : 'ruimeiyun',
      role,
      year: yr,
      fetchedAt: new Date().toISOString(),
      partial: errors.length > 0,
      errorCount: errors.length,
    },
    kpi: {
      totalCustomers,
      personalPoolCount,
      nonPersonalPoolCount,
      todoMessages: num(pick(tt, 'msgNum', 'messageNum'), 0),
      todoTasks: num(pick(tt, 'tskNum', 'taskNum'), 0),
      // 真库实测：率字段叫 customerRate（侦察文档说的 waistRate 是错的）—— 2026-09-29 核对
      activeRate: pct(pick(activeRateRaw || {}, 'customerRate', 'activeRate', 'rate')),
      activeCustomerNum: num(pick(activeRateRaw || {}, 'customerNum'), 0),
      repurchaseRate: repurchaseSuspect ? null : pct(pick(repurchaseRaw || {}, 'customerRate', 'repurchaseRate', 'rate')),
      repurchaseSuspect,
      waistRate: pct(pick(waistRaw || {}, 'waistRate', 'rate')),
    },
    pools,
    // 消费概况（随腰率接口一并返回，真库实测：average/customerAmount/overAvgCusNum）
    consumption: waistRaw ? {
      average: num(pick(waistRaw, 'average'), 0),
      customerAmount: num(pick(waistRaw, 'customerAmount'), 0),
      overAvgCusNum: num(pick(waistRaw, 'overAvgCusNum'), 0),
    } : null,
    errors,
  }
}

/**
 * 健康探针：只打最轻的一个接口，用于接入后第一步验证租户连通性。
 * 侦察文档建议：优先用 /v1/channel/getCustomerNumber 确认连通。
 */
export async function probe(role = 'admin') {
  const t0 = Date.now()
  const r = await tryCall(role, '/v1/channel/getCustomerNumber')
  return {
    ok: r.ok === true,
    role,
    ms: Date.now() - t0,
    code: r.code ?? null,
    error: r.error ?? null,
    sample: r.ok ? { totalCustomers: num(pick(r.data || {}, 'totalCustomers', 'customerNum', 'total'), 0) } : null,
  }
}
