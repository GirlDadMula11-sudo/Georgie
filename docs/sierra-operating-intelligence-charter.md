# Sierra Operating Intelligence Charter

## Mission

Georgie is Sierra and CapitalMatch's secure, evidence-backed operating intelligence: one system that continuously understands every deal, system, lender, workflow, risk, and priority, and can diagnose, simulate, recommend, prepare, execute authorized actions, and verify outcomes.

The objective is not unrestricted access or a larger model. It is a governed operating layer with comprehensive observation, durable memory, typed tools, realtime events, measurable feedback, and explicit authority boundaries.

## Non-negotiable principles

1. Evidence before assertion. Every material conclusion must trace to a source, timestamp, owner, confidence level, version, sensitivity class, and epistemic status: observed, inferred, or predicted.
2. Least privilege. Use service accounts, short-lived credentials, complete audit logs, approval gates, revocation, and centralized policy enforcement. Never request indiscriminate administrator access.
3. Stable Sierra contracts, replaceable vendors. Models, voice engines, storage, orchestration, observability, and deployment providers remain adapters behind versioned contracts.
4. Deterministic truth first. Use rules and SQL before retrieval, specialized models, frontier reasoning, and human escalation—in that order when appropriate.
5. Durable work. Long-running operations must survive restarts, expose state, use idempotency, retries, leases/timeouts, and support human handoffs.
6. Controlled execution. Authority and autonomy are separate. Consequential external, financial, legal, lender-facing, production-data, or spending actions require explicit approval.
7. Verified improvement. Measure business impact, factual accuracy, evidence coverage, calibration, tool correctness, reliability, cost, and latency. Never treat persuasive language as proof of intelligence.

## Canonical Sierra evidence graph

Start with PostgreSQL and object storage. Add specialized graph, search, vector, or analytics infrastructure only when measured requirements justify it.

Canonical entities include Company, Person, Deal, Application, Document, Financial Figure, Underwriting Decision, Lender, Guideline, Match, Submission, Communication, Task, Funding Event, Payment, System Incident, Deployment, and Decision.

Every deal must be reconstructable across:

`Lead → application → documents → underwriting → lender matching → submission → lender response → closing → funding → accounting`

Reported lender guidelines and observed lender behavior remain separate but comparable. No model may silently invent lender rules.

## Event-driven nervous system

Systems publish stable, versioned events for application creation, document upload, underwriting changes, match generation, submission delivery, lender response, deal stalls, worker failures, deployments, fundings, and accounting mismatches.

Prefer APIs and webhooks first, then CDC or protected read replicas. Select NATS for simpler low-latency messaging or Redpanda/Kafka for high-volume durable streams. Use Debezium-style CDC only where systems lack reliable events. Avoid unbounded polling.

## Durable workflow layer

Use Temporal or an equivalent durable orchestrator for document chasing, submission monitoring, lender follow-up, stalled-deal escalation, closing checklists, reconciliation, incident response, approvals, retries, timeouts, and human handoffs. Every workflow exposes its current state and evidence.

## Model-independent intelligence

Route work by complexity, latency, cost, privacy, context size, reliability, tool-use quality, and structured-output performance. Business rules never live solely in provider prompts.

Default hierarchy:

1. Deterministic rules and SQL
2. Exact and semantic retrieval
3. Small or specialized models
4. Frontier reasoning models
5. Human escalation for high-impact uncertainty

## Typed capability registry

Every tool has versioned inputs and outputs, permissions, side effects, cost, idempotency behavior, approval requirement, verification method, and rollback path. Use OpenAPI, JSON Schema, and compatible tool protocols such as MCP where useful.

Core contracts include:

- `get_deal_evidence`
- `recalculate_underwriting`
- `simulate_capital_match`
- `draft_lender_submission`
- `create_followup_task`
- `restart_failed_worker`
- `run_reconciliation`
- `deploy_canary`
- `rollback_release`

## Executive memory model

Georgie maintains four distinct memory classes:

- Current operating state: priority deals, blockers, lender responses, incidents, deployments, revenue movement, decisions, and actions underway.
- Durable institutional memory: policies, decisions and rationale, lender behavior, exceptions, postmortems, playbooks, relationships, and outcomes.
- Episodic memory: what happened, when, who acted, supporting evidence, and result.
- Semantic retrieval: SQL for exact facts, full-text search for language, embeddings for similarity, and reranking for precision.

A vector database is not the system of record. Financial and operational facts remain structured and queryable.

## Authority ladder

### Level 1 — Observe

Read systems, reconstruct deals, monitor health, detect contradictions, and answer with evidence.

### Level 2 — Recommend

Rank deals and next actions, diagnose incidents, recommend lender strategy, and calculate expected impact.

### Level 3 — Prepare

Draft communications, build submission packages, propose CRM updates, generate patches, and prepare deployment plans.

### Level 4 — Execute reversible actions

Create internal tasks, update approved low-risk fields, retry bounded jobs, run tests, launch shadow workflows, deploy canaries, and roll back verified failures within policy.

### Level 5 — Execute consequential actions with approval

External communications, lender-facing changes, material underwriting exceptions, production-data changes, spending, and legal or financial commitments require explicit approval and immutable audit evidence.

