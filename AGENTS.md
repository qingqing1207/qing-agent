# Qing Agent Project Instructions

## Tool Implementation Baseline

For low-level tool capabilities, prefer mature existing npm packages over hand-written Node.js implementations.

Examples:

- Use glob libraries such as `fast-glob` for file discovery and glob matching.
- Use proven libraries for regex/file search, diffing, patching, shell process control, parsing, and other infrastructure-level behavior when an appropriate package exists.

Project-specific agent tool wiring still belongs in this codebase:

- `AgentTool` contracts
- Zod input validation
- workspace path safety
- permission/read-only policy
- output limiting and formatting
- error conversion to `ToolCallResult`
- registry integration
- REPL and agent-loop event handling

Only hand-write low-level behavior when a package is unavailable, unsuitable, or would add more complexity than it removes. In that case, document the reason near the implementation.
