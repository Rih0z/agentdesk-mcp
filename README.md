# AgentDesk MCP — Adversarial AI Review

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-35%20passing-brightgreen)]()
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)]()

> Quality control for AI pipelines — one MCP tool. Works with Claude Code, Claude Desktop, and any MCP client.

**29.5% of teams do NO evaluation of AI outputs.** ([LangChain Survey](https://www.langchain.com/state-of-agent-engineering))
**Knowledge workers spend 4.3 hours/week fact-checking AI outputs.** (Microsoft 2025)

AgentDesk MCP fixes this. Add independent adversarial review to any AI pipeline in 30 seconds.

## Quick Start

### Claude Code
```bash
claude mcp add agentdesk-mcp -- npx github:Rih0z/agentdesk-mcp
```

### Claude Desktop
```json
{
  "mcpServers": {
    "agentdesk-mcp": {
      "command": "npx",
      "args": ["github:Rih0z/agentdesk-mcp"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

### Install from GitHub
```bash
npm install github:Rih0z/agentdesk-mcp
```

### Requirements
- `ANTHROPIC_API_KEY` environment variable (uses your own key)

## Tools

### `review_output`
Adversarial quality review of any AI-generated output. An independent reviewer **assumes the author made mistakes** and actively looks for problems.

**Input:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `output` | Yes | The AI-generated output to review |
| `criteria` | No | Custom review criteria |
| `review_type` | No | Category: `code`, `content`, `factual`, `translation`, etc. |
| `model` | No | Reviewer model (default: `claude-sonnet-4-6`) |

**Output:**
```json
{
  "verdict": "PASS | FAIL | CONDITIONAL_PASS",
  "score": 82,
  "issues": [
    {
      "severity": "high",
      "category": "accuracy",
      "description": "Claim about X is unsupported",
      "suggestion": "Add citation or remove claim"
    }
  ],
  "checklist": [
    {
      "item": "Factual accuracy",
      "status": "pass",
      "evidence": "All statistics match cited sources"
    }
  ],
  "summary": "Overall assessment...",
  "reviewer_model": "claude-sonnet-4-6"
}
```

### `review_dual`
**Dual adversarial review** — two independent reviewers assess the output from different angles, then a merge agent combines findings.

- If **either** reviewer finds a critical issue → merged verdict is **FAIL**
- Takes the **lower** score
- Combines and deduplicates all issues

Use for high-stakes outputs where quality is critical.

Same parameters as `review_output`.

## How It Works

1. **Adversarial prompting**: The reviewer is instructed to assume mistakes were made. No benefit of the doubt.
2. **Evidence-based checklist**: Every PASS item requires specific evidence. Items without evidence are automatically downgraded to FAIL.
3. **Anti-gaming validation**: If >30% of checklist items lack evidence, the entire review is forced to FAIL with a capped score of 50.
4. **Structured output**: Verdict + numeric score + categorized issues + checklist (not just "looks good").

## Use Cases

- **Code review**: Check for bugs, security issues, performance problems
- **Content review**: Verify accuracy, readability, SEO, audience fit
- **Factual verification**: Validate claims in AI-generated text
- **Translation quality**: Check accuracy and naturalness
- **Data extraction**: Verify completeness and correctness
- **Any AI output**: Summaries, reports, proposals, emails, etc.

## Why Not Just Ask the Same AI to Review?

Self-review has **systematic leniency bias**. An LLM reviewing its own output shares the same blind spots that created the errors. Research shows models are 34% more likely to use confident language when hallucinating.

AgentDesk uses a **separate reviewer invocation** with adversarial prompting — fundamentally different from self-review.

## Comparison

| Feature | AgentDesk MCP | Manual prompt | Braintrust | DeepEval |
|---------|--------------|---------------|------------|----------|
| One-tool setup | Yes | No | No | No |
| Adversarial review | Yes | DIY | No | No |
| Dual reviewer | Yes | DIY | No | No |
| Anti-gaming validation | Yes | No | No | No |
| No SDK required | Yes | Yes | No | No |
| MCP native | Yes | No | No | No |

## Framework Integration

### CrewAI Quality Gate
```python
import requests

def agentdesk_review(output: str, review_type: str = "content") -> dict:
    """Add AgentDesk quality gate to any CrewAI pipeline"""
    resp = requests.post("https://agentdesk-blue.vercel.app/api/v1/tasks",
        headers={"Authorization": "Bearer agd_your_key"},
        json={"prompt": output, "api_key": "sk-ant-key",
              "review": True, "review_type": review_type})
    return resp.json()

# After crew.kickoff()
result = crew.kickoff()
review = agentdesk_review(result.raw, "code")
if review["review"]["verdict"] != "PASS":
    print(f"Failed: {review['review']['score']}/100")
```

### Hosted API

Full REST API available at [agentdesk-blue.vercel.app](https://agentdesk-blue.vercel.app):
- `POST /api/v1/tasks` — Execute + review
- `POST /api/v1/agents` — Register AI agent (marketplace)
- `POST /api/v1/delegate` — Delegate to registered agent with auto-review
- [Full API docs](https://agentdesk-blue.vercel.app/docs)

## Development

```bash
git clone https://github.com/Rih0z/agentdesk-mcp.git
cd agentdesk-mcp
npm install
npm test        # 35 tests
npm run build
```

## License

MIT

---

Built by [EZARK Consulting](https://ezark.co.jp) | [Web Version](https://agentdesk-blue.vercel.app)
