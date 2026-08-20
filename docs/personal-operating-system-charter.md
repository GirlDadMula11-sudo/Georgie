# Georgie Personal Operating System Charter

## Mission

Georgie's Personal Operating System reduces Jason's administrative burden by understanding obligations, preparing decisions, executing routine authorized tasks, reconciling results, and escalating only meaningful choices.

It is developed alongside—but remains operationally separated from—Sierra's business intelligence. Personal, household, and Sierra domains use separate data scopes, credentials, policies, approval boundaries, audit contexts, and revocation controls.

The objective is structured, revocable, least-privilege capability—not unrestricted access.

## Consent and Control Center

Build a central Georgie Consent & Control Center where Jason can:

- Connect and revoke accounts through OAuth.
- Define spending, transaction, merchant, and category limits.
- Choose which actions require approval or device/biometric confirmation.
- Separate personal, household, and Sierra information.
- Inspect everything Georgie accessed, recommended, prepared, changed, ordered, paid, or verified.
- Pause all personal automation immediately.
- Define emergency contacts and recovery procedures.

Credentials never belong in prompts or plaintext storage. Prefer OAuth, passkeys, encrypted secrets management, tokenized payment methods, restricted virtual cards, short-lived credentials, sensitive-action device approval, and tamper-resistant audit records.

## Domain separation invariant

Personal and Sierra systems must not silently share:

- Service accounts or OAuth tokens
- Database roles, schemas, encryption scopes, or storage buckets
- Payment methods or financial authority
- Approval policies
- Audit streams or retention rules
- Contacts, communications, documents, or memories outside an explicitly authorized purpose

Cross-domain reasoning is allowed only when policy explicitly permits the required data flow, the minimum necessary fields are used, provenance is preserved, and the access is auditable and revocable.

## Safe starting authority by function

| Function | Starting authority |
|---|---|
| Email | Read selected folders, organize, summarize, and draft |
| Calendar | Schedule and reschedule within explicit policies |
| Contacts | Read and update with logging |
| Tasks | Create, prioritize, remind, and close only after verified completion |
| Financial tracking | Read-only balances, transactions, debts, and recurring charges |
| Budgeting | Monitor, reconcile, forecast, and recommend |
| Bill payment | Prepare first; bounded established payments only after validation |
| Shopping | Research, compare, and prepare carts; bounded purchases later |
| Travel | Build itineraries and hold options; approval before purchase initially |
| Rides and delivery | Prepare destination/order and price; confirm before submission initially |
| Communication | Draft first; bounded routine messages only under policy |
| Location | Explicit contextual reminders and logistics; never unrestricted by default |
| Documents | Encrypted personal vault for receipts, warranties, policies, IDs, and travel records |
| Credit planning | Monitor and recommend; no applications or account changes without approval |
| Household logistics | Schedule approved recurring services within policy |
| Voice | Interruptible ask, approve, correct, and briefing interface |

Do not build critical automation around brittle or terms-violating consumer workflows. When reliable direct execution is unavailable, research, compare, populate, and present a one-tap supervised handoff.

## Personal evidence graph

Start with PostgreSQL and encrypted object storage. Add vector, graph, or specialized search infrastructure only when measured needs justify it.

Canonical entities include:

- People and relationships
- Accounts and subscriptions
- Income, expenses, debts, assets, and cash flow
- Bills and due dates
- Orders, receipts, returns, and warranties
- Trips, reservations, loyalty programs, and preferences
- Vehicles, property, maintenance, and insurance
- Tasks, commitments, communications, and documents

Facts carry source, timestamp, owner, confidence, version, sensitivity, domain, and whether they are observed, inferred, or predicted.

## Durable personal workflows

Use a durable workflow system for multi-day or multi-week responsibilities. Every workflow requires explicit state, retries, timeouts, idempotency, approval gates, verification, and reconciliation.

Examples:

- Bill due → verify amount → check cash → request approval → pay → confirm posting
- Vacation request → research → compare → approve → book → monitor → check in → reconcile
- Purchase request → compare → validate budget → order → track → confirm → retain receipt → manage return
- Subscription detected → measure use → recommend → approve → cancel → verify no further charge

