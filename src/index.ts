#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { reviewOutput, reviewOutputDual } from './review-engine.js'
import { randomUUID } from 'node:crypto'

/** Create and configure an McpServer with all tools registered */
function createServer(): McpServer {
  const server = new McpServer({
    name: 'agentdesk-mcp',
    version: '1.2.0',
  })
  registerTools(server)
  return server
}

const server = createServer()

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

function registerTools(server: McpServer): void {

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

// ── Marketplace Tools ──

const AGENTDESK_API = process.env.AGENTDESK_API_URL || 'https://agentdesk.usedevtools.com'

server.tool(
  'list_services',
  'List all available services on the AgentDesk marketplace. Returns service catalog with pricing, quality scores, and capabilities. Filter by category, minimum quality score, maximum price, or capability.',
  {
    category: z.string().optional().describe('Filter by category: quality_assurance, web_scraping, realtime_data, document_generation, text_processing'),
    min_score: z.number().optional().describe('Minimum quality score (0-100)'),
    max_price: z.number().optional().describe('Maximum price per call in USD'),
    capability: z.string().optional().describe('Filter by capability keyword'),
  },
  safeAsyncTool(async ({ category, min_score, max_price, capability }) => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (min_score !== undefined) params.set('min_score', String(min_score))
    if (max_price !== undefined) params.set('max_price', String(max_price))
    if (capability) params.set('capability', capability)

    const url = `${AGENTDESK_API}/api/v1/services${params.toString() ? '?' + params.toString() : ''}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
    return await res.json()
  })
)

server.tool(
  'execute_service',
  'Execute a service on the AgentDesk marketplace. Requires an AgentDesk API key for authentication. Pass service-specific input parameters.',
  {
    service_id: z.string().describe('Service ID to execute (e.g., "review", "web_scrape", "realtime_jp", "pdf_generate", "summarize", "classify")'),
    input: z.record(z.unknown()).describe('Service-specific input parameters'),
    api_key: z.string().optional().describe('BYOK: Your Anthropic API key (for AI-powered services like review)'),
  },
  safeAsyncTool(async ({ service_id, input, api_key }) => {
    const agentdeskKey = process.env.AGENTDESK_API_KEY
    if (!agentdeskKey) {
      throw new Error('AGENTDESK_API_KEY environment variable is required for service execution.')
    }

    const body: Record<string, unknown> = { input }
    if (api_key) body.api_key = api_key

    const res = await fetch(`${AGENTDESK_API}/api/v1/services/${encodeURIComponent(service_id)}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agentdeskKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorBody = await res.text()
      throw new Error(`API error ${res.status}: ${errorBody}`)
    }
    return await res.json()
  })
)

} // end registerTools

// ── Start Server ──

async function startStdio() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

async function startHttp(port: number) {
  const { default: express } = await import('express')

  const app = express()
  app.use(express.json({ limit: '1mb' }))

  const transports = new Map<string, StreamableHTTPServerTransport>()

  app.all('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!
      await transport.handleRequest(req, res, req.body)
      return
    }

    if (req.method === 'POST') {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport)
        },
      })
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId)
      }
      const httpServer = createServer()
      await httpServer.connect(transport)
      await transport.handleRequest(req, res, req.body)
      return
    }

    res.status(405).json({ error: 'Method not allowed. Use POST to initialize.' })
  })

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', sessions: transports.size })
  })

  app.listen(port, () => {
    console.error(`AgentDesk MCP HTTP server listening on port ${port}`)
  })
}

const httpPort = process.env.MCP_HTTP_PORT || (process.argv.includes('--http') ? '3100' : null)

if (httpPort) {
  startHttp(parseInt(httpPort, 10)).catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
} else {
  startStdio().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
