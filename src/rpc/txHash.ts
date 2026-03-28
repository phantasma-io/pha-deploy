function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function requireRpcTxHash(
  rpcResult: unknown,
  context: string,
): string {
  if (typeof rpcResult === "string" && rpcResult.trim().length > 0) {
    return rpcResult;
  }

  if (rpcResult && typeof rpcResult === "object") {
    const record = rpcResult as Record<string, unknown>;

    if (typeof record.hash === "string" && record.hash.trim().length > 0) {
      return record.hash;
    }

    if ("error" in record) {
      const errorValue = record.error;
      const errorText =
        typeof errorValue === "string" && errorValue.trim().length > 0
          ? errorValue
          : formatUnknown(errorValue);
      throw new Error(`${context} RPC error: ${errorText}`);
    }
  }

  throw new Error(`${context} RPC returned a non-hash result: ${formatUnknown(rpcResult)}`);
}
