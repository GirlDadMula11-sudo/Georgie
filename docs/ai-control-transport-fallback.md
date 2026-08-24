# AI Control Transport Fallback

The ChatGPT ↔ Georgie control plane uses two transports with one canonical objective identity:

1. Primary: authenticated MCP at `/mcp` / governed connector at `/api/connector`.
2. Fallback: trusted GitHub issue comments labeled `georgie-handoff` carrying `ai-control:v1` envelopes.

Both transports must preserve the same `objectiveId`, `commandId`, `correlationId`, and idempotency key. The fallback is transport redundancy only; it does not create a second business objective or expand authority.

Georgie must post a deduplicated, read-back-confirmed receipt to the originating issue. Binding financial actions, lender submissions, external communications, fee changes, term acceptance, credential changes, merges, and production deployments remain governed by their existing approval boundaries.

A transport is considered healthy only when command acceptance and the returned receipt share the same objective and command identity.
