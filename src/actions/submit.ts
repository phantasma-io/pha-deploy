import {
  CarbonBlob,
  DomainSettings,
  FeePlan,
  PhantasmaAPI,
  PhantasmaKeys,
  PlanRequestOptions,
  SignedTxMsg,
  TxMsg,
  TxMsgSigner,
  bytesToHex,
  formatUnits,
  hexToBytes,
  summarizeFeePlan,
} from "phantasma-sdk-ts";
import { formatForLog } from "./helpers";
import { SettledTx, waitForTx } from "./waitForTx";

export interface SubmitOptions {
  rpc: PhantasmaAPI;
  signer: PhantasmaKeys;
  /** The freshly built message. It carries no fee yet. This function plans one for it. */
  msg: TxMsg;
  dryRun: boolean;
  /**
   * Facts about chain state that the message does not carry. Each one defaults to the reading that
   * costs more. An action that knows nothing extra passes nothing here.
   */
  planOptions?: PlanRequestOptions;
}

/**
 * Plans the fee of a message against the chain, prints the plan and sends the message. In dry-run
 * it prints the envelope it would have sent and broadcasts nothing.
 *
 * Under gas model v2 a transaction carries a gas offer and a storage escrow ceiling. Both are
 * written before the message is signed. Both come from the chain's own prices applied to this
 * exact message. A constant set by hand can only offer too little, and the chain takes the whole
 * offer for a transaction that aborts. So no fee number comes from this CLI or from its config
 * file.
 *
 * Returns the settled transaction. Returns `null` in dry-run.
 */
export async function planAndSubmit(
  options: SubmitOptions,
): Promise<(SettledTx & { txHash: string }) | null> {
  const { rpc, signer, msg, dryRun } = options;

  // Call, Call_Multi, Trade and Phantasma take their witness count from the caller, because the
  // message itself does not say how many signatures it will carry. Every message this CLI builds
  // is signed by the one key it holds, so that count is 1. A native type fixes its own witness
  // set, and passing a count for one of them is an error.
  const openWitnessSet = SignedTxMsg.requiredWitnesses(msg) === undefined;
  const plan = await rpc.fees.plan(msg, {
    ...(openWitnessSet ? { witnessCount: 1 } : {}),
    ...options.planOptions,
  });
  printFeePlan(plan);

  const planned = plan.apply(msg);

  if (dryRun) {
    const txHex = bytesToHex(TxMsgSigner.signAndSerializeWithKeys(planned, [signer]));
    console.log(`[dry-run] Prepared tx (not sent): ${txHex}`);
    console.log(formatForLog(CarbonBlob.NewFromBytes(SignedTxMsg, hexToBytes(txHex), 0)));
    return null;
  }

  console.log("Broadcasting transaction...");

  // The message already carries its plan, so `sendTransaction` sends it with the offer printed
  // above. It still runs the pre-flight. The pre-flight stops a token creation whose symbol is
  // taken, because such a creation pays the policy fee and creates no token.
  const txHash = await rpc.sendTransaction(planned, signer);
  console.log("txHash: ", txHash);

  const settled = await waitForTx(rpc, txHash);
  reportBill(plan, settled);
  return { ...settled, txHash };
}

function printFeePlan(plan: FeePlan): void {
  const shown = summarizeFeePlan(plan);
  console.log(
    [
      `Fee plan: ${plan.kinds.join(", ")}, envelope ${plan.envelopeBytes} bytes`,
      // `exact` is true when the plan predicts the bill. It is false when the plan is an upper
      // bound, and the settlement can then come out below it. The printed line says which of the
      // two this number is.
      `  gas bill        ${plan.exact ? "" : "up to "}${shown.gasBill} KCAL (${plan.expectedGasBill} atoms)`,
      `  gas offer       ${shown.gasOffer} KCAL (${plan.maxGas} atoms)`,
      `  storage deposit ${shown.storageCeiling} SOUL (${plan.maxData} atoms, ` +
        `${plan.newStorageQuanta} quanta, refunded when the rows are deleted)`,
    ].join("\n"),
  );
}

function reportBill(plan: FeePlan, settled: SettledTx): void {
  if (settled.fee === 0n) {
    return;
  }

  const billed = `${formatUnits(settled.fee, DomainSettings.FuelTokenDecimals)} KCAL (${settled.fee} atoms)`;
  // The plan is exact for an operation the chain prices with a formula. It is an upper bound when
  // the planner had to assume a chain-state fact. So a bill below the plan is expected. A bill
  // above the plan means the plan priced the operation wrongly.
  const against =
    settled.fee === plan.expectedGasBill
      ? "exactly as planned"
      : `planned ${plan.expectedGasBill} atoms`;
  console.log(`Gas billed: ${billed} - ${against}`);
}