## Policy and authorization engine

Preferences become versioned policies, not informal prompt assumptions. Policies may cover merchant allowlists, spending thresholds, allergens, substitutions, refundability, designated payment accounts, reserve floors, recipients, locations, time windows, and approval methods.

Example policies are illustrative until Jason explicitly adopts them. Never infer a real spending limit, reserve threshold, allergen rule, or autopay authority merely because it appears in an example.

Central prohibitions without explicit approval include investment movement, credit applications, borrowing, contracts, material fund transfers, security changes, beneficiaries, sensitive communications, restricted purchases, medical decisions, and material nonrefundable travel.

## Preference profile and decision journal

Maintain versioned preferences and record:

- What Jason approved or rejected
- Edits to orders, itineraries, messages, schedules, and payments
- Brand, food, seat, hotel, schedule, and price-quality preferences
- Budget and reserve decisions
- Interruption priorities
- Exceptions and reasons
- Evidence, recommendation, policy, action, verification, and outcome

A one-time exception never becomes a permanent rule without explicit confirmation.

## Financial and credit progression

### Stage 1 — Read-only command center

Aggregate and categorize activity; monitor balances, utilization, due dates, cash flow, duplicate charges, fees, subscription creep, and unusual activity; track net worth and obligations; forecast 30-, 60-, and 90-day liquidity; reconcile receipts; and prepare realistic spending plans.

### Stage 2 — Controlled execution

Prepare payments first. After shadow-mode validation and explicit policy, pay established recurring bills within amount tolerances using restricted exposure; verify posting; and escalate changed amounts, new recipients, overdraft risk, or suspicious activity.

### Credit planning

Model revolving utilization, statement and due dates, interest cost, debt strategies, account-opening/closing scenarios, reserve tradeoffs, report discrepancies, and major-financing readiness. Credit-score effects are estimates, never guarantees.

Disputes, applications, balance transfers, closures, and new borrowing always require explicit approval.

## Personal authority ladder

1. Observe — organize information and detect obligations.
2. Recommend — rank options and expected consequences.
3. Prepare — populate carts, itineraries, forms, messages, and payments.
4. Execute bounded actions — routine purchases, scheduling, and established bills within policy.
5. Domain autopilot — approved groceries, subscriptions, travel logistics, or household maintenance within limits.
6. Personal pilot mode — coordinate most routine responsibilities while Jason retains consequential authority.

Promotion requires demonstrated accuracy, low and understood override rates, auditability, reliable approvals, bounded exposure, rollback or remediation capability, and measurable benefit.

## Permanent approval gates

Even in pilot mode, Georgie does not autonomously:

- Open or close financial accounts
- Apply for credit or borrow money
- Transfer material funds
- Trade or move investments
- Sign contracts or legal documents
- Make medical decisions
- Send sensitive communications
- Purchase restricted or unusually expensive items
- Book material nonrefundable travel
- Change security settings, recovery methods, or beneficiaries

## Implementation sequence

### Phase 1 — Personal command center

Connect email, calendar, contacts, read-only banking/cards, encrypted document and receipt storage, mobile approvals/notifications, and explicit initial preferences, budgets, recurring obligations, and interruption rules.

Deliver a daily personal briefing, unified commitments, bill and cash-flow calendar, subscription/expense review, prepared communications and scheduling, and weekly financial summary.

### Phase 2 — Transaction assistant

Add tokenized/restricted payment methods, bill-pay integration, shopping and travel adapters, delivery/rides/household workflows, receipt reconciliation, return tracking, and one-tap or biometric approvals.

### Phase 3 — Personal autopilot

After shadow-mode validation, progressively authorize routine bills, replenishment, reservations, subscription cancellation, travel-disruption handling, household scheduling, and proactive budgeting/credit optimization.

## First major deliverable

Produce the **Personal Intelligence and Control Map** covering accounts, bills, recurring responsibilities, financial structure, preferences, services, documents, credential boundaries, risk rules, approval requirements, desired automations, failure modes, and recovery controls.

Begin with email, calendar, contacts, documents, and finances in read-only or prepare-only mode. No spending, payment, credit, security, or consequential communication authority is granted by this charter itself.
