# Georgie Master Closer Control Channel

Canonical objective: `georgie-master-closer-v1`.

This document is a transport anchor only. It does not create a second closing objective. Commands issued through MCP or the GitHub `georgie-handoff` fallback must reuse the canonical objective ID and their original idempotency identity. Returned receipts must bind to the same objective and command identity before any continuation is trusted.
