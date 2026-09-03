import test from "node:test";
import assert from "node:assert/strict";
import {
  CarbonBlob,
  PhantasmaAPI,
  SignedTxMsg,
  TxTypes,
  hexToBytes,
} from "phantasma-sdk-ts";
import { createToken, createTokenCfg } from "../src/actions/createToken";
import { Metadata } from "../src/actions/helpers";

const TEST_WIF = "L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx";

// A gas model v2 gas config, in the shape `getGasConfig` answers with. It is kept verbatim, so the
// planner reads the field names, the string-encoded 64-bit values and the version tail a node
// sends.
const GAS_CONFIG = {
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
const TOKEN_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

/** A token whose id is 42, little-endian u64, as Token.CreateToken answers. */
const CREATE_TOKEN_RESULT = "2a00000000000000";

function fungibleCfg(): createTokenCfg {
  return new createTokenCfg(
    "http://localhost:5172/rpc",
    "simnet",
    TEST_WIF,
    "FEEPLAN",
    null,
    new Metadata(
      {
        name: "Fee planning token",
        description: "unit test",
        url: "http://example.invalid",
        icon: TOKEN_ICON,
      },
      "token_metadata",
    ),
    "fungible",
    1000000000000n,
    8,
  );
}

// Captured once, at import time: a test that stubs twice must still restore the real methods.
const PRISTINE = {
  getGasConfig: PhantasmaAPI.prototype.getGasConfig,
  getToken: PhantasmaAPI.prototype.getToken,
  sendCarbonTransaction: PhantasmaAPI.prototype.sendCarbonTransaction,
  getTransaction: PhantasmaAPI.prototype.getTransaction,
  log: console.log,
};

interface NodeStub {
  /** Every envelope handed to sendCarbonTransaction, hex. */
  broadcast: string[];
  /** Everything the action printed. */
  output: string[];
}

/**
 * Replaces the RPC calls the action makes with canned answers and captures both the envelopes it
 * broadcasts and what it prints. The action builds its own `PhantasmaAPI`, so the prototype is the
 * seam - the same one the contract-deploy tests use.
 */
function stubNode(
  t: { after: (fn: () => void) => void },
  options: {
    gasConfig?: unknown;
    symbolTaken?: boolean;
    /** Fee the node reports for the settled transaction, in atoms. Defaults to the planned bill. */
    billedFee?: bigint;
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

  PhantasmaAPI.prototype.getTransaction = (async () => ({
    state: "Halt",
    result: CREATE_TOKEN_RESULT,
    fee: (options.billedFee ?? plannedBill(stub)).toString(),
  })) as never;

  console.log = (...args: unknown[]) => {
    stub.output.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };

  return stub;
}

/** The gas offer of the envelope the action broadcast (or signed, in dry-run). */
function signedOffer(txHex: string): { maxGas: bigint; maxData: bigint; type: TxTypes } {
  const signed = CarbonBlob.NewFromBytes(SignedTxMsg, hexToBytes(txHex), 0) as SignedTxMsg;
  return { maxGas: signed.msg.maxGas, maxData: signed.msg.maxData, type: signed.msg.type };
}

function plannedAtoms(stub: NodeStub, what: "gas bill" | "gas offer"): bigint {
  const line = stub.output.find((l) => l.includes(what));
  assert.ok(line, `the action must print the planned ${what}`);
  const atoms = /\((\d+) atoms/.exec(line);
  assert.ok(atoms, `no atom count in ${line}`);
  return BigInt(atoms[1]);
}

/** The gas offer the action said it would write into the transaction. */
function plannedOffer(stub: NodeStub): bigint {
  return plannedAtoms(stub, "gas offer");
}

/** The bill the action predicted, which is what the chain is expected to charge. */
function plannedBill(stub: NodeStub): bigint {
  return plannedAtoms(stub, "gas bill");
}

/** The hex the dry-run printed instead of broadcasting. */
function dryRunEnvelope(stub: NodeStub): string {
  const line = stub.output.find((l) => l.startsWith("[dry-run] Prepared tx"));
  assert.ok(line, "the dry-run must print the prepared transaction");
  return line.slice(line.lastIndexOf(" ") + 1);
}

test("a dry-run plans the fee from the chain and signs the offer it printed", async (t) => {
  const stub = stubNode(t);

  await createToken(fungibleCfg(), true);

  assert.equal(stub.broadcast.length, 0, "a dry-run must broadcast nothing");
  const signed = signedOffer(dryRunEnvelope(stub));
  assert.equal(signed.type, TxTypes.Call);
  // A message signed with a zero offer is never admitted by the chain, so the offer the CLI signs
  // has to be the one it planned - and the one it showed the operator.
  assert.notEqual(signed.maxGas, 0n);
  assert.equal(signed.maxGas, plannedOffer(stub));
  assert.notEqual(signed.maxData, 0n, "a token creation writes a row, so it escrows one");
});

test("a token creation is sent with the planned offer and reports what it was billed", async (t) => {
  const stub = stubNode(t);

  await createToken(fungibleCfg(), false);

  assert.equal(stub.broadcast.length, 1);
  const signed = signedOffer(stub.broadcast[0]);
  assert.equal(signed.maxGas, plannedOffer(stub));
  assert.ok(
    stub.output.some(
      (l) =>
        l.startsWith(`Gas billed:`) &&
        l.endsWith(`(${plannedBill(stub)} atoms) - exactly as planned`),
    ),
    `expected the settled bill to be reported as planned, got: ${stub.output.join(" | ")}`,
  );
  assert.ok(stub.output.some((l) => l.includes("Deployed carbon token ID: 42")));
});

test("the reported bill names the plan when the chain billed something else", async (t) => {
  const stub = stubNode(t, { billedFee: 12345n });

  await createToken(fungibleCfg(), false);

  assert.ok(
    stub.output.some(
      (l) => l === `Gas billed: 0.0000012345 KCAL (12345 atoms) - planned ${plannedBill(stub)} atoms`,
    ),
    `expected the plan to be named next to the bill, got: ${stub.output.join(" | ")}`,
  );
});

test("the offer follows the chain's prices instead of a constant", async (t) => {
  const cheap = stubNode(t);
  await createToken(fungibleCfg(), true);
  const cheapOffer = signedOffer(dryRunEnvelope(cheap)).maxGas;

  // Same message, same size, a chain that charges ten times as much per gas unit.
  const dear = stubNode(t, {
    gasConfig: {
      ...GAS_CONFIG,
      gasConfig: { ...GAS_CONFIG.gasConfig, feeMultiplier: "100000" },
    },
  });
  await createToken(fungibleCfg(), true);
  const dearOffer = signedOffer(dryRunEnvelope(dear)).maxGas;

  assert.ok(
    dearOffer > cheapOffer,
    `a ten-fold price rise must raise the offer: ${dearOffer} vs ${cheapOffer}`,
  );
});

test("a token creation whose symbol is taken is refused before it is signed", async (t) => {
  const stub = stubNode(t, { symbolTaken: true });

  await assert.rejects(createToken(fungibleCfg(), false), /already taken/);

  // The policy fee of Token.CreateToken is charged before the contract looks at the symbol, so the
  // whole point of the pre-flight is that nothing goes out.
  assert.equal(stub.broadcast.length, 0);
});
