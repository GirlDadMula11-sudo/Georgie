const SAFE_ALIAS_CAPABILITIES = new Set([
  "developer.control_plane",
  "developer.engineering",
  "engineering.control_plane",
  "developer.operator_core"
]);

const READ_OR_LOWER_REQUESTS = new Set([
  "read_only",
  "inspect",
  "analysis",
  "diagnostic",
  "low-risk-reversible-engineering",
  "low_risk_reversible_engineering"
]);

function requiredAuthority(contract, operation) {
  return contract?.authorityByOperation?.[operation] || contract?.authority || null;
}

function contractView(name, contract) {
  return {
    capability: name,
    targetDevice: contract?.targetDevice || null,
    operations: [...(contract?.operations || [])],
    authorityByOperation: Object.fromEntries([...(contract?.operations || [])].map(operation => [operation, requiredAuthority(contract, operation)]))
  };
}

export function discoverCapabilityRoutes(contracts = {}) {
  return Object.entries(contracts).map(([name, contract]) => contractView(name, contract));
}

function preservesProhibitions(requested = [], contract) {
  const known = contract?.prohibitedRoutes || new Set();
  return requested.every(route => known.has(route));
}

function exactOperationMatches(request, contracts) {
  return Object.entries(contracts).filter(([, contract]) =>
    contract?.operations?.has(request.operation) &&
    contract.targetDevice === request.targetDevice &&
    requiredAuthority(contract, request.operation) === request.authority &&
    preservesProhibitions(request.prohibitedRoutes, contract)
  );
}

function developerInspectionFallback(request, contracts) {
  if (!SAFE_ALIAS_CAPABILITIES.has(request.capability)) return null;
  if (!READ_OR_LOWER_REQUESTS.has(request.authority)) return null;
  if (!/\b(?:georgie|repo|repository|codebase|operator|runtime|connector|reliability|upgrade|repair|strengthen|sophisticate|reason|orchestrat)\w*\b/i.test(request.command || "")) return null;
  const capability = "developer.repository_inspection";
  const contract = contracts[capability];
  if (!contract?.operations?.has("inspect")) return null;
  const canonicalProhibitions = [...(contract.prohibitedRoutes || [])];
  if (!preservesProhibitions(request.prohibitedRoutes, contract)) return null;
  return {
    capability,
    targetDevice: contract.targetDevice,
    operation: "inspect",
    authority: requiredAuthority(contract, "inspect"),
    prohibitedRoutes: [...new Set([...canonicalProhibitions, ...request.prohibitedRoutes])],
    reason: "unsupported_developer_capability_reformulated_to_read_only_repository_inspection",
    confidence: 0.98
  };
}

export function orchestrateCapabilityRequest(input = {}, contracts = {}) {
  const request = {
    capability: String(input.capability || "").toLowerCase(),
    targetDevice: String(input.targetDevice || ""),
    operation: String(input.operation || "").toLowerCase(),
    authority: String(input.authority || "").toLowerCase(),
    prohibitedRoutes: [...new Set((input.prohibitedRoutes || []).map(value => String(value).toLowerCase()))],
    command: String(input.command || "")
  };

  const exact = contracts[request.capability];
  if (exact && exact.operations?.has(request.operation)) {
    return { status: "exact", route: request, alternatives: [] };
  }

  const directMatches = exactOperationMatches(request, contracts);
  if (directMatches.length === 1) {
    const [capability, contract] = directMatches[0];
    return {
      status: "reformulated",
      route: { ...request, capability },
      alternatives: [],
      audit: {
        requestedCapability: request.capability,
        requestedOperation: request.operation,
        selectedCapability: capability,
        selectedOperation: request.operation,
        reason: "unique_exact_operation_authority_target_match",
        authorityEscalated: false
      }
    };
  }

  const developerFallback = developerInspectionFallback(request, contracts);
  if (developerFallback) {
    return {
      status: "reformulated",
      route: developerFallback,
      alternatives: [],
      audit: {
        requestedCapability: request.capability,
        requestedOperation: request.operation,
        requestedAuthority: request.authority,
        selectedCapability: developerFallback.capability,
        selectedOperation: developerFallback.operation,
        selectedAuthority: developerFallback.authority,
        reason: developerFallback.reason,
        confidence: developerFallback.confidence,
        authorityEscalated: false
      }
    };
  }

  const alternatives = discoverCapabilityRoutes(contracts)
    .filter(item => item.operations.includes(request.operation) || item.capability.split(".")[0] === request.capability.split(".")[0])
    .slice(0, 8);
  return {
    status: "unsupported",
    route: request,
    alternatives,
    audit: {
      requestedCapability: request.capability,
      requestedOperation: request.operation,
      reason: "no_safe_equivalent_route",
      authorityEscalated: false
    }
  };
}
