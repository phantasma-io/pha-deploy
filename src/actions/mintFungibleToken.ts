import {
  Address,
  Bytes32,
  CarbonBinaryReader,
  hexToBytes,
  IntX,
  NativeTxHelper,
  PhantasmaAPI,
  PhantasmaKeys,
} from "phantasma-sdk-ts";
import { planAndSubmit } from "./submit";
import { bigintReplacer } from "./helpers";

export class mintFungibleTokenCfg {
  constructor(
    public rpc: string,
    public nexus: string,
    public wif: string,
    public carbonTokenId: bigint,
    public to: string,
    public amount: bigint,
  ) {
    this.rpc = rpc;
    this.nexus = nexus;
    this.wif = wif;
    this.carbonTokenId = carbonTokenId;
    this.to = to;
    this.amount = amount;
  }

  toPrintable() {
    // Do not leak WIF; derive owner address.
    const { wif: _omit, ...rest } = this;
    const owner = PhantasmaKeys.fromWIF(this.wif).Address.toString();

    return {
      ...rest,
      owner,
    };
  }
}

export async function mintFungibleToken(
  cfg: mintFungibleTokenCfg,
  dryRun: boolean,
  logSettings: boolean = false,
) {
  if (cfg.amount <= 0n) {
    throw new Error("mint_fungible_amount must be a positive integer");
  }

  const txSender = PhantasmaKeys.fromWIF(cfg.wif);
  const senderPubKey = new Bytes32(txSender.PublicKey);

  const toAddr = Address.Parse(cfg.to);
  const receiverPubKey = new Bytes32(toAddr.GetPublicKey());

  if (logSettings) {
    console.log(
      "Minting fungible tokens using these settings:",
      JSON.stringify(cfg.toPrintable(), bigintReplacer, 2),
    );
  }

  const rpc = new PhantasmaAPI(cfg.rpc, null, cfg.nexus);
  const tx = NativeTxHelper.mintFungible({
    owner: senderPubKey,
    to: receiverPubKey,
    tokenId: cfg.carbonTokenId,
    amount: IntX.fromBigInt(cfg.amount),
  });

  const settled = await planAndSubmit({ rpc, signer: txSender, msg: tx, dryRun });
  if (settled === null) {
    return;
  }

  if (!settled.success) {
    console.log("Could not mint fungible tokens");
    return;
  }

  // TokenContract::MintFungible answers with the receiver's balance after the mint, encoded as IntX.
  try {
    const r = new CarbonBinaryReader(hexToBytes(settled.result));
    const newBalance = IntX.read(r).toBigInt();
    console.log("New balance after mint:", newBalance.toString());
  } catch (err) {
    console.log(
      "Mint succeeded but could not decode result as IntX; raw result:",
      settled.result,
    );
    console.log("Decode error:", err instanceof Error ? err.message : String(err));
  }
}