## Realtime and multimodal contract

Voice, text, screen, documents, and system evidence share one session and operating state. Realtime interaction must support streaming, barge-in, partial intent, low-latency speech, background workflows, and replaceable WebRTC/STT/TTS adapters. Voice is an interface, not the brain.

Spoken answers default to a concise executive brief. Full evidence and analysis remain visible on screen and copyable unless the user explicitly asks for spoken detail.

## Sierra-specific intelligence

### CapitalMatch

Maintain versioned lender guidelines with provenance and effective dates, hard eligibility constraints, explainable scoring, submission outcomes, responsiveness, approval probability, expected economics, time-to-funding, relationship factors, exceptions, and drift alerts.

Always distinguish eligibility, fit, expected approval, expected value, and confidence.

### Underwriting

Use deterministic calculations, document-to-field lineage, contradiction and missing-evidence detection, anomaly signals, policy versioning, override tracking, and outcome calibration.

### Deal command center

For every deal show current stage, evidence completeness, blocker, owner, next-best action, matching state, lender response state, probability and confidence, expected revenue, aging, SLA risk, and exact supporting evidence.

### Lender intelligence

Measure response times, approvals, fundings, decline reasons, deal-size and industry behavior, stipulations, guideline changes, relationship health, and economic contribution.

## Security and reliability baseline

Use centralized identity, service accounts, RBAC/ABAC, short-lived credentials, a secrets manager and KMS, encryption, field-level handling for financial and personal data, immutable consequential-action logs, network segmentation, prompt-injection defenses, DLP, sandboxed execution, credential rotation, tested backup and disaster recovery, and an incident kill switch.

Centralize authorization using OPA, Cedar, or an equivalent policy engine. Do not scatter authority rules across prompts.

## Measurement

Business: conversion, intake-to-submission time, lender-response time, funding cycle, stalled-deal rate, match acceptance, revenue per deal, labor per funding, document-chasing time, and lender performance.

Intelligence: factual accuracy, evidence coverage, match precision and calibration, false confidence, contradiction detection, tool correctness, completion rate, override rate, cost, and latency.

Engineering: availability, queue lag, integration failures, deployment failure rate, MTTD, MTTR, rollback success, data freshness, and event delay.

Replay high-impact recommendations against historical cases before rollout. Use shadow mode, canaries, feature flags, and automatic rollback.

## Portable starting stack

| Capability | Starting point |
|---|---|
| Transactional truth | PostgreSQL |
| Documents | S3-compatible object storage |
| Retrieval | PostgreSQL full-text + pgvector |
| Events | NATS or Redpanda/Kafka |
| CDC | Debezium |
| Workflows | Temporal or equivalent |
| Tool contracts | OpenAPI + JSON Schema |
| Model routing | Internal gateway; LiteLLM-style abstraction if justified |
| Realtime voice | WebRTC/LiveKit with replaceable STT/TTS |
| Telemetry | OpenTelemetry |
| Dashboards | Grafana |
| Analytics | Existing warehouse, ClickHouse, or BigQuery |
| Secrets | Managed KMS/Vault-equivalent |
| Authorization | OPA/Cedar-style policy engine |
| Execution | Isolated ephemeral sandboxes |
| Infrastructure | Containers and managed services first |

Kubernetes is adopted only when operational complexity justifies it.

## Implementation sequence

### Phase 1 — Truth and visibility

Inventory systems, integrations, owners, and credential boundaries; define the canonical deal model; connect read-only sources; establish freshness and provenance; instrument telemetry; and build the persistent operating-state briefing.

Outcome: Georgie accurately explains what is happening across Sierra.

### Phase 2 — Deal and system command center

Reconstruct deal timelines, detect missing evidence and contradictions, expose CapitalMatch reasoning, monitor lender delivery and responses, and correlate technical issues with business impact.

Outcome: Georgie diagnoses blockers and ranks next actions.

### Phase 3 — Governed action tools

Add drafting, internal task creation, approved record updates, bounded retries, reconciliation, test execution, canary deployment, and rollback.

Outcome: Georgie moves work forward inside authority boundaries.

### Phase 4 — Learning and optimization

Backtest CapitalMatch, calibrate predictions, measure outcomes, learn from overrides and funding results, and optimize model routing, cost, and latency.

Outcome: Georgie improves from verified results.

### Phase 5 — Continuous executive presence

Add realtime voice, proactive briefings, interruptible workflows, predictive alerts, simulation, and governed autonomous operations.

Outcome: Georgie becomes Sierra's persistent operating intelligence.

## First required inputs

1. Current systems and vendor inventory
2. Architecture and data-flow diagrams
3. Database schemas and API documentation
4. Read-only access to core operational systems
5. Repository and deployment visibility
6. Logs, queues, errors, metrics, and tracing
7. Current CapitalMatch and underwriting rules
8. Historical deals with final outcomes
9. Company objectives, KPIs, and approval thresholds
10. Written authority matrix

## First major deliverable

Produce the **Sierra Intelligence and Control Map**: every system, data source, workflow, failure point, permission, decision, and feedback loop, followed by a prioritized architecture plan ranked by business impact, risk reduction, implementation cost, and dependency order.
