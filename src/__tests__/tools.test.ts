import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @anthropic-ai/sdk before importing review engine
const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      }
    },
  }
})

import { reviewOutput, reviewOutputDual } from '../review-engine.js'

function mockReviewResponse(verdict: string, score: number) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        verdict,
        score,
        issues: verdict === 'FAIL'
          ? [{ severity: 'high', category: 'test', description: 'test issue', suggestion: 'fix it' }]
          : [],
        checklist: [{ item: 'quality', status: 'pass', evidence: 'good quality output verified' }],
        summary: `Review: ${verdict}`,
      }),
    }],
    usage: { input_tokens: 100, output_tokens: 200 },
  }
}

describe('reviewOutput (mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('returns a ReviewResult with verdict and score', async () => {
    mockCreate.mockResolvedValueOnce(mockReviewResponse('PASS', 85))
    const result = await reviewOutput({ output: 'test output' })
    expect(result.verdict).toBe('PASS')
    expect(result.score).toBe(85)
    expect(result.reviewer_model).toBe('claude-sonnet-4-6')
  })

  it('passes custom criteria to the API', async () => {
    mockCreate.mockResolvedValueOnce(mockReviewResponse('PASS', 90))
    await reviewOutput({ output: 'test', criteria: 'check for accuracy' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('check for accuracy')
  })

  it('passes review type to the API', async () => {
    mockCreate.mockResolvedValueOnce(mockReviewResponse('PASS', 80))
    await reviewOutput({ output: 'test', reviewType: 'content' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('REVIEW TYPE: content')
  })

  it('uses specified model', async () => {
    mockCreate.mockResolvedValueOnce(mockReviewResponse('PASS', 80))
    const result = await reviewOutput({ output: 'test', model: 'claude-haiku-4-5-20251001' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe('claude-haiku-4-5-20251001')
    expect(result.reviewer_model).toBe('claude-haiku-4-5-20251001')
  })

  it('handles FAIL verdict correctly', async () => {
    mockCreate.mockResolvedValueOnce(mockReviewResponse('FAIL', 25))
    const result = await reviewOutput({ output: 'bad output' })
    expect(result.verdict).toBe('FAIL')
    expect(result.score).toBe(25)
    expect(result.issues).toHaveLength(1)
  })

  it('handles API error gracefully', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'))
    await expect(reviewOutput({ output: 'test' })).rejects.toThrow('API rate limit')
  })

  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY
    // The Anthropic SDK itself throws when no key is provided
    mockCreate.mockRejectedValueOnce(new Error('Missing API key'))
    await expect(reviewOutput({ output: 'test' })).rejects.toThrow()
  })
})

describe('reviewOutputDual (mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('calls API 3 times (2 reviews + 1 merge)', async () => {
    mockCreate
      .mockResolvedValueOnce(mockReviewResponse('PASS', 85))   // Review A
      .mockResolvedValueOnce(mockReviewResponse('PASS', 80))   // Review B
      .mockResolvedValueOnce(mockReviewResponse('PASS', 82))   // Merge

    const result = await reviewOutputDual({ output: 'test output' })
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(result.reviewer_model).toContain('dual:')
  })

  it('produces dual: prefixed reviewer_model', async () => {
    mockCreate
      .mockResolvedValueOnce(mockReviewResponse('PASS', 85))
      .mockResolvedValueOnce(mockReviewResponse('PASS', 80))
      .mockResolvedValueOnce(mockReviewResponse('PASS', 82))

    const result = await reviewOutputDual({ output: 'test' })
    expect(result.reviewer_model).toBe('dual:claude-sonnet-4-6')
  })

  it('merge prompt includes both reviews', async () => {
    mockCreate
      .mockResolvedValueOnce(mockReviewResponse('PASS', 90))
      .mockResolvedValueOnce(mockReviewResponse('FAIL', 40))
      .mockResolvedValueOnce(mockReviewResponse('FAIL', 40))

    await reviewOutputDual({ output: 'test' })
    // The 3rd call is the merge call
    const mergeCallArgs = mockCreate.mock.calls[2][0]
    expect(mergeCallArgs.messages[0].content).toContain('Review A')
    expect(mergeCallArgs.messages[0].content).toContain('Review B')
  })
})
