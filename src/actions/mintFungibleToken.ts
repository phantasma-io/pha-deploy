import {
  Address,
  Bytes32,
  CarbonBinaryReader,
  CarbonBlob,
  FeeOptions,
  hexToBytes,
  IntX,
  PhantasmaAPI,
  PhantasmaKeys,
  SignedTxMsg,
  SmallString,
  TxMsg,
  TxMsgMintFungible,
  TxMsgSigner,
  TxTypes,
  bytesToHex,
} from "phantasma-sdk-ts";
import { requireRpcTxHash } from "../rpc/txHash";
import { waitForTx } from "./waitForTx";
import { bigintReplacer, formatForLog } from "./helpers";

export class mintFungibleTokenCfg {
  constructor(
    public rpc: string,
    public nexus: string,
    public wif: string,
    public carbonTokenId: bigint,
    public to: string,
    public amount: bigint,
    public gasFeeBase: bigint,
    public gasFeeMultiplier: bigint,
    public mintTokenMaxData: bigint,
  ) {
    this.rpc = rpc;
    this.nexus = nexus;
    this.wif = wif;
    this.carbonTokenId = carbonTokenId;
    this.to = to;
    this.amount = amount;
    this.gasFeeBase = gasFeeBase;
    this.gasFeeMultiplier = gasFeeMultiplier;
    this.mintTokenMaxData = mintTokenMaxData;
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

  // There is no dedicated MintFungible TxHelper in `phantasma-sdk-ts` yet, so we build the
  // Carbon TxMsg manually using the SDK core types. TokenContract::MintFungible returns the
  // receiver's new balance after minting, encoded as IntX in the tx result.
  const feeOptions = new FeeOptions(cfg.gasFeeBase, cfg.gasFeeMultiplier);
  const maxGas = feeOptions.calculateMaxGas();

  const msg = new TxMsg();
  msg.type = TxTypes.MintFungible;
  msg.expiry = BigInt(Date.now() + 60_000); // 60s from now (same pattern as other tx helpers)
  msg.maxGas = maxGas;
  msg.maxData = cfg.mintTokenMaxData;
  msg.gasFrom = senderPubKey;
  msg.payload = SmallString.empty;

  const mint = new TxMsgMintFungible();
  mint.tokenId = cfg.carbonTokenId;
  mint.to = receiverPubKey;
  mint.amount = IntX.fromBigInt(cfg.amount);
  msg.msg = mint;

  const txBytes = TxMsgSigner.signAndSerialize(msg, txSender);
  const txHex = bytesToHex(txBytes);

  if (dryRun) {
    console.log(`[dry-run] Prepared tx (not sent): ${txHex}`);
    console.log(
      formatForLog(CarbonBlob.NewFromBytes(SignedTxMsg, hexToBytes(txHex), 0)),
    );
    return;
  }

  console.log("Broadcasting transaction...");

  const rpc = new PhantasmaAPI(cfg.rpc, null, cfg.nexus);

  const txHash = requireRpcTxHash(
    await rpc.sendCarbonTransaction(txHex),
    "mint-fungible transaction",
  );
  console.log("txHash: ", txHash);

  const { success, result } = await waitForTx(rpc, txHash);

  if (!success) {
    console.log("Could not mint fungible tokens");
    return;
  }

  try {
    const r = new CarbonBinaryReader(hexToBytes(result));
    const newBalance = IntX.read(r).toBigInt();
    console.log("New balance after mint:", newBalance.toString());
  } catch (err) {
    console.log(
      "Mint succeeded but could not decode result as IntX; raw result:",
      result,
    );
    console.log("Decode error:", err instanceof Error ? err.message : String(err));
  }
}
