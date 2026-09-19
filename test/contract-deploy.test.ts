import test from "node:test";
import assert from "node:assert/strict";
import {
  PhantasmaAPI,
  ScriptBuilder,
  type ContractArtifactBundle,
} from "phantasma-sdk-ts";
import {
  executeContractTransaction,
  prepareContractTransaction,
} from "../src/contract/deploy";
import { gasPair } from "../src/contract/gasCeiling";

const TEST_WIF = "L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx";

// A ceiling in gas-token atoms, large enough to look like a real deployment on a v2 chain.
const CEILING = 100_010_000_000_000n;

function sampleBundle(): ContractArtifactBundle {
  return {
    contractName: "sample",
    script: new Uint8Array([0xca, 0xfe]),
    abi: new Uint8Array([0xde, 0xad]),
  } as ContractArtifactBundle;
}

/**
 * Answers the two calls the estimate path makes, so no test reaches a node.
 *
 * `estimate` is the reply of the estimate service. Passing `null` makes the service unavailable,
 * which is how a node that does not serve estimates behaves.
 */
function stubChain(
  t: { after: (fn: () => void) => void },
  estimate: Record<string, unknown> | null,
  balance = "900000000000000000",
) {
  const calls = { estimates: 0, balances: 0 };
  const originalBalances = PhantasmaAPI.prototype.getAccountFungibleTokens;
  const originalEstimate = PhantasmaAPI.prototype.estimateTransaction;
  PhantasmaAPI.prototype.getAccountFungibleTokens = async () => {
    calls.balances += 1;
    return { result: [{ chain: "main", amount: balance, symbol: "KCAL", decimals: 10 }] };
  };
  PhantasmaAPI.prototype.estimateTransaction = async () => {
    calls.estimates += 1;
    if (estimate === null) {
      throw new Error("Estimate service unavailable: no query-plane node");
    }
    return estimate as never;
  };
  t.after(() => {
    PhantasmaAPI.prototype.getAccountFungibleTokens = originalBalances;
    PhantasmaAPI.prototype.estimateTransaction = originalEstimate;
  });
  return calls;
}

function estimateReply(recommendedMaxGas: string) {
  return {
    wouldAbort: false,
    gasBillKcalBase: "100049029975000",
    dataRows: "5",
    dataEscrowAtoms: "1000000",
    recommendedMaxGas,
    recommendedMaxData: "0",
  };
}

test("gasPair rounds the unit count up so the offered ceiling is never below what was asked", () => {
  const exact = gasPair(200_000n);
  assert.equal(exact.gasLimit, 2);
  assert.equal(exact.ceiling, 200_000n);

  const rounded = gasPair(200_001n);
  assert.equal(rounded.gasLimit, 3);
  assert.equal(rounded.ceiling, 300_000n);
  assert.ok(rounded.ceiling > 200_001n);
});

test("gasPair refuses a ceiling it cannot express in whole gas units", () => {
  assert.throws(() => gasPair(0n), /positive/);
  assert.throws(() => gasPair(-1n), /positive/);
  // Past this size the unit count no longer fits the integer range the SDK accepts.
  assert.throws(() => gasPair(10n ** 24n), /too large/);
});

test("the gas ceiling comes from the chain's estimate when the caller names none", async (t) => {
  const calls = stubChain(t, estimateReply("115056384471250"));
  const originalSend = PhantasmaAPI.prototype.sendRawTransaction;
  PhantasmaAPI.prototype.sendRawTransaction = async () =>
    ({ error: "expected proof of work" } as unknown as string);
  t.after(() => {
    PhantasmaAPI.prototype.sendRawTransaction = originalSend;
  });

  const result = await executeContractTransaction({
    operation: "deploy",
    rpc: "http://localhost:5172/rpc",
    nexus: "SIMNET",
    chain: "main",
    wif: TEST_WIF,
    bundle: sampleBundle(),
    proofOfWork: 0,
  });

  assert.equal(calls.estimates, 1);
  assert.equal(calls.balances, 1);
  assert.equal(result.estimate?.maxGas, 115056384471250n);
  assert.equal(result.estimate?.expectedBill, 100049029975000n);
  assert.equal(result.estimate?.dataRows, 5n);
  // The offered ceiling is the recommendation, rounded up to whole gas units.
  assert.ok(result.prepared.gasCeiling >= 115056384471250n);
  assert.ok(result.prepared.gasCeiling < 115056384471250n + 100_000n);
});

test("a ceiling named by the caller is used and the chain is not asked", async (t) => {
  const calls = stubChain(t, null);
  const originalSend = PhantasmaAPI.prototype.sendRawTransaction;
  PhantasmaAPI.prototype.sendRawTransaction = async () =>
    ({ error: "expected proof of work" } as unknown as string);
  t.after(() => {
    PhantasmaAPI.prototype.sendRawTransaction = originalSend;
  });

  const result = await executeContractTransaction({
    operation: "deploy",
    rpc: "http://localhost:5172/rpc",
    nexus: "SIMNET",
    chain: "main",
    wif: TEST_WIF,
    bundle: sampleBundle(),
    maxGas: CEILING,
    proofOfWork: 0,
  });

  assert.equal(calls.estimates, 0);
  assert.equal(calls.balances, 0);
  assert.equal(result.estimate, undefined);
  assert.equal(result.prepared.gasCeiling, CEILING);
});

