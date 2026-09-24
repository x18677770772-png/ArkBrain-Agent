import { extractKeywords } from './keywords.js'

// 复用 keywords.js 的 extractKeywords（同一清洗 + isValidNgram），避免本地拷贝再次漏掉
// ASCII 标点清洗 / 纯符号 n-gram 过滤。
function extractKeywordSet(text, maxKeywords = 20) {
  if (!text) return new Set()
  return new Set(extractKeywords(text, maxKeywords))
}

// 相关性过滤：候选概念与原始 query 主题词之间必须有字面关联
// 规则：共享连续2个或以上汉字字符，或英文词为 query 词的子串/超串（忽略大小写）
function isRelatedToQuery(concept, queryKeywords) {
  for (const qw of queryKeywords) {
    // 英文：子串包含关系
    if (/^[a-zA-Z]+$/.test(concept) && /^[a-zA-Z]+$/.test(qw)) {
      const c = concept.toLowerCase()
      const q = qw.toLowerCase()
      if (c.includes(q) || q.includes(c)) return true
      continue
    }
    // 中文或混合：共享长度 >= 2 的子串
    const shorter = concept.length <= qw.length ? concept : qw
    const longer  = concept.length <= qw.length ? qw : concept
    for (let i = 0; i <= shorter.length - 2; i++) {
      const slice = shorter.slice(i, i + 2)
      if (longer.includes(slice)) return true
    }
  }
  return false
}

/**
 * 从 LLM 第1轮思考输出中提取涌现的新概念。
 * 只返回与原始 query 有字面关联、且不在原始 query 关键词集合中的词，最多 6 个。
 *
 * @param {string} thinkingText - LLM 第1轮的思考/回复内容（可能含 <think>...</think>）
 * @param {string} originalQuery - 原始用户消息
 * @returns {string[]} 过滤后的新概念列表，最多 6 个
 */
export function extractEmergentConcepts(thinkingText, originalQuery) {
  if (!thinkingText || !originalQuery) return []

  // 优先使用 <think> 块内容；没有则使用全文
  const thinkMatch = thinkingText.match(/<think>([\s\S]*?)<\/think>/i)
  const sourceText = thinkMatch ? thinkMatch[1] : thinkingText

  const thinkingKeywords = extractKeywordSet(sourceText, 40)
  const queryKeywords    = extractKeywordSet(originalQuery, 20)

  // 排除原始 query 已包含的词（避免重复搜索）
  const emergent = [...thinkingKeywords].filter(kw => !queryKeywords.has(kw))

  // 锚定过滤：只保留与原始 query 主题词有字面关联的词，防止联想漂移
  const anchored = emergent.filter(kw => isRelatedToQuery(kw, queryKeywords))

  return anchored.slice(0, 6)
}
