import assert from "node:assert/strict";
import { CarbonBlob, PhantasmaAPI, SignedTxMsg, hexToBytes } from "phantasma-sdk-ts";

export const TEST_WIF = "L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx";

// A gas model v2 gas config, in the shape `getGasConfig` answers with. It is kept verbatim, so the
// planner reads the field names, the string-encoded 64-bit values and the version tail a node
// sends.
export const GAS_CONFIG = {
  gasModelVersion: 2,
  gasConfig: {
    version: 1,
    maxNameLength: 255,
    maxTokenSymbolLength: 255,
    feeShift: 0,
    maxStructureSize: 1048576,
    feeMultiplier: "10000",
    gasTokenId: "1",
    dataTokenId: "2",
    minimumGasOffer: "10",
    dataEscrowPerRow: "50000",
    gasFeeTransfer: "10",
    gasFeeQuery: "10",
    gasFeeCreateTokenBase: "10000000000",
    gasFeeCreateTokenSymbol: "10000000000",
    gasFeeCreateTokenSeries: "2500000000",
    gasFeePerByte: "250000",
    gasFeeRegisterName: "10000000000000",
    gasBurnRatioMul: "1",
    gasBurnRatioShift: 1,
    minimumGasBill: "10000000",
    gasProducerRatioMul: "1",
    gasProducerRatioShift: 2,
    gasDappRatioMul: "1",
    gasDappRatioShift: 3,
    policyFeeCreateTokenBase: "100000000000",
    policyFeeCreateTokenSymbol: "100000000000",
    policyFeeCreateTokenSeries: "25000000000",
    policyFeeRegisterName: "1000000000000",
    legacyDataEscrowPerRow: "2",
  },
  blockRateTarget: 1000,
  expiryWindow: 3600000,
  unitsPerBlockDataByte: 25,
};

// A 1x1 transparent PNG: the metadata builder requires a base64 image data URI.
export const TOKEN_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

/** A token whose id is 42, little-endian u64, as Token.CreateToken answers. */
export const CREATE_TOKEN_RESULT = "2a00000000000000";

// Captured once, at import time: a test that stubs twice must still restore the real methods.
const PRISTINE = {
  getGasConfig: PhantasmaAPI.prototype.getGasConfig,
  getToken: PhantasmaAPI.prototype.getToken,
  sendCarbonTransaction: PhantasmaAPI.prototype.sendCarbonTransaction,
  getTransaction: PhantasmaAPI.prototype.getTransaction,
  log: console.log,
};

export interface NodeStub {
  /** Every envelope handed to sendCarbonTransaction, hex. */
  broadcast: string[];
  /** Everything the action printed. */
  output: string[];
}

/** What the node answers for a transaction that is no longer running. */
export interface SettledAnswer {
  state: string;
  result?: string;
  debugComment?: string;
  /** The fee in atoms; null as the node reports it for a transaction it never billed. */
  fee: string | null;
}

/**
 * Replaces the RPC calls the actions make with canned answers and captures both the envelopes they
 * broadcast and what they print. An action builds its own `PhantasmaAPI`, so the prototype is the
 * seam - the same one the contract-deploy tests use.
 */
export function stubNode(
  t: { after: (fn: () => void) => void },
  options: {
    gasConfig?: unknown;
    symbolTaken?: boolean;
    /** Fee the node reports for the settled transaction, in atoms. Defaults to the planned bill. */
    billedFee?: bigint;
    /** The node's answer for the sent transaction. Defaults to a Halt of Token.CreateToken. */
    settled?: SettledAnswer;
  } = {},
): NodeStub {
  const stub: NodeStub = { broadcast: [], output: [] };

  t.after(() => {
    PhantasmaAPI.prototype.getGasConfig = PRISTINE.getGasConfig;
    PhantasmaAPI.prototype.getToken = PRISTINE.getToken;
    PhantasmaAPI.prototype.sendCarbonTransaction = PRISTINE.sendCarbonTransaction;
    PhantasmaAPI.prototype.getTransaction = PRISTINE.getTransaction;
    console.log = PRISTINE.log;
  });

  PhantasmaAPI.prototype.getGasConfig = async () =>
    (options.gasConfig ?? GAS_CONFIG) as never;

  // The pre-flight asks for the symbol, then - when the symbol did not resolve - for the gas token
  // by id, which is its control that the node is answering token lookups at all.
  PhantasmaAPI.prototype.getToken = (async (
    symbol: string,
    _extended?: boolean,
    carbonTokenId?: bigint,
  ) => {
    if (carbonTokenId !== undefined && carbonTokenId !== 0n) {
      return { symbol: "KCAL", carbonId: Number(carbonTokenId) };
    }
    if (options.symbolTaken) {
      return { symbol, carbonId: 7 };
    }
    throw new Error(`token ${symbol} not found`);
  }) as never;

  PhantasmaAPI.prototype.sendCarbonTransaction = (async (txData: string) => {
    stub.broadcast.push(txData);
    return "0xdeadbeef";
  }) as never;

  PhantasmaAPI.prototype.getTransaction = (async () =>
    options.settled ?? {
      state: "Halt",
      result: CREATE_TOKEN_RESULT,
      fee: (options.billedFee ?? plannedBill(stub)).toString(),
    }) as never;

  console.log = (...args: unknown[]) => {
    stub.output.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };

  return stub;
}

/** The envelope the action broadcast (or signed, in dry-run), decoded. */
export function signedEnvelope(txHex: string): SignedTxMsg {
  return CarbonBlob.NewFromBytes(SignedTxMsg, hexToBytes(txHex), 0) as SignedTxMsg;
}

function plannedAtoms(stub: NodeStub, what: "gas bill" | "gas offer"): bigint {
  const line = stub.output.find((l) => l.includes(what));
  assert.ok(line, `the action must print the planned ${what}`);
  const atoms = /\((\d+) atoms/.exec(line);
  assert.ok(atoms, `no atom count in ${line}`);
  return BigInt(atoms[1]);
}

/** The gas offer the action said it would write into the transaction. */
export function plannedOffer(stub: NodeStub): bigint {
  return plannedAtoms(stub, "gas offer");
}

/** The bill the action predicted, which is what the chain is expected to charge. */
export function plannedBill(stub: NodeStub): bigint {
  return plannedAtoms(stub, "gas bill");
}

/** The hex the dry-run printed instead of broadcasting. */
export function dryRunEnvelope(stub: NodeStub): string {
  const line = stub.output.find((l) => l.startsWith("[dry-run] Prepared tx"));
  assert.ok(line, "the dry-run must print the prepared transaction");
  return line.slice(line.lastIndexOf(" ") + 1);
}
