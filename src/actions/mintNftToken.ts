import {
  Bytes32,
  hexToBytes,
  IntX,
  MintPhantasmaNonFungibleTxHelper,
  PhantasmaAPI,
  PhantasmaNftMintInfo,
  PhantasmaNftRomBuilder,
  PhantasmaKeys,
  TokenHelper,
  VmStructSchema,
  MetadataField,
} from "phantasma-sdk-ts";
import { planAndSubmit } from "./submit";
import { bigintReplacer } from "./helpers";

function bytes32HexToRpcDecimal(hex: string): string {
  if (hex.length === 0) {
    return "0";
  }

  // RPC/public read paths interpret the raw Bytes32 `_i` word as an unsigned little-endian integer.
  const littleEndianHex = Array.from(hexToBytes(hex))
    .reverse()
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return BigInt(`0x${littleEndianHex}`).toString();
}

export class mintNftTokenCfg {
  constructor(
    public rpc: string,
    public nexus: string,
    public wif: string,
    public carbonTokenId: bigint,
    public phantasmaSeriesId: bigint,
    public nftRomSchema: VmStructSchema,
    public nftMetadata: MetadataField[],
  ) {
    this.rpc = rpc;
    this.nexus = nexus;
    this.wif = wif;
    this.carbonTokenId = carbonTokenId;
    this.phantasmaSeriesId = phantasmaSeriesId;
    this.nftRomSchema = nftRomSchema;
    this.nftMetadata = nftMetadata;
  }

  toPrintable() {
    // Do not leak WIF; derive owner
    const { wif: _omit, nftMetadata, ...rest } =
      this; // rest has all public fields except wif/metadata strings
    const owner = PhantasmaKeys.fromWIF(this.wif).Address.toString();

    return {
      ...rest,
      owner,
      nftMetadata
    };
  }
}

export async function mintNftToken(
  cfg: mintNftTokenCfg,
  dryRun: boolean,
  logSettings: boolean = false,
) {
  const txSender = PhantasmaKeys.fromWIF(cfg.wif);
  const senderPubKey = new Bytes32(txSender.PublicKey);

  if (logSettings) {
    console.log(
      "Minting NFT through deterministic chain-generated id flow using these settings:",
      JSON.stringify(cfg.toPrintable(), bigintReplacer, 2),
    );
  }

  const rom = PhantasmaNftRomBuilder.buildAndSerialize(
    cfg.nftRomSchema,
    cfg.nftMetadata
  );

  const rpc = new PhantasmaAPI(cfg.rpc, null, cfg.nexus);
  // One instance, minted to the signer. The mint call accepts a list, so the fee the planner reads
  // out of it follows the instances and their ROM sizes rather than any number this CLI supplies.
  const tx = MintPhantasmaNonFungibleTxHelper.buildTx({
    tokenId: cfg.carbonTokenId,
    sender: senderPubKey,
    to: senderPubKey,
    tokens: [
      new PhantasmaNftMintInfo({
        phantasmaSeriesId: IntX.fromBigInt(cfg.phantasmaSeriesId),
        rom,
        ram: new Uint8Array(),
      }),
    ],
  });

  const settled = await planAndSubmit({ rpc, signer: txSender, msg: tx, dryRun });
  if (settled === null) {
    return;
  }

  if (settled.success) {
    const mintResults = MintPhantasmaNonFungibleTxHelper.parseResult(settled.result);
    if (mintResults.length === 0) {
      throw new Error("Deterministic mint result is empty");
    }

    const carbonNftAddress = TokenHelper.getNftAddress(
      cfg.carbonTokenId,
      mintResults[0].carbonInstanceId,
    );
    const mintedPhantasmaNftIdHex = mintResults[0].phantasmaNftId.ToHex();
    const mintedPhantasmaNftId = bytes32HexToRpcDecimal(mintedPhantasmaNftIdHex);
    console.log(
      `Minted NFT with phantasma ID ${mintedPhantasmaNftId} (0x${mintedPhantasmaNftIdHex}) and carbon NFT address ${carbonNftAddress.ToHex()}`,
    );
  } else {
    console.log("Could not mint NFT");
  }
}
