import Anthropic from '@anthropic-ai/sdk'
import type { ReviewResult, ReviewIssue, ChecklistItem } from './types.js'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const MAX_REVIEW_TOKENS = 4096
const API_TIMEOUT_MS = 60000

interface ReviewOptions {
  output: string
  criteria?: string
  reviewType?: string
  model?: string
}

function getClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: API_TIMEOUT_MS,
  })
}

const REVIEW_JSON_TEMPLATE = `{
  "verdict": "PASS|FAIL|CONDITIONAL_PASS",
  "score": 0-100,
  "issues": [
    {
      "severity": "critical|high|medium|low",
      "category": "string",
      "description": "string",
      "suggestion": "string"
    }
  ],
  "checklist": [
    {
      "item": "string",
      "status": "pass|fail",
      "evidence": "specific quote or observation"
    }
  ],
  "summary": "string"
}`

/**
 * Independent adversarial review of an output.
 */
export async function reviewOutput(options: ReviewOptions): Promise<ReviewResult> {
  const { output, criteria, reviewType, model } = options
  const client = getClient()

  const reviewPrompt = buildReviewPrompt(output, criteria, reviewType)

  const startTime = Date.now()
  const response = await client.messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: MAX_REVIEW_TOKENS,
    messages: [{ role: 'user', content: reviewPrompt }],
  })

  const rawText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  const result = parseReviewResult(rawText)
  result.reviewer_model = model || DEFAULT_MODEL

  validateChecklist(result)

  console.error(`[REVIEW] Completed in ${Date.now() - startTime}ms — verdict: ${result.verdict}, score: ${result.score}`)
  return result
}

/**
 * Dual adversarial review — two independent reviewers + merge agent.
 */
export async function reviewOutputDual(options: ReviewOptions): Promise<ReviewResult> {
  const { output, criteria, model } = options
  const client = getClient()

  const [reviewA, reviewB] = await Promise.all([
    reviewOutput(options),
    reviewOutput({
      ...options,
      criteria: (criteria || '') + '\n\nAdditional focus: Look for edge cases, security issues, and unstated assumptions.',
    }),
  ])

  const mergePrompt = `You are a senior reviewer merging two independent reviews.

Review A:
- Verdict: ${reviewA.verdict} (Score: ${reviewA.score})
- Issues: ${JSON.stringify(reviewA.issues)}
- Summary: ${reviewA.summary}

Review B:
- Verdict: ${reviewB.verdict} (Score: ${reviewB.score})
- Issues: ${JSON.stringify(reviewB.issues)}
- Summary: ${reviewB.summary}

Produce a MERGED review. If either reviewer found a critical issue, the merged verdict must be FAIL.
Take the LOWER score. Combine all unique issues. Deduplicate.

Respond in this exact JSON format:
${REVIEW_JSON_TEMPLATE}`

  const mergeResponse = await client.messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: MAX_REVIEW_TOKENS,
    messages: [{ role: 'user', content: mergePrompt }],
  })

  const mergeText = mergeResponse.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  const merged = parseReviewResult(mergeText)
  merged.reviewer_model = `dual:${model || DEFAULT_MODEL}`
  return merged
}

// --- Exported helpers ---

export function buildReviewPrompt(output: string, criteria?: string, reviewType?: string): string {
  let prompt = `You are an independent, adversarial quality reviewer. Your job is to find problems.
Assume the author may have made mistakes, taken shortcuts, or missed edge cases.
Do NOT give the benefit of the doubt. Be thorough and critical.

IMPORTANT RULES:
1. Every checklist item MUST have specific evidence (a quote or concrete observation).
2. If you cannot find evidence for a PASS item, mark it as FAIL.
3. A single critical issue means the overall verdict MUST be FAIL.
4. Score must reflect the issues found: critical = max 30, high = max 60.
5. Do not be impressed by length or formatting — judge substance.

`

  if (criteria) {
    prompt += `REVIEW CRITERIA:\n${criteria}\n\n`
  }

  if (reviewType) {
    prompt += `REVIEW TYPE: ${reviewType}\n\n`
  }

  prompt += `OUTPUT TO REVIEW:
---
${output}
---

Respond in this exact JSON format (no other text):
${REVIEW_JSON_TEMPLATE}`

  return prompt
}

