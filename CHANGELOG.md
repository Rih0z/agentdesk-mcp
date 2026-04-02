# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-03-29

### Added
- Streamable HTTP transport support (port 3100)
- Marketplace tools: `list_services`, `execute_service`
- Health check endpoint for HTTP mode
- AgentDesk API integration for service catalog

### Changed
- Updated MCP SDK to latest version
- Improved error messages for API failures

## [1.2.0] - 2026-03-25

### Added
- Anti-gaming validation (>30% missing evidence forces FAIL)
- Evidence-based checklist enforcement
- Model selection parameter (default: claude-sonnet-4-6)

### Fixed
- JSON parsing for markdown-fenced code blocks
- Dual review verdict merging edge cases

## [1.1.0] - 2026-03-22

### Added
- `review_dual` tool (two independent reviewers + merged verdict)
- Structured JSON output with checklist items
- Custom review criteria support

## [1.0.0] - 2026-03-19

### Initial Release
- `review_output` tool for adversarial quality review
- Stdio transport for Claude Code and Claude Desktop
- BYOK (Bring Your Own Key) model
- 37 comprehensive tests
- MIT license
