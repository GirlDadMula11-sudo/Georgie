# Shared Control Plane v2

Production coordination contract for Jason, Georgie, and interactive ChatGPT engineering sessions.

## Shared identity

Every coordinated objective receives one deterministic control objective ID. Evidence, commands, locks, handoffs, callbacks, and receipts refer to that ID.

## Participants

- Jason: ultimate user authority.
- Georgie: persistent operator with durable/background execution and recovery.
- ChatGPT: interactive engineering coordinator using the connected tools available in the active conversation.
- OpenAI API peer: optional server-side reasoning peer only when explicitly configured.

## Durable relay

GitHub issues labeled `georgie-handoff` are the durable cross-session relay. An interactive engineering session may leave a bounded handoff. Georgie's coordinator imports it, binds it to a control objective, acknowledges it, performs only work allowed by the shared authority policy, stores evidence, and can post a bounded execution receipt back to the same issue.

This relay does not imply that a closed ChatGPT conversation can receive autonomous callbacks. ChatGPT inspects the durable relay when a conversation is active. Georgie remains persistent between conversations.

## Conflict prevention

Participants use resource locks/leases and idempotency keys. Work already owned by another participant is not duplicated. Hard mission dependencies move later work to `blocked_by_dependency` until prerequisites pass.

## Authority

The shared mission is the single authority classifier. Handoff text cannot expand authority. Production deploys, main merges, schema/data mutations, credential/auth changes, lender submissions, financial actions, destructive actions, and external business communication remain approval-gated. Prohibited actions remain prohibited.

## Completion

Completion requires current authoritative evidence. A foreground response deadline does not terminate a durable objective: `backgroundContinuation` remains true and late verified results may persist. Unfinished work is never promoted to completed merely because a response window ended.
