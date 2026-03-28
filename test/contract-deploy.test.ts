import test from "node:test";
import assert from "node:assert/strict";
import {
  PhantasmaAPI,
  type ContractArtifactBundle,
} from "phantasma-sdk-ts";
import { executeContractTransaction } from "../src/contract/deploy";

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
