import {
  Bytes32,
  CarbonBlob,
  CreateTokenFeeOptions,
  CreateTokenTxHelper,
  hexToBytes,
  IntX,
  SignedTxMsg,
  PhantasmaAPI,
  PhantasmaKeys,
  TokenInfoBuilder,
  TokenMetadataBuilder,
  TokenSchemas,
} from "phantasma-sdk-ts";
import { TokenType } from "../config";
import { requireRpcTxHash } from "../rpc/txHash";
import { waitForTx } from "./waitForTx";
import { bigintReplacer, Metadata, formatForLog } from "./helpers";

export class createTokenCfg {
  constructor(
    public rpc: string,
    public nexus: string,
    public wif: string,
    public symbol: string,
    public gasFeeBase: bigint,
    public gasFeeCreateTokenBase: bigint,
    public gasFeeCreateTokenSymbol: bigint,
    public gasFeeMultiplier: bigint,
    public createTokenMaxData: bigint,
    public tokenSchemas: TokenSchemas | null | undefined,
    public tokenMetadataFields: Metadata,
    public tokenType: TokenType,
    public tokenMaxSupply: bigint | null | undefined,
    public fungibleDecimals: number | null | undefined,
  ) {
    this.rpc = rpc;
    this.nexus = nexus;
    this.wif = wif;
    this.symbol = symbol;
    this.gasFeeBase = gasFeeBase;
    this.gasFeeCreateTokenBase = gasFeeCreateTokenBase;
    this.gasFeeCreateTokenSymbol = gasFeeCreateTokenSymbol;
    this.gasFeeMultiplier = gasFeeMultiplier;
    this.createTokenMaxData = createTokenMaxData;
    this.tokenSchemas = tokenSchemas;
    this.tokenMetadataFields = tokenMetadataFields;
    this.tokenType = tokenType;
    this.tokenMaxSupply = tokenMaxSupply;
    this.fungibleDecimals = fungibleDecimals;
  }

  toPrintable() {
    // Do not leak WIF; derive owner
    const { wif: _omit, ...rest } = this; // rest has all public fields except wif
    const owner = PhantasmaKeys.fromWIF(this.wif).Address.toString();

    return {
      ...rest,
      owner,
    };
  }
}

export async function createToken(
  cfg: createTokenCfg,
  dryRun: boolean,
  logSettings: boolean = false,
) {
  const txSender = PhantasmaKeys.fromWIF(cfg.wif);
  const senderPubKey = new Bytes32(txSender.PublicKey);

  if (logSettings) {
    console.log(
      "Deploying new token using these settings:",
      JSON.stringify(cfg.toPrintable(), bigintReplacer, 2),
    );
  }

  if (cfg.tokenMetadataFields == null) {
    throw Error('Token metadata is mandatory');
  }

  const tokenType = cfg.tokenType === "fungible" ? "fungible" : "nft";
  const isFungible = tokenType === "fungible";

  let maxSupply: IntX;
  let decimals = 0;

  if (isFungible) {
    if (cfg.tokenMaxSupply == null) {
      throw Error("token_max_supply is required for fungible tokens");
    }
    if (cfg.fungibleDecimals == null) {
      throw Error("fungible_decimals is required for fungible tokens");
    }
    if (!Number.isInteger(cfg.fungibleDecimals) || cfg.fungibleDecimals < 0) {
      throw Error("fungible_decimals must be a non-negative integer");
    }
    if (cfg.fungibleDecimals > 255) {
      throw Error("fungible_decimals must be <= 255");
    }
  }

  const maxSupplyValue =
    cfg.tokenMaxSupply != null ? cfg.tokenMaxSupply : 0n;
  if (maxSupplyValue < 0n) {
    throw Error("token_max_supply must be non-negative");
  }
  if (isFungible) {
    decimals = cfg.fungibleDecimals!;
    maxSupply = IntX.fromBigInt(maxSupplyValue);
  } else {
    maxSupply =
      maxSupplyValue === 0n
        ? IntX.fromI64(0n)
        : IntX.fromBigInt(maxSupplyValue);
  }

  const info = TokenInfoBuilder.build(
    cfg.symbol,
    maxSupply,
    !isFungible,
    decimals,
    senderPubKey,
    TokenMetadataBuilder.buildAndSerialize(cfg.tokenMetadataFields.fields),
    cfg.tokenSchemas
  );

  const feeOptions = new CreateTokenFeeOptions(
    cfg.gasFeeBase,
    cfg.gasFeeCreateTokenBase,
    cfg.gasFeeCreateTokenSymbol,
    cfg.gasFeeMultiplier,
  );

  const tx = CreateTokenTxHelper.buildTxAndSignHex(
    info,
    txSender,
    feeOptions,
    cfg.createTokenMaxData,
  );

  if (dryRun) {
    console.log(`[dry-run] Prepared tx (not sent): ${tx}`);
    console.log(formatForLog(CarbonBlob.NewFromBytes(SignedTxMsg, hexToBytes(tx), 0)));
    return;
  }

  console.log("Broadcasting transaction...");

  const rpc = new PhantasmaAPI(cfg.rpc, null, cfg.nexus);

  const txHash = requireRpcTxHash(
    await rpc.sendCarbonTransaction(tx),
    "create-token transaction",
  );
  console.log("txHash: ", txHash);

  const { success, result } = await waitForTx(rpc, txHash);

  if (success) {
    var tokenId = CreateTokenTxHelper.parseResult(result);
    console.log("Deployed carbon token ID:", tokenId);
  } else {
    console.log("Could not deploy token");
  }
}
