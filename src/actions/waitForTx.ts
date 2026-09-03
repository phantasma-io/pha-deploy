import {
  ExecutionState,
  PhantasmaAPI,
  TransactionData,
} from "phantasma-sdk-ts";

export interface SettledTx {
  success: boolean;
  result: string;
  /**
   * Gas the chain actually billed, in atoms of the gas token. An aborted transaction is billed
   * too, so this is read whenever the node answered with a final state; it stays 0 when the state
   * could not be established at all.
   */
  fee: bigint;
}

function billedFee(txInfo: TransactionData): bigint {
  // The node reports the fee as a decimal string of atoms; a missing or malformed value is
  // reported as zero rather than crashing a transaction that already settled.
  try {
    return BigInt(txInfo.fee ?? 0);
  } catch {
    return 0n;
  }
}

export async function waitForTx(
  rpc: PhantasmaAPI,
  txHash: string,
): Promise<SettledTx> {
  const start = Date.now();
  const timeoutMs = 30_000; // 30 seconds total
  const intervalMs = 2_000; // poll every 2 seconds
  let verified = false;
  let fee = 0n;

  const runningName = ExecutionState[ExecutionState.Running];
  const breakName = ExecutionState[ExecutionState.Break];
  const faultName = ExecutionState[ExecutionState.Fault];
  const haltName = ExecutionState[ExecutionState.Halt];

  console.log("Waiting up to 30s for transaction execution state...");

  while (Date.now() - start < timeoutMs) {
    try {
      const txInfo: TransactionData = await rpc.getTransaction(txHash);

      // Print only the state field for clarity
      console.log("getTransaction response: state:", txInfo.state);

      // txInfo.state is provided by the SDK as a string name (e.g. "Running","Halt", etc.)
      const stateStr = txInfo.state;

      if (stateStr === runningName) {
        // still running -> continue polling
      } else if (stateStr === breakName || stateStr === faultName) {
        // Break or Fault -> failure
        console.log(
          `Transaction failed: ${stateStr} result: '${txInfo.result}' debugComment: '${txInfo.debugComment}'`,
        );
        verified = true;
        fee = billedFee(txInfo);
        break;
      } else if (stateStr === haltName) {
        // Halt -> success
        console.log("Transaction succeeded");
        return { success: true, result: txInfo.result, fee: billedFee(txInfo) };
      } else {
        // Unknown state name -> log and continue polling
        console.log("Unknown ExecutionState value:", stateStr);
      }
    } catch (err) {
      // Transient RPC errors are logged and retried until timeout
      const e = err as Error;
      console.log(
        "Error while checking transaction status (will retry):",
        e && e.message ? e.message : String(err),
      );
    }

    // wait before next poll
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  if (!verified) {
    console.log(
      "Unable to verify transaction execution state within 30 seconds. Please check manually. txHash:",
      txHash,
    );
  }

  return { success: false, result: "", fee };
}
