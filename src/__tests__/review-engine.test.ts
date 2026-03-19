import { describe, it, expect } from 'vitest'
import {
  buildReviewPrompt,
  buildFixPrompt,
  parseReviewResult,
  validateChecklist,
} from '../review-engine.js'
import type { ReviewResult } from '../types.js'

describe('parseReviewResult', () => {
  it('parses valid JSON review', () => {
    const json = JSON.stringify({
      verdict: 'PASS',
      score: 85,
      issues: [],
      checklist: [{ item: 'quality', status: 'pass', evidence: 'looks good overall' }],
      summary: 'Good output',
    })
    const result = parseReviewResult(json)
    expect(result.verdict).toBe('PASS')
    expect(result.score).toBe(85)
    expect(result.issues).toEqual([])
    expect(result.checklist).toHaveLength(1)
    expect(result.summary).toBe('Good output')
  })

  it('handles markdown-fenced JSON', () => {
    const raw = '```json\n{"verdict":"FAIL","score":20,"issues":[],"checklist":[],"summary":"bad"}\n```'
    const result = parseReviewResult(raw)
    expect(result.verdict).toBe('FAIL')
    expect(result.score).toBe(20)
  })

  it('returns FAIL with parse error on garbage input', () => {
    const result = parseReviewResult('not json at all')
    expect(result.verdict).toBe('FAIL')
    expect(result.score).toBe(0)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].category).toBe('parse_error')
  })

  it('handles invalid JSON inside braces', () => {
    const result = parseReviewResult('{ invalid json here }')
    expect(result.verdict).toBe('FAIL')
    expect(result.score).toBe(0)
    expect(result.issues[0].category).toBe('parse_error')
  })

  it('handles missing fields gracefully with defaults', () => {
    const result = parseReviewResult('{"score": 50}')
    expect(result.verdict).toBe('FAIL')
    expect(result.score).toBe(50)
    expect(result.issues).toEqual([])
    expect(result.checklist).toEqual([])
    expect(result.summary).toBe('')
  })

  it('handles extra text around JSON', () => {
    const raw = 'Here is my review:\n\n{"verdict":"CONDITIONAL_PASS","score":65,"issues":[{"severity":"medium","category":"style","description":"inconsistent","suggestion":"fix"}],"checklist":[],"summary":"ok"}\n\nLet me know.'
    const result = parseReviewResult(raw)
    expect(result.verdict).toBe('CONDITIONAL_PASS')
    expect(result.score).toBe(65)
    expect(result.issues).toHaveLength(1)
  })

  it('handles non-number score', () => {
    const result = parseReviewResult('{"verdict":"PASS","score":"high","issues":[],"checklist":[],"summary":""}')
    expect(result.score).toBe(0)
  })

  it('handles multiple brace groups — extracts last complete JSON', () => {
    const raw = 'Some text {not json} and then {"verdict":"PASS","score":75,"issues":[],"checklist":[],"summary":"ok"}'
    const result = parseReviewResult(raw)
    expect(result.verdict).toBe('PASS')
    expect(result.score).toBe(75)
  })

  it('sanitizes malformed issue objects', () => {
    const raw = JSON.stringify({
      verdict: 'FAIL',
      score: 40,
      issues: [{ bad: 'shape' }, { severity: 'critical', description: 'real issue' }],
      checklist: [],
      summary: 'test',
    })
    const result = parseReviewResult(raw)
    expect(result.issues).toHaveLength(2)
    // Malformed issue gets defaults
    expect(result.issues[0].severity).toBe('medium')
    expect(result.issues[0].category).toBe('unknown')
    expect(result.issues[0].description).toBe('No description')
    // Well-formed issue is preserved
    expect(result.issues[1].severity).toBe('critical')
    expect(result.issues[1].description).toBe('real issue')
  })

  it('clamps invalid verdict to FAIL', () => {
    const result = parseReviewResult('{"verdict":"APPROVED","score":80,"issues":[],"checklist":[],"summary":""}')
    expect(result.verdict).toBe('FAIL')
  })

  it('clamps score to 0-100 range', () => {
    const over = parseReviewResult('{"verdict":"PASS","score":150,"issues":[],"checklist":[],"summary":""}')
    expect(over.score).toBe(100)
    const under = parseReviewResult('{"verdict":"FAIL","score":-10,"issues":[],"checklist":[],"summary":""}')
    expect(under.score).toBe(0)
  })

  it('sanitizes malformed checklist items', () => {
    const raw = JSON.stringify({
      verdict: 'PASS',
      score: 80,
      issues: [],
      checklist: [{ wrong: 'format' }, { item: 'test', status: 'pass', evidence: 'good evidence here' }],
      summary: '',
    })
    const result = parseReviewResult(raw)
    expect(result.checklist).toHaveLength(2)
    expect(result.checklist[0].item).toBe('Unknown')
    expect(result.checklist[0].status).toBe('fail')
    expect(result.checklist[1].status).toBe('pass')
  })
})

