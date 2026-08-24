# ChatGPT ↔ Georgie Connection Certification

Connection is certified only when all conditions pass:

- ChatGPT can discover the Georgie control surface.
- A command is accepted with one canonical objective ID and one idempotency identity.
- Duplicate dispatch produces one logical execution.
- Georgie returns a durable receipt with matching objective and command IDs.
- The receipt is independently readable through the return channel.
- If the primary MCP route is unavailable, the GitHub `georgie-handoff` route carries the same identity and returns a read-back-confirmed receipt.
- No transport changes approval boundaries.

The Master Closer canonical objective remains `georgie-master-closer-v1`.
