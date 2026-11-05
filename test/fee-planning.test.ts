import test from "node:test";
import assert from "node:assert/strict";
import { TxTypes } from "phantasma-sdk-ts";
import { createToken, createTokenCfg } from "../src/actions/createToken";
import { Metadata } from "../src/actions/helpers";
import {
  GAS_CONFIG,
  TEST_WIF,
  TOKEN_ICON,
  dryRunEnvelope,
  plannedBill,
  plannedOffer,
  signedEnvelope,
  stubNode,
} from "./node-stub";

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

/** The gas offer of the envelope the action broadcast (or signed, in dry-run). */
function signedOffer(txHex: string): { maxGas: bigint; maxData: bigint; type: TxTypes } {
  const signed = signedEnvelope(txHex);
  return { maxGas: signed.msg.maxGas, maxData: signed.msg.maxData, type: signed.msg.type };
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
