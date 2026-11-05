import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CarbonBinaryReader,
  ModuleId,
  StandardMeta,
  TokenContractMethods,
  TokenInfo,
  TxMsgCall,
  TxTypes,
  VmDynamicStruct,
  VmType,
} from "phantasma-sdk-ts";
import { loadConfig } from "../src/config";
import { createToken, createTokenCfg } from "../src/actions/createToken";
import { sealTokenContract, sealTokenContractCfg } from "../src/actions/sealTokenContract";
import { Metadata, MetadataFields } from "../src/actions/helpers";
import {
  TEST_WIF,
  TOKEN_ICON,
  dryRunEnvelope,
  plannedBill,
  plannedOffer,
  signedEnvelope,
  stubNode,
} from "./node-stub";

// The contract seal of a token is its metadata field `_sealed_c` holding the Int64 1: such a token
// never gets a VM contract, and the seal cannot be removed. The CLI sets it at creation
// (`--token-contract-sealed`) or later (`--seal-token-contract`), and nowhere else.

const TOKEN_METADATA: MetadataFields = {
  name: "Seal test token",
  description: "unit test",
  url: "http://example.invalid",
  icon: TOKEN_ICON,
};

function tokenCfg(contractSealed: boolean, fields: MetadataFields = TOKEN_METADATA): createTokenCfg {
  return new createTokenCfg(
    "http://localhost:5172/rpc",
    "simnet",
    TEST_WIF,
    "SEALED",
    null,
    new Metadata(fields, "token_metadata"),
    "fungible",
    1000000000000n,
    8,
    contractSealed,
  );
}

function sealCfg(): sealTokenContractCfg {
  return new sealTokenContractCfg("http://localhost:5172/rpc", "simnet", TEST_WIF, 42n);
}

/** The metadata of the token that a Token.CreateToken envelope creates. */
function createdMetadata(txHex: string): VmDynamicStruct {
  const call = signedEnvelope(txHex).msg.msg as TxMsgCall;
  const info = TokenInfo.read(new CarbonBinaryReader(call.args));
  return VmDynamicStruct.read(new CarbonBinaryReader(info.metadata));
}

test("a contract-sealed creation writes _sealed_c as the Int64 1 into the token's metadata", async (t) => {
  const stub = stubNode(t);

  await createToken(tokenCfg(true), true);

  const sealed = createdMetadata(dryRunEnvelope(stub)).getValue(StandardMeta.Token.sealed_contract);
  assert.equal(sealed?.type, VmType.Int64);
  assert.equal(sealed?.data, 1n);
});

test("a creation without the flag writes no seal", async (t) => {
  const stub = stubNode(t);

  await createToken(tokenCfg(false), true);

  assert.equal(
    createdMetadata(dryRunEnvelope(stub)).getValue(StandardMeta.Token.sealed_contract),
    undefined,
  );
});

test("_sealed_c in token_metadata is refused before signing, and the refusal names the flag", async (t) => {
  const stub = stubNode(t);

  for (const value of ["1", 1]) {
    await assert.rejects(
      createToken(tokenCfg(false, { ...TOKEN_METADATA, _sealed_c: value }), false),
      /--token-contract-sealed/,
    );
  }

  assert.equal(stub.broadcast.length, 0);
});

test("a contract seal is Token.UpdateTokenMetadata of the token id with _sealed_c alone", async (t) => {
  const stub = stubNode(t);

  await sealTokenContract(sealCfg(), true);

  const signed = signedEnvelope(dryRunEnvelope(stub));
  assert.equal(signed.msg.type, TxTypes.Call);
  const call = signed.msg.msg as TxMsgCall;
  assert.equal(call.moduleId, ModuleId.Token);
  assert.equal(call.methodId, TokenContractMethods.UpdateTokenMetadata);

  // The chain merges an update into the stored metadata, so an update that holds the seal alone
  // leaves every other field as it is.
  const args = new CarbonBinaryReader(call.args);
  assert.equal(args.read8u(), 42n);
  const update = VmDynamicStruct.read(args);
  assert.equal(args.readRemaining().length, 0);
  assert.equal(update.fields.length, 1);
  assert.equal(update.getValue(StandardMeta.Token.sealed_contract)?.type, VmType.Int64);
  assert.equal(update.getValue(StandardMeta.Token.sealed_contract)?.data, 1n);

  assert.equal(signed.msg.maxGas, plannedOffer(stub));
  // No formula prices this call, so its plan is a ceiling and is printed as one.
  assert.ok(
    stub.output.some((l) => /gas bill\s+up to /.test(l)),
    `expected the bill to be printed as a ceiling, got: ${stub.output.join(" | ")}`,
  );
});

test("a contract seal that settles names the token and the plan beside the lower bill", async (t) => {
  const stub = stubNode(t, { settled: { state: "Halt", result: "", fee: "49850000" } });

  await sealTokenContract(sealCfg(), false);

  assert.equal(stub.broadcast.length, 1);
  assert.ok(stub.output.includes("Contract-sealed carbon token ID: 42"));
  assert.ok(
    stub.output.some(
      (l) =>
        l.startsWith("Gas billed:") &&
        l.endsWith(`(49850000 atoms) - planned ${plannedBill(stub)} atoms`),
    ),
    `expected the bill next to the plan, got: ${stub.output.join(" | ")}`,
  );
});

test("a contract seal the chain refuses is reported with the chain's reason and without a bill", async (t) => {
  const stub = stubNode(t, {
    settled: {
      state: "Fault",
      result: "",
      debugComment: "SEALED has a contract and cannot be sealed",
      fee: null,
    },
  });

  await sealTokenContract(sealCfg(), false);

  assert.ok(stub.output.includes("Could not seal token against contracts"));
  assert.ok(!stub.output.some((l) => l.startsWith("Contract-sealed carbon token ID")));
  assert.ok(stub.output.some((l) => l.includes("has a contract and cannot be sealed")));
  assert.ok(!stub.output.some((l) => l.startsWith("Gas billed:")));
});

test("token_contract_sealed comes from the flag or the config, and only true or false is read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-seal-"));
  const toml = path.join(dir, "config.toml");
  const noFile = path.join(dir, "absent.toml");
  const read = (argv: string[], configPath: string) =>
    loadConfig({ argv, configPath }).tokenContractSealed;

  assert.equal(read([], noFile), null);
  assert.equal(read(["--token-contract-sealed"], noFile), true);
  assert.equal(read(["--token-contract-sealed", "false"], noFile), false);

  fs.writeFileSync(toml, "token_contract_sealed = true\n");
  assert.equal(read([], toml), true);
  assert.equal(read(["--no-token-contract-sealed"], toml), false);

  for (const value of ['"yes"', "1"]) {
    fs.writeFileSync(toml, `token_contract_sealed = ${value}\n`);
    assert.throws(() => read([], toml), /token_contract_sealed must be true or false/);
  }

  fs.rmSync(dir, { recursive: true, force: true });
});
