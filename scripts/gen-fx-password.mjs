#!/usr/bin/env node
// 机器人音效 付费解锁密码生成器（作者专用，请勿随 App 分发）
//
// 用法：
//   node scripts/gen-fx-password.mjs           # 生成一个当前时间的密码
//   node scripts/gen-fx-password.mjs 5         # 一次生成 5 个
//
// 密码＝20 位数字，格式：秒RR 分RR 时RR 日RR 月RR
//   （UTC 的秒/分/时/日/月 各 2 位，每个后面紧跟 2 位 RR 校验位）。
// RR 不是随机数：按 fxRR 规则由时间分量确定性推导，与校验端一致。
// 用户拿到后 1 小时内填入设置页即可永久解锁该设备。
// 编码规则必须与 src/ui/brain-ui/tts-fx.js 的 fxExpectedRR / 校验逻辑保持一致。

const FX_RR_SEED = 7 // 与 tts-fx.js 一致（客户端混淆值，非保密密钥）

const pad2 = (n) => String(n).padStart(2, '0')

// 与 tts-fx.js fxExpectedRR 同算法：由时间分量推导第 i 段（0-based）的 RR
function fxRR(ss, mi, hh, dd, MM, i) {
  const v = (ss * 3 + mi * 5 + hh * 7 + dd * 11 + MM * 13 + (i + 1) * FX_RR_SEED) % 100
  return pad2(v)
}

function encodeFxPassword(date = new Date()) {
  const parts = [
    date.getUTCSeconds(),
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
  ]
  const [ss, mi, hh, dd, MM] = parts
  return parts.map((v, i) => pad2(v) + fxRR(ss, mi, hh, dd, MM, i)).join('') // 秒RR分RR时RR日RR月RR，20 位
}

const count = Math.max(1, parseInt(process.argv[2], 10) || 1)
const now = new Date()
console.log(`当前时间(本地): ${now.toLocaleString()}`)
console.log(`有效期: 生成后 1 小时内填入有效\n`)
for (let i = 0; i < count; i++) {
  console.log(encodeFxPassword())
}
