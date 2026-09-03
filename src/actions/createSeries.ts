import {
  Bytes32,
  CreateTokenSeriesTxHelper,
  MetadataField,
  PhantasmaAPI,
  PhantasmaKeys,
  SeriesInfoBuilder,
  VmStructSchema,
  getRandomPhantasmaId,
} from "phantasma-sdk-ts";
import { planAndSubmit } from "./submit";
import { bigintReplacer } from "./helpers";

export class createSeriesCfg {
  constructor(
    public rpc: string,
    public nexus: string,
    public wif: string,
    public carbonTokenId: bigint,
    public seriesSchema: VmStructSchema,
    public seriesMetadata: MetadataField[]
  ) {
    this.rpc = rpc;
    this.nexus = nexus;
    this.wif = wif;
    this.carbonTokenId = carbonTokenId;
    this.seriesSchema = seriesSchema;
    this.seriesMetadata = seriesMetadata;
  }

  toPrintable() {
    // Do not leak WIF; derive owner
    const { wif: _omit, seriesMetadata: seriesMetadata, ...rest } = this; // rest has all public fields except wif/sharedRom
    const owner = PhantasmaKeys.fromWIF(this.wif).Address.toString();

    return {
      ...rest,
      owner,
      seriesMetadata
    };
  }
}



export async function createSeries(
  cfg: createSeriesCfg,
  dryRun: boolean,
  logSettings: boolean = false,
) {
  const txSender = PhantasmaKeys.fromWIF(cfg.wif);
  const senderPubKey = new Bytes32(txSender.PublicKey);

  const newPhantasmaSeriesId = await getRandomPhantasmaId();

  if (logSettings) {
    console.log(
      `Creating new series '${newPhantasmaSeriesId}' using these settings:`,
      JSON.stringify(cfg.toPrintable(), bigintReplacer, 2),
    );
  }

  const info = SeriesInfoBuilder.build(
    cfg.seriesSchema,
    newPhantasmaSeriesId,
    0,
    0,
    senderPubKey,
    cfg.seriesMetadata
  );

  const rpc = new PhantasmaAPI(cfg.rpc, null, cfg.nexus);
  const tx = CreateTokenSeriesTxHelper.buildTx(cfg.carbonTokenId, info, senderPubKey);

  const settled = await planAndSubmit({ rpc, signer: txSender, msg: tx, dryRun });
  if (settled === null) {
    return;
  }

  if (settled.success) {
    const seriesId = CreateTokenSeriesTxHelper.parseResult(settled.result);
    console.log(
      `Deployed series with phantasma ID ${newPhantasmaSeriesId.toString()} and carbon series ID ${seriesId}`,
    );
  } else {
    console.log("Could not deploy series");
  }
}