test("an unavailable estimate service names the flag that replaces it", async (t) => {
  stubChain(t, null);

  await assert.rejects(
    executeContractTransaction({
      operation: "deploy",
      rpc: "http://localhost:5172/rpc",
      nexus: "SIMNET",
      chain: "main",
      wif: TEST_WIF,
      bundle: sampleBundle(),
      proofOfWork: 0,
    }),
    (err: Error) => {
      assert.match(err.message, /estimate is unavailable/);
      assert.match(err.message, /--max-gas/);
      assert.match(err.message, /no query-plane node/);
      return true;
    },
  );
});

test("an estimate that would abort is reported with the chain's own reason", async (t) => {
  stubChain(t, {
    wouldAbort: true,
    abortReason: "sample is already deployed",
    gasBillKcalBase: "0",
    dataRows: "0",
    dataEscrowAtoms: "0",
    recommendedMaxGas: "0",
    recommendedMaxData: "0",
  });

  await assert.rejects(
    executeContractTransaction({
      operation: "deploy",
      rpc: "http://localhost:5172/rpc",
      nexus: "SIMNET",
      chain: "main",
      wif: TEST_WIF,
      bundle: sampleBundle(),
      proofOfWork: 0,
    }),
    (err: Error) => {
      assert.match(err.message, /would abort/);
      assert.match(err.message, /--max-gas/);
      assert.match(err.message, /sample is already deployed/);
      return true;
    },
  );
});

test("executeContractTransaction preserves prepared payloads on RPC broadcast rejects", async (t) => {
  stubChain(t, estimateReply("115056384471250"));
  const originalSendRawTransaction = PhantasmaAPI.prototype.sendRawTransaction;
  PhantasmaAPI.prototype.sendRawTransaction = async () =>
    ({ error: "expected proof of work" } as unknown as string);
  t.after(() => {
    PhantasmaAPI.prototype.sendRawTransaction = originalSendRawTransaction;
  });

  const result = await executeContractTransaction({
    operation: "deploy",
    rpc: "http://localhost:5172/rpc",
    nexus: "SIMNET",
    chain: "main",
    wif: TEST_WIF,
    bundle: sampleBundle(),
    proofOfWork: 5,
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.success, false);
  assert.equal(
    result.broadcastError,
    "deploy transaction RPC error: expected proof of work",
  );
  assert.equal(result.txHash, undefined);
  assert.equal(result.prepared.contractName, "sample");
  assert.match(result.prepared.scriptHex, /^[0-9A-F]+$/);
  assert.match(result.prepared.txHex, /^[0-9A-F]+$/);
});

test("prepareContractTransaction builds attach scripts with an explicit symbol", () => {
  const bundle = sampleBundle();
  const prepared = prepareContractTransaction(
    {
      operation: "attach",
      rpc: "http://localhost:5172/rpc",
      nexus: "SIMNET",
      chain: "main",
      wif: TEST_WIF,
      bundle,
      proofOfWork: 0,
      attachSymbol: "TOK",
    },
    CEILING,
  );

  const fromAddress = prepared.fromAddress;
  const { gasPrice, gasLimit } = gasPair(CEILING);
  const manualScript = new ScriptBuilder()
    .BeginScript()
    .AllowGas(fromAddress, new ScriptBuilder().NullAddress, gasPrice, gasLimit)
    .CallInterop("Nexus.AttachTokenContract", [
      fromAddress,
      "TOK",
      bundle.script,
      bundle.abi,
    ])
    .SpendGas(fromAddress)
    .EndScript();

  assert.equal(prepared.attachSymbol, "TOK");
  assert.equal(prepared.scriptHex, manualScript);
  assert.equal(prepared.gasCeiling, CEILING);
  assert.match(prepared.txHex, /^[0-9A-F]+$/);
});

test("prepareContractTransaction defaults attach symbol to the bundle contract name", () => {
  const prepared = prepareContractTransaction(
    {
      operation: "attach",
      rpc: "http://localhost:5172/rpc",
      nexus: "SIMNET",
      chain: "main",
      wif: TEST_WIF,
      bundle: sampleBundle(),
      proofOfWork: 0,
    },
    CEILING,
  );

  assert.equal(prepared.attachSymbol, "sample");
});

test("executeContractTransaction preserves attach payloads on RPC broadcast rejects", async (t) => {
  stubChain(t, estimateReply("115056384471250"));
  const originalSendRawTransaction = PhantasmaAPI.prototype.sendRawTransaction;
  PhantasmaAPI.prototype.sendRawTransaction = async () =>
    ({ error: "expected proof of work" } as unknown as string);
  t.after(() => {
    PhantasmaAPI.prototype.sendRawTransaction = originalSendRawTransaction;
  });

  const result = await executeContractTransaction({
    operation: "attach",
    rpc: "http://localhost:5172/rpc",
    nexus: "SIMNET",
    chain: "main",
    wif: TEST_WIF,
    bundle: sampleBundle(),
    proofOfWork: 5,
    attachSymbol: "TOK",
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.success, false);
  assert.equal(
    result.broadcastError,
    "attach transaction RPC error: expected proof of work",
  );
  assert.equal(result.txHash, undefined);
  assert.equal(result.prepared.contractName, "sample");
  assert.equal(result.prepared.attachSymbol, "TOK");
  assert.match(result.prepared.scriptHex, /^[0-9A-F]+$/);
  assert.match(result.prepared.txHex, /^[0-9A-F]+$/);
});
