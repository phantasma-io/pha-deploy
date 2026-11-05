import {
  Bytes32,
  PhantasmaAPI,
  PhantasmaKeys,
  TokenMetadataBuilder,
  UpdateTokenMetadataTxHelper,
} from "phantasma-sdk-ts";
import { planAndSubmit } from "./submit";
import { bigintReplacer } from "./helpers";

export class sealTokenContractCfg {
  constructor(
    public rpc: string,
    public nexus: string,
    public wif: string,
    public carbonTokenId: bigint,
  ) {
    this.rpc = rpc;
    this.nexus = nexus;
    this.wif = wif;
    this.carbonTokenId = carbonTokenId;
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

/**
 * Seals an existing token against VM contracts. The token owner sends Token.UpdateTokenMetadata with
 * `_sealed_c` = 1 alone; the chain merges an update into the stored metadata, so every other field
 * keeps its value. A sealed token never gets a VM contract, from its owner or from governance. Only a
 * token without a contract can be sealed, and the seal cannot be removed. The seal blocks VM contracts
 * only. A sealed token can be minted, transferred and burned, and it can get new NFT series and NFT
 * mints. Its other metadata fields can be changed. The chain refuses the seal of a token that has a
 * contract.
 */
export async function sealTokenContract(
  cfg: sealTokenContractCfg,
  dryRun: boolean,
  logSettings: boolean = false,
) {
  const txSender = PhantasmaKeys.fromWIF(cfg.wif);
  const senderPubKey = new Bytes32(txSender.PublicKey);

  if (logSettings) {
    console.log(
      "Sealing token against contracts using these settings:",
      JSON.stringify(cfg.toPrintable(), bigintReplacer, 2),
    );
  }

  const rpc = new PhantasmaAPI(cfg.rpc, null, cfg.nexus);
  const tx = UpdateTokenMetadataTxHelper.buildTx(
    cfg.carbonTokenId,
    TokenMetadataBuilder.buildContractSealUpdate(),
    senderPubKey,
  );

  const settled = await planAndSubmit({ rpc, signer: txSender, msg: tx, dryRun });
  if (settled === null) {
    return;
  }

  if (settled.success) {
    console.log("Contract-sealed carbon token ID:", cfg.carbonTokenId.toString());
  } else {
    console.log("Could not seal token against contracts");
  }
}
