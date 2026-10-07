// RM-Bridge 纯函数测试：字段规范化 / 百分比 / 取值兜底 / 复购占位判定 / 路径守卫 / 种子契约。
// 不动数据库、不动网络 —— 只测可离线验证的纯逻辑（login/限流/驾驶舱聚合走 mock 全链路验收）。
//
// Run: node src/test-bridge-ruimeiyun.js
import { norm, num, maskPII } from '../bridge/ruimeiyun-client.js'
import { pick, pct, sameRatePayload } from '../bridge/cockpit.js'
import { isAllowedProxyPath } from './api/routes/ruimeiyun.js'
import { COCKPIT_SEED } from './ui/brain-ui/cockpit-data.js'

let failed = 0
function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ------------------------------------------------------------ norm / num（真库踩坑：字段被字符串化）
assert(norm('null') === null, 'norm: "null" 字符串还原为 null')
assert(eq(norm('[]'), []), 'norm: "[]" 字符串还原为 []')
assert(eq(norm('{}'), {}), 'norm: "{}" 字符串还原为 {}')
assert(norm('true') === true, 'norm: "true" 还原为布尔')
assert(eq(norm('{"a":1}'), { a: 1 }), 'norm: JSON 字符串解析为对象')
assert(norm('986') === '986', 'norm: 普通数字字符串原样保留')
assert(num('986') === 986, 'num: "986" → 986')
assert(num('null') === 0, 'num: "null" → 0')
assert(num('abc', 7) === 7, 'num: 非法值走 fallback')
assert(Number.isNaN(num('abc')) === false, 'num: 永不返回 NaN')

// ------------------------------------------------------------ pick（多路兜底取值）
assert(pick({ customerRate: '10.00%' }, 'customerRate', 'rate') === '10.00%', 'pick: 命中首个候选')
assert(pick({ activeRate: 5 }, 'customerRate', 'activeRate', 'rate') === 5, 'pick: 首选缺失时落到次选')
assert(pick({ a: 'null' }, 'a', 'b') === undefined, 'pick: "null" 字符串经 norm 后跳过')
assert(pick({ a: null, b: 3 }, 'a', 'b') === 3, 'pick: null 值跳过取下一个')
assert(pick({ a: '', b: 3 }, 'a', 'b') === 3, 'pick: 空串跳过取下一个')
assert(pick({}, 'x', 'y') === undefined, 'pick: 全缺失返回 undefined')

// ------------------------------------------------------------ pct（百分比统一）
assert(pct('10.00%') === 10, 'pct: "10.00%" → 10')
assert(pct(10.0) === 10, 'pct: 数字 10.0 → 10')
assert(pct('5.56%') === 5.56, 'pct: "5.56%" → 5.56')
assert(pct(null) === null, 'pct: null → null（前端显示 —）')
assert(pct('abc') === null, 'pct: 非法串 → null')

// ------------------------------------------------------------ sameRatePayload（复购占位判定）
const rateA = { cardNums: 0, customerNum: 18, customerRate: '0.00%', frequencyNums: 0, memberRate: '0.00%' }
const rateB = { cardNums: 0, customerNum: 18, customerRate: '0.00%', frequencyNums: 0, memberRate: '0.00%' }
const rateC = { cardNums: 2, customerNum: 25, customerRate: '12.00%', frequencyNums: 1, memberRate: '3.00%' }
assert(sameRatePayload(rateA, rateB) === true, 'sameRatePayload: 五字段全等 → 占位疑似')
assert(sameRatePayload(rateA, rateC) === false, 'sameRatePayload: 数值不同 → 非占位')
assert(sameRatePayload(null, rateA) === false, 'sameRatePayload: 单侧缺失 → false（接口失败不误判）')
assert(sameRatePayload(rateA, null) === false, 'sameRatePayload: 另一侧缺失 → false')
assert(sameRatePayload(undefined, undefined) === false, 'sameRatePayload: 双侧缺失 → false')

// ------------------------------------------------------------ maskPII（审计日志脱敏）
assert(!/\b1[3-9]\d{9}\b/.test(maskPII('联系 13812345678 吧')), 'maskPII: 手机号被打码')
assert(maskPII('eyJhbGciOiJIUzI1NiJ9.abcdefghij.klmnopqrst').includes('<JWT>'), 'maskPII: JWT 被替换')
assert(maskPII('证件 110101199001011234').includes('<ID_CARD>'), 'maskPII: 身份证被替换')

// ------------------------------------------------------------ 路径守卫（/rm/call SSRF 纵深防御）
assert(isAllowedProxyPath('/v1/channel/getCustomerNumber') === true, 'guard: 放行 /v1/…')
assert(isAllowedProxyPath('/v2/foo/bar') === true, 'guard: 放行 /v2/…')
assert(isAllowedProxyPath('/report/v1/wym/celebrateCustomer/getCustomerActiveRate') === true, 'guard: 放行 /report/…')
assert(isAllowedProxyPath('/v3/anything') === false, 'guard: 拒绝 /v3/（v1|v2 白名单）')
assert(isAllowedProxyPath('/api/v1/x') === false, 'guard: 拒绝 /api 前缀（由 client 统一补）')
assert(isAllowedProxyPath('//evil.com/x') === false, 'guard: 拒绝 // 协议相对 URL')
assert(isAllowedProxyPath('/v1/../../etc/passwd') === false, 'guard: 拒绝 .. 穿越')
assert(isAllowedProxyPath('/admin/deleteAll') === false, 'guard: 拒绝未知前缀')
assert(isAllowedProxyPath(123) === false, 'guard: 拒绝非字符串')

// ------------------------------------------------------------ 种子契约（M1：与 fetchCockpit 逐字段对齐）
const KPI_KEYS = [
  'totalCustomers', 'personalPoolCount', 'nonPersonalPoolCount',
  'todoMessages', 'todoTasks', 'activeRate', 'activeCustomerNum',
  'repurchaseRate', 'repurchaseSuspect', 'waistRate',
]
const missing = KPI_KEYS.filter(k => !(k in COCKPIT_SEED.kpi))
assert(missing.length === 0, `种子契约: kpi 含全部契约字段（缺: ${missing.join(',') || '无'}）`)
const META_KEYS = ['source', 'role', 'year', 'fetchedAt', 'partial', 'errorCount']
const metaMissing = META_KEYS.filter(k => !(k in COCKPIT_SEED.meta))
assert(metaMissing.length === 0, `种子契约: meta 含全部契约字段（缺: ${metaMissing.join(',') || '无'}）`)
assert(Array.isArray(COCKPIT_SEED.pools) && COCKPIT_SEED.pools.every(p =>
  'name' in p && 'type' in p && 'kind' in p && 'customers' in p), '种子契约: pools 逐项四字段')
const CONSUMPTION_KEYS = ['average', 'customerAmount', 'overAvgCusNum']
assert(CONSUMPTION_KEYS.every(k => k in COCKPIT_SEED.consumption), '种子契约: consumption 三字段')
assert(COCKPIT_SEED.meta.source === 'seed', '种子契约: source=seed（UI 须显示非实时）')

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
