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

const TEST_WIF = "L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx";

test("executeContractTransaction preserves prepared payloads on RPC broadcast rejects", async (t) => {
  const originalSendRawTransaction = PhantasmaAPI.prototype.sendRawTransaction;
  PhantasmaAPI.prototype.sendRawTransaction = async () =>
    ({ error: "expected proof of work" } as unknown as string);
  t.after(() => {
    PhantasmaAPI.prototype.sendRawTransaction = originalSendRawTransaction;
  });

  const bundle = {
    contractName: "sample",
    script: new Uint8Array([0xca, 0xfe]),
    abi: new Uint8Array([0xde, 0xad]),
  } as ContractArtifactBundle;

  const result = await executeContractTransaction({
    operation: "deploy",
    rpc: "http://localhost:5172/rpc",
    nexus: "SIMNET",
    chain: "main",
    wif: TEST_WIF,
    bundle,
    gasPrice: 100000,
    gasLimit: 1000100000,
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
  const bundle = {
    contractName: "sample",
    script: new Uint8Array([0xca, 0xfe]),
    abi: new Uint8Array([0xde, 0xad]),
  } as ContractArtifactBundle;

  const prepared = prepareContractTransaction({
    operation: "attach",
    rpc: "http://localhost:5172/rpc",
    nexus: "SIMNET",
    chain: "main",
    wif: TEST_WIF,
    bundle,
    gasPrice: 100000,
    gasLimit: 100000,
    proofOfWork: 0,
    attachSymbol: "TOK",
  });

  const fromAddress = prepared.fromAddress;
  const manualScript = new ScriptBuilder()
    .BeginScript()
    .AllowGas(fromAddress, new ScriptBuilder().NullAddress, 100000, 100000)
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
  assert.match(prepared.txHex, /^[0-9A-F]+$/);
});

test("prepareContractTransaction defaults attach symbol to the bundle contract name", () => {
  const bundle = {
    contractName: "sample",
    script: new Uint8Array([0xca, 0xfe]),
    abi: new Uint8Array([0xde, 0xad]),
  } as ContractArtifactBundle;

  const prepared = prepareContractTransaction({
    operation: "attach",
    rpc: "http://localhost:5172/rpc",
    nexus: "SIMNET",
    chain: "main",
    wif: TEST_WIF,
    bundle,
    proofOfWork: 0,
  });

  assert.equal(prepared.attachSymbol, "sample");
});

test("executeContractTransaction preserves attach payloads on RPC broadcast rejects", async (t) => {
  const originalSendRawTransaction = PhantasmaAPI.prototype.sendRawTransaction;
  PhantasmaAPI.prototype.sendRawTransaction = async () =>
    ({ error: "expected proof of work" } as unknown as string);
  t.after(() => {
    PhantasmaAPI.prototype.sendRawTransaction = originalSendRawTransaction;
  });

  const bundle = {
    contractName: "sample",
    script: new Uint8Array([0xca, 0xfe]),
    abi: new Uint8Array([0xde, 0xad]),
  } as ContractArtifactBundle;

  const result = await executeContractTransaction({
    operation: "attach",
    rpc: "http://localhost:5172/rpc",
    nexus: "SIMNET",
    chain: "main",
    wif: TEST_WIF,
    bundle,
    gasPrice: 100000,
    gasLimit: 1000100000,
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
