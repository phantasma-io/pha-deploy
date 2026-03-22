import {
  Bytes32,
  CarbonBlob,
  CreateSeriesFeeOptions,
  CreateTokenSeriesTxHelper,
  MetadataField,
  PhantasmaAPI,
  PhantasmaKeys,
  SeriesInfoBuilder,
  SignedTxMsg,
  VmStructSchema,
  getRandomPhantasmaId,
  hexToBytes,
} from "phantasma-sdk-ts";
import { waitForTx } from "./waitForTx";
import { bigintReplacer, Metadata, formatForLog } from "./helpers";

export class createSeriesCfg {
  constructor(
    public rpc: string,
    public nexus: string,
    public wif: string,
    public carbonTokenId: bigint,
    public gasFeeBase: bigint,
    public gasFeeCreateTokenSeries: bigint,
    public gasFeeMultiplier: bigint,
    public createSeriesMaxData: bigint,
    public seriesSchema: VmStructSchema,
    public seriesMetadata: MetadataField[]
  ) {
    this.rpc = rpc;
    this.nexus = nexus;
    this.wif = wif;
    this.carbonTokenId = carbonTokenId;
    this.gasFeeBase = gasFeeBase;
    this.gasFeeCreateTokenSeries = gasFeeCreateTokenSeries;
    this.gasFeeMultiplier = gasFeeMultiplier;
    this.createSeriesMaxData = createSeriesMaxData;
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

  const feeOptions = new CreateSeriesFeeOptions(
    cfg.gasFeeBase,
    cfg.gasFeeCreateTokenSeries,
    cfg.gasFeeMultiplier,
  );

  const tx = CreateTokenSeriesTxHelper.buildTxAndSignHex(
    cfg.carbonTokenId,
    info,
    txSender,
    feeOptions,
    cfg.createSeriesMaxData,
  );

  if (dryRun) {
    console.log(`[dry-run] Prepared tx (not sent): ${tx}`);
    console.log(formatForLog(CarbonBlob.NewFromBytes(SignedTxMsg, hexToBytes(tx), 0)));
    return;
  }

  console.log("Broadcasting transaction...");

  const rpc = new PhantasmaAPI(cfg.rpc, null, cfg.nexus);

  let txHash = await rpc.sendCarbonTransaction(tx);
  console.log("txHash: ", txHash);

  const { success, result } = await waitForTx(rpc, txHash);

  if (success) {
    var seriesId = CreateTokenSeriesTxHelper.parseResult(result);
    console.log(
      `Deployed series with phantasma ID ${newPhantasmaSeriesId.toString()} and carbon series ID ${seriesId}`,
    );
  } else {
    console.log("Could not deploy series");
  }
}
