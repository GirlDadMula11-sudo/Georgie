# GitHub source certification

Certification is read-only and must be scoped to exactly one explicit `owner/name` repository.

For a scoped certification, Georgie must preserve that repository in every planned GitHub source action: repository list/get, branch list/get, safe file read, and source search. Missing or conflicting repository scope fails closed during planning. No Mac-agent, public-web, deployment-observability, or inferred-repository fallback is permitted.

Authentication is a separate runtime precondition. `GEORGIE_GITHUB_TOKEN` must be configured through the deployment secret environment and must never be committed to source control or emitted to logs.
