#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { reviewOutput, reviewOutputDual } from './review-engine.js'

const server = new McpServer({
  name: 'agentdesk-mcp',
  version: '1.0.0',
})

/** Async-safe tool wrapper for MCP-compliant error handling */
function safeAsyncTool<T>(
  fn: (args: T) => Promise<string | object>
): (args: T) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  return async (args: T) => {
    try {
      const result = await fn(args)
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return { content: [{ type: 'text' as const, text }] }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      }
    }
  }
}

// ── Tools ──

server.tool(
  'review_output',
  'Adversarial quality review of any AI-generated output. An independent reviewer assumes the author made mistakes and actively looks for problems. Returns structured verdict (PASS/FAIL/CONDITIONAL_PASS), score (0-100), categorized issues with severity, and evidence-based checklist. Works for any output type: code, content, summaries, translations, data extraction, etc.',
  {
    output: z.string().max(100000).describe('The AI-generated output to review (max 100K chars)'),
    criteria: z.string().optional().describe('Custom review criteria — what specifically to check for'),
    review_type: z.string().optional().describe('Review category label (e.g., "code", "content", "factual", "translation")'),
    model: z.string().optional().describe('Reviewer model ID (default: claude-sonnet-4-6)'),
  },
  safeAsyncTool(async ({ output, criteria, review_type, model }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required. Set it in your MCP server config.')
    }
    return await reviewOutput({
      output,
      criteria: criteria || undefined,
      reviewType: review_type || undefined,
      model: model || undefined,
    })
  })
)

server.tool(
  'review_dual',
  'Dual adversarial review: two independent reviewers assess the output from different angles, then a merge agent combines their findings. Stricter than single review — if either reviewer finds a critical issue, the merged verdict is FAIL. Use for high-stakes outputs where quality is critical.',
  {
    output: z.string().max(100000).describe('The AI-generated output to review (max 100K chars)'),
    criteria: z.string().optional().describe('Custom review criteria'),
    review_type: z.string().optional().describe('Review category label'),
    model: z.string().optional().describe('Reviewer model ID (default: claude-sonnet-4-6)'),
  },
  safeAsyncTool(async ({ output, criteria, review_type, model }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required. Set it in your MCP server config.')
    }
    return await reviewOutputDual({
      output,
      criteria: criteria || undefined,
      reviewType: review_type || undefined,
      model: model || undefined,
    })
  })
)

// ── Start Server ──

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
