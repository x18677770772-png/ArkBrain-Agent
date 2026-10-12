// Run: node src/test-llm-incomplete-retry.js
//
// 覆盖 Ark plan 偶发把长流截断成 response.incomplete 的重试语义。
// 核心改动：ERESPONSEINCOMPLETE 视为瞬时故障（即使已流出正文），交给
// streamOnceWithRetry 整条重发；重试耗尽才用 err.partialResult 交付 salvage。

import assert from 'node:assert/strict'
import { isTransientError } from './llm.js'

// ── isTransientError：ERESPONSEINCOMPLETE 新分支 ──────────────────────────

// 无正文的 incomplete：原本就瞬时（provider 直接掐断）。
assert.equal(
  isTransientError({ code: 'ERESPONSEINCOMPLETE', message: 'incomplete' }),
  true,
  'ERESPONSEINCOMPLETE 无正文 → 瞬时',
)

// 带正文的 incomplete：本次改动的关键。旧逻辑因 hadContent 拦截而不重试，
// 现在允许重发整条，避免交付拦腰截断的答案。
assert.equal(
  isTransientError({ code: 'ERESPONSEINCOMPLETE', hadContent: true, message: 'incomplete' }),
  true,
  'ERESPONSEINCOMPLETE 带正文 → 仍算瞬时（允许整条重发）',
)

// aborted 的 incomplete 不重试：那是调用方主动打断，不是 provider 故障。
assert.equal(
  isTransientError({ code: 'ERESPONSEINCOMPLETE', aborted: true, message: 'incomplete' }),
  false,
  'ERESPONSEINCOMPLETE + aborted → 不重试',
)

// ERESPONSESTREAM（缺 terminal，Ark 断流另一形态）：与 INCOMPLETE 同等对待，
// 带正文也重试——partialResult 挂错误上，耗尽后兜底交付。
assert.equal(
  isTransientError({ code: 'ERESPONSESTREAM', hadContent: true, message: 'stream ended' }),
  true,
  'ERESPONSESTREAM 带正文 → 瞬时（允许整条重发）',
)

// 无正文的 ERESPONSESTREAM 保持瞬时。
assert.equal(
  isTransientError({ code: 'ERESPONSESTREAM', message: 'stream ended' }),
  true,
  'ERESPONSESTREAM 无正文 → 瞬时',
)

// aborted 的 ERESPONSESTREAM 不重试（调用方主动打断）。
assert.equal(
  isTransientError({ code: 'ERESPONSESTREAM', aborted: true, message: 'stream ended' }),
  false,
  'ERESPONSESTREAM + aborted → 不重试',
)

// 真实网络错误码保持瞬时。
assert.equal(
  isTransientError({ code: 'ECONNRESET', message: 'socket hang up' }),
  true,
  'ECONNRESET → 瞬时',
)

// 5xx 保持瞬时。
assert.equal(
  isTransientError({ status: 502, message: 'bad gateway' }),
  true,
  '502 → 瞬时',
)

// 非瞬时错误（如内容审核、参数错误）不重试。
assert.equal(
  isTransientError({ code: 'ERESPONSEFAILED', hadContent: true, message: 'content filter' }),
  false,
  '带正文的非 incomplete 失败 → 不重试',
)

console.log('PASS isTransientError ERESPONSEINCOMPLETE retry semantics')
