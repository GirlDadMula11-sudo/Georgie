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
      reason: "exact_execution_capability_unavailable",
      missingPrerequisite: `registered executor for ${request.capability}/${request.operation} on ${request.targetDevice} with ${request.authority} authority`,
      authorityEscalated: false
    }
  };
}
