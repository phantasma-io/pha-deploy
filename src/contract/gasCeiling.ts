import {
  Bytes32,
  ContractTxHelper,
  DomainSettings,
  PhantasmaAPI,
  TxMsg,
  TxMsgPhantasmaRaw,
  TxMsgSigner,
  TxTypes,
  bytesToHex,
  hexToBytes,
} from "phantasma-sdk-ts";

/**
 * The gas ceiling a contract lifecycle transaction offers, read from the chain.
 *
 * A token transaction is a Carbon message and the fee planner prices it. The contract lifecycle is
 * a VM script instead, and no formula prices a script. The chain still answers: its estimate
 * service dry-runs a submitted envelope and reports the bill it would settle, with a recommended
 * ceiling that carries a margin for state drift. This module asks that service, so no fee number
 * originates in this CLI.
 */

/**
 * Price used to express one ceiling as the two integers `AllowGas` takes.
 *
 * The chain multiplies the two and compares its bill against the product alone, so the split
 * carries no meaning of its own: any pair with the same product behaves identically. The value is
 * taken from the SDK so the emitted script keeps the shape other readers of this chain expect.
 */
const GAS_UNIT_PRICE = ContractTxHelper.DefaultGasPrice;

export interface GasPair {
  gasPrice: number;
  gasLimit: number;
  /** What the chain will read as the envelope ceiling: `gasPrice * gasLimit`. */
  ceiling: bigint;
}

/**
 * Splits one ceiling in gas-token atoms into the price and limit `AllowGas` takes.
 *
 * The unit count is rounded up, so the offered ceiling is never below what was asked. The rounding
 * is at most one unit, which is `GAS_UNIT_PRICE` atoms.
 */
export function gasPair(maxGas: bigint): GasPair {
  if (maxGas <= 0n) {
    throw new Error("the gas ceiling must be a positive number of atoms");
  }
  const price = BigInt(GAS_UNIT_PRICE);
  const units = (maxGas + price - 1n) / price;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `the gas ceiling ${maxGas} atoms is too large to express as whole gas units`,
    );
  }
  return {
    gasPrice: GAS_UNIT_PRICE,
    gasLimit: Number(units),
    ceiling: units * price,
  };
}

/**
 * Returns the payer's whole gas token balance, in atoms.
 *
 * The estimate executes the envelope against the payer's real balance, so an envelope that offers
 * more than the payer holds is refused instead of priced. The balance is therefore the largest
 * ceiling worth probing with, and it follows the chain rather than a number chosen here.
 */
export async function payerGasBalance(
  api: PhantasmaAPI,
  address: string,
): Promise<bigint> {
  const symbol = DomainSettings.FuelTokenSymbol;
  const page = await api.getAccountFungibleTokens(address, symbol, 0n, 1);
  const holding = page.result?.find((entry) => entry.symbol === symbol);
  const amount = holding ? BigInt(holding.amount) : 0n;
  if (amount <= 0n) {
    throw new Error(
      `${address} holds no ${symbol}, so it cannot pay for a contract transaction`,
    );
  }
  return ceilingWithin(amount);
}

/**
 * Largest ceiling that can be offered out of `balance`.
 *
 * `gasPair` rounds the unit count up, so a ceiling equal to the balance to the atom escrows one
 * unit more than the payer holds, and the chain refuses the envelope for lack of gas. The balance
 * is rounded down to whole units instead.
 */
export function ceilingWithin(balance: bigint): bigint {
  const price = BigInt(GAS_UNIT_PRICE);
  const units = balance / price;
  if (units <= 0n) {
    throw new Error(
      `a balance of ${balance} atoms is below one gas unit, so it cannot pay for a contract transaction`,
    );
  }
  return units * price;
}

export interface EstimatedGasCeiling {
  /** The recommended ceiling, in gas-token atoms. It is the bill plus the service's margin. */
  maxGas: bigint;
  /** The bill the dry run settled. The real transaction should come in at or below it. */
  expectedBill: bigint;
  /** Storage rows the transaction grows. The escrow for them is paid on top of the gas bill. */
  dataRows: bigint;
  /** Storage escrow in data-token atoms. This path declares no ceiling for it. */
  dataEscrow: bigint;
}

export interface EstimateRequest {
  /** The signed lifecycle transaction, as `sendRawTransaction` would take it. */
  txHex: string;
  /** Expiry of that transaction. The chain checks the outer envelope's expiry before it converts it. */
  expiration: Date;
  /** Public key of the payer, for the envelope's gas-payer field. */
  publicKey: Uint8Array;
  /** Ceiling the probe transaction offers. Below the bill the service reports no recommendation. */
  offered: bigint;
}

/**
 * Asks the chain what the given lifecycle transaction would cost.
 *
 * The transaction is wrapped in a Carbon envelope of type `Phantasma_Raw`, which is the same
 * envelope the node builds around anything sent through `sendRawTransaction`. The envelope carries
 * no witnesses of its own, because the signature sits on the transaction inside it.
 *
 * Nothing is broadcast. The service executes the envelope in a throwaway change set.
 */
export async function estimateGasCeiling(
  api: PhantasmaAPI,
  request: EstimateRequest,
): Promise<EstimatedGasCeiling> {
  const msg = new TxMsg(
    TxTypes.Phantasma_Raw,
    // The chain stores milliseconds and the transaction states seconds.
    BigInt(Math.floor(request.expiration.getTime() / 1000)) * 1000n,
    request.offered,
    // maxData: the conversion replaces it, because a VM script cannot declare a storage ceiling.
    0n,
    new Bytes32(request.publicKey),
    undefined,
    new TxMsgPhantasmaRaw(hexToBytes(request.txHex)),
  );
  const envelope = bytesToHex(TxMsgSigner.signAndSerializeWithKeys(msg, []));

  let result;
  try {
    result = await api.estimateTransaction(envelope);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `the chain's fee estimate is unavailable, so the gas ceiling cannot be read from it. ` +
        `Pass --max-gas <${DomainSettings.FuelTokenSymbol}> to set the ceiling by hand. ` +
        `The node answered: ${reason}`,
    );
  }

  if (result.wouldAbort) {
    throw new Error(
      `the chain's fee estimate says this transaction would abort, so it reports no ceiling. ` +
        `Fix the cause, or pass --max-gas <${DomainSettings.FuelTokenSymbol}> to send it anyway. ` +
        `The chain answered: ${result.abortReason ?? "no reason given"}`,
    );
  }

  return {
    maxGas: BigInt(result.recommendedMaxGas),
    expectedBill: BigInt(result.gasBillKcalBase),
    dataRows: BigInt(result.dataRows),
    dataEscrow: BigInt(result.dataEscrowAtoms),
  };
}
