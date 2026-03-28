import test from "node:test";
import assert from "node:assert/strict";
import { requireRpcTxHash } from "../src/rpc/txHash";

test("requireRpcTxHash returns a plain string hash unchanged", () => {
  const txHash = "ABC123";
  assert.equal(requireRpcTxHash(txHash, "deploy transaction"), txHash);
});

test("requireRpcTxHash extracts hash from object payloads", () => {
  assert.equal(
    requireRpcTxHash({ hash: "DEF456" }, "deploy transaction"),
    "DEF456",
  );
});

test("requireRpcTxHash throws a readable error for RPC error objects", () => {
  assert.throws(
    () => requireRpcTxHash({ error: "expected proof of work" }, "deploy transaction"),
    {
      message: "deploy transaction RPC error: expected proof of work",
    },
  );
});

test("requireRpcTxHash throws a readable error for unexpected RPC results", () => {
  assert.throws(
    () => requireRpcTxHash({ ok: false }, "deploy transaction"),
    {
      message: 'deploy transaction RPC returned a non-hash result: {"ok":false}',
    },
  );
});