describe('validateChecklist', () => {
  it('downgrades PASS items without evidence', () => {
    const result: ReviewResult = {
      verdict: 'PASS',
      score: 90,
      issues: [],
      checklist: [
        { item: 'a', status: 'pass', evidence: '' },
        { item: 'b', status: 'pass', evidence: '   ' },
        { item: 'c', status: 'pass', evidence: 'detailed evidence here' },
      ],
      summary: '',
      reviewer_model: '',
    }
    validateChecklist(result)
    expect(result.checklist[0].status).toBe('fail')
    expect(result.checklist[1].status).toBe('fail')
    expect(result.checklist[2].status).toBe('pass')
    // 2/3 > 30% → verdict forced to FAIL
    expect(result.verdict).toBe('FAIL')
    expect(result.score).toBeLessThanOrEqual(50)
  })

  it('does not downgrade when evidence is present', () => {
    const result: ReviewResult = {
      verdict: 'PASS',
      score: 90,
      issues: [],
      checklist: [
        { item: 'a', status: 'pass', evidence: 'solid evidence here' },
        { item: 'b', status: 'pass', evidence: 'another piece of evidence' },
      ],
      summary: '',
      reviewer_model: '',
    }
    validateChecklist(result)
    expect(result.verdict).toBe('PASS')
    expect(result.score).toBe(90)
  })

  it('does not change already-failing items', () => {
    const result: ReviewResult = {
      verdict: 'FAIL',
      score: 30,
      issues: [],
      checklist: [
        { item: 'a', status: 'fail', evidence: '' },
        { item: 'b', status: 'pass', evidence: 'good evidence here' },
      ],
      summary: '',
      reviewer_model: '',
    }
    validateChecklist(result)
    expect(result.checklist[0].status).toBe('fail')
    expect(result.checklist[1].status).toBe('pass')
  })

  it('adds anti_gaming issue when threshold exceeded', () => {
    const result: ReviewResult = {
      verdict: 'PASS',
      score: 95,
      issues: [],
      checklist: [
        { item: 'a', status: 'pass', evidence: '' },
        { item: 'b', status: 'pass', evidence: 'ok' },
        { item: 'c', status: 'pass', evidence: '' },
      ],
      summary: '',
      reviewer_model: '',
    }
    validateChecklist(result)
    expect(result.issues.some(i => i.category === 'anti_gaming')).toBe(true)
  })

  it('handles empty checklist without error', () => {
    const result: ReviewResult = {
      verdict: 'PASS',
      score: 80,
      issues: [],
      checklist: [],
      summary: '',
      reviewer_model: '',
    }
    validateChecklist(result)
    expect(result.verdict).toBe('PASS')
  })
})

describe('buildReviewPrompt', () => {
  it('includes output text', () => {
    const prompt = buildReviewPrompt('hello world')
    expect(prompt).toContain('hello world')
  })

  it('includes adversarial instructions', () => {
    const prompt = buildReviewPrompt('test')
    expect(prompt).toContain('adversarial')
    expect(prompt).toContain('find problems')
  })

  it('includes custom criteria when provided', () => {
    const prompt = buildReviewPrompt('output', 'check for typos')
    expect(prompt).toContain('REVIEW CRITERIA')
    expect(prompt).toContain('check for typos')
  })

  it('excludes criteria section when not provided', () => {
    const prompt = buildReviewPrompt('output')
    expect(prompt).not.toContain('REVIEW CRITERIA')
  })

  it('includes review type when provided', () => {
    const prompt = buildReviewPrompt('output', undefined, 'code')
    expect(prompt).toContain('REVIEW TYPE: code')
  })

  it('includes JSON template', () => {
    const prompt = buildReviewPrompt('test')
    expect(prompt).toContain('"verdict"')
    expect(prompt).toContain('"score"')
    expect(prompt).toContain('"issues"')
  })
})

describe('buildFixPrompt', () => {
  it('includes issues and original output', () => {
    const review: ReviewResult = {
      verdict: 'FAIL',
      score: 30,
      issues: [
        { severity: 'high', category: 'bug', description: 'off by one', suggestion: 'fix loop' },
        { severity: 'medium', category: 'style', description: 'bad naming', suggestion: 'rename' },
      ],
      checklist: [],
      summary: '',
      reviewer_model: '',
    }
    const prompt = buildFixPrompt('my output', review)
    expect(prompt).toContain('[HIGH] bug: off by one')
    expect(prompt).toContain('[MEDIUM] style: bad naming')
    expect(prompt).toContain('my output')
    expect(prompt).toContain('fix loop')
  })

  it('handles empty issues list', () => {
    const review: ReviewResult = {
      verdict: 'FAIL',
      score: 40,
      issues: [],
      checklist: [],
      summary: '',
      reviewer_model: '',
    }
    const prompt = buildFixPrompt('output', review)
    expect(prompt).toContain('output')
  })
})