export function buildFixPrompt(output: string, review: ReviewResult): string {
  const issues = review.issues
    .map(i => `[${i.severity.toUpperCase()}] ${i.category}: ${i.description}\n  Suggestion: ${i.suggestion}`)
    .join('\n\n')

  return `An independent reviewer found these issues with your output:

${issues}

Original output:
---
${output}
---

Please fix ALL issues listed above. Produce the corrected output only — no explanations.`
}

/**
 * Extract JSON from LLM response by finding the last balanced { ... } block.
 * Handles markdown fences, extra text, multiple brace groups, and braces
 * inside JSON string values safely.
 */
function extractJson(raw: string): string | null {
  // Strip markdown code fences
  const stripped = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '')

  // Find the last top-level JSON object by scanning for balanced braces,
  // skipping braces inside quoted strings
  let depth = 0
  let start = -1
  let lastStart = -1
  let lastEnd = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\' && inString) {
      escaped = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        lastStart = start
        lastEnd = i + 1
      }
    }
  }

  if (lastStart === -1) return null
  return stripped.slice(lastStart, lastEnd)
}

function sanitizeIssue(item: unknown): ReviewIssue {
  const obj = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
  return {
    severity: (['critical', 'high', 'medium', 'low'].includes(obj.severity as string)
      ? obj.severity : 'medium') as ReviewIssue['severity'],
    category: typeof obj.category === 'string' ? obj.category : 'unknown',
    description: typeof obj.description === 'string' ? obj.description : 'No description',
    suggestion: typeof obj.suggestion === 'string' ? obj.suggestion : '',
  }
}

function sanitizeChecklistItem(item: unknown): ChecklistItem {
  const obj = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
  return {
    item: typeof obj.item === 'string' ? obj.item : 'Unknown',
    status: obj.status === 'pass' ? 'pass' : 'fail',
    evidence: typeof obj.evidence === 'string' ? obj.evidence : '',
  }
}

export function parseReviewResult(raw: string): ReviewResult {
  const jsonStr = extractJson(raw)
  if (!jsonStr) {
    return {
      verdict: 'FAIL',
      score: 0,
      issues: [{ severity: 'critical', category: 'parse_error', description: 'Could not parse review response', suggestion: 'Retry review' }],
      checklist: [],
      summary: 'Review parse error',
      reviewer_model: '',
    }
  }

  try {
    const parsed = JSON.parse(jsonStr)
    const validVerdicts = ['PASS', 'FAIL', 'CONDITIONAL_PASS'] as const
    const rawVerdict = parsed.verdict
    const verdict = validVerdicts.includes(rawVerdict) ? rawVerdict : 'FAIL'
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 0

    return {
      verdict,
      score,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(sanitizeIssue) : [],
      checklist: Array.isArray(parsed.checklist) ? parsed.checklist.map(sanitizeChecklistItem) : [],
      summary: parsed.summary || '',
      reviewer_model: '',
    }
  } catch {
    return {
      verdict: 'FAIL',
      score: 0,
      issues: [{ severity: 'critical', category: 'parse_error', description: 'Invalid JSON in review response', suggestion: 'Retry review' }],
      checklist: [],
      summary: 'Review JSON parse error',
      reviewer_model: '',
    }
  }
}

export function validateChecklist(result: ReviewResult): void {
  let downgraded = false
  for (const item of result.checklist) {
    if (item.status === 'pass' && (!item.evidence || item.evidence.trim().length < 5)) {
      item.status = 'fail'
      downgraded = true
    }
  }

  if (downgraded) {
    const failCount = result.checklist.filter(i => i.status === 'fail').length
    const total = result.checklist.length
    if (total > 0 && failCount / total > 0.3) {
      result.verdict = 'FAIL'
      result.score = Math.min(result.score, 50)
      result.issues.push({
        severity: 'high',
        category: 'anti_gaming',
        description: 'Multiple checklist items marked PASS without evidence were downgraded to FAIL',
        suggestion: 'Provide specific evidence for each checklist assertion',
      })
    }
  }
}
