/**
 * 驾驶舱 · 种子降级数据（借假修真）
 * ============================================================
 * 契约必须与 /rm/cockpit 的返回**逐字段一致**（见 bridge/cockpit.js 的 fetchCockpit）。
 * 用途：睿美云未配置 / 调用失败 / 离线时，驾驶舱仍有内容可渲染，并在 UI 上明示「非实时」。
 *
 * 非真实患者数据，仅用于界面占位。
 */
export const COCKPIT_SEED = {
  meta: {
    source: "seed",
    role: "—",
    year: String(new Date().getFullYear()),
    fetchedAt: null,
    partial: false,
    errorCount: 0,
  },
  kpi: {
    totalCustomers: 3428,
    personalPoolCount: 2321,
    nonPersonalPoolCount: 1143,
    todoMessages: 20,
    todoTasks: 0,
    activeRate: 0.0,
    activeCustomerNum: 18,
    repurchaseRate: 0.0,
    repurchaseSuspect: false,
    waistRate: 5.56,
  },
  // 形状对齐真库：{name, type(1=个人池/2=非个人池), kind(specialType), customers(currentCount)}
  pools: [
    { name: "客服部新客池", type: 1, kind: "defaultPersonal", customers: 2321 },
    { name: "默认非个人池", type: 2, kind: "defaultNonePersonal", customers: 1111 },
    { name: "中康奇经诊所", type: 2, kind: "common", customers: 18 },
    { name: "报备池", type: 2, kind: "preparation", customers: 14 },
    { name: "黑名单客户池", type: 2, kind: "black_list_pool", customers: 0 },
  ],
  consumption: { average: 1164.22, customerAmount: 20956, overAvgCusNum: 1 },
  errors: [],
};
