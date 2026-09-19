import {
  ContractArtifactBundle,
  ContractTxHelper,
  ProofOfWork,
  PhantasmaAPI,
  PhantasmaKeys,
  ScriptBuilder,
  Transaction,
} from "phantasma-sdk-ts";
import { waitForTx } from "../actions/waitForTx";
import {
  EstimatedGasCeiling,
  estimateGasCeiling,
  gasPair,
  payerGasBalance,
} from "./gasCeiling";
import { requireRpcTxHash } from "../rpc/txHash";

export type ContractOperation = "deploy" | "upgrade" | "attach";

/**
 * How long a lifecycle transaction stays valid. The probe the chain prices and the transaction
 * that is sent are built separately, so the window has to cover both.
 */
const LIFECYCLE_EXPIRY_MS = 5 * 60 * 1000;

export interface PreparedContractTransaction {
  operation: ContractOperation;
  contractName: string;
  fromAddress: string;
  scriptHex: string;
  txHex: string;
  scriptBytes: number;
  abiBytes: number;
  attachSymbol?: string;
  /** Expiry written into the transaction. The envelope for an estimate has to carry the same one. */
  expiration: Date;
  /** Gas ceiling this transaction offers, in gas-token atoms. */
  gasCeiling: bigint;
}

export interface ExecuteContractTransactionOptions {
  operation: ContractOperation;
  rpc: string;
  nexus: string;
  chain?: string;
  wif: string;
  bundle: ContractArtifactBundle;
  /**
   * Gas ceiling to offer, in gas-token atoms. Left out, it is read from the chain's estimate.
   * Set, it overrides the estimate and the estimate is not asked for.
   */
  maxGas?: bigint;
  proofOfWork?: number;
  payloadHex?: string;
  dryRun?: boolean;
  attachSymbol?: string;
}

export interface ExecuteContractTransactionResult {
  prepared: PreparedContractTransaction;
  dryRun: boolean;
  txHash?: string;
  success?: boolean;
  result?: string;
  broadcastError?: string;
  /** What the chain's estimate reported. Absent when the caller set the ceiling by hand. */
  estimate?: EstimatedGasCeiling;
}

function normalizeAttachSymbol(
  requestedSymbol: string | undefined,
  bundle: ContractArtifactBundle,
): string {
  const attachSymbol = (requestedSymbol ?? bundle.contractName).trim();
  if (!attachSymbol) {
    throw new Error("attach symbol cannot be empty");
  }

  return attachSymbol;
}

function buildAttachScript(
  bundle: ContractArtifactBundle,
  fromAddress: string,
  attachSymbol: string,
  gasPrice: number,
  gasLimit: number,
): string {
  // Attach must go through Nexus interop because it binds an already-created native token to a VM
  // bundle. Runtime.DeployContract/UpgradeContract target a different lifecycle.
  const nullAddress = new ScriptBuilder().NullAddress;

  return new ScriptBuilder()
    .BeginScript()
    .AllowGas(fromAddress, nullAddress, gasPrice, gasLimit)
    .CallInterop("Nexus.AttachTokenContract", [
      fromAddress,
      attachSymbol,
      bundle.script,
      bundle.abi,
    ])
    .SpendGas(fromAddress)
    .EndScript();
}

function buildAndSignTransaction(
  options: ExecuteContractTransactionOptions,
  keys: PhantasmaKeys,
  scriptHex: string,
  expiration: Date,
): string {
  const nexus = options.nexus.trim();
  const chain = (options.chain ?? "main").trim();
  if (!nexus) {
    throw new Error("nexus cannot be empty");
  }
  if (!chain) {
    throw new Error("chain cannot be empty");
  }

  const payloadHex = options.payloadHex?.trim() ?? "";
  const tx = new Transaction(nexus, chain, scriptHex, expiration, payloadHex);
  const proofOfWork = options.proofOfWork ?? ProofOfWork.Minimal;
  if (proofOfWork > 0) {
    tx.mineTransaction(proofOfWork);
  }
  tx.signWithKeys(keys);
  return tx.ToStringEncoded(true).toUpperCase();
}

/**
 * Builds and signs one lifecycle transaction at the given gas ceiling.
 *
 * The ceiling is decided by the caller, because the same function builds the probe the chain
 * prices and the transaction that is finally sent.
 */
export function prepareContractTransaction(
  options: ExecuteContractTransactionOptions,
  maxGas: bigint,
): PreparedContractTransaction {
  const keys = PhantasmaKeys.fromWIF(options.wif);
  const fromAddress = keys.Address.Text;
  const { gasPrice, gasLimit, ceiling } = gasPair(maxGas);
  const expiration = new Date(Date.now() + LIFECYCLE_EXPIRY_MS);
  const attachSymbol =
    options.operation === "attach"
      ? normalizeAttachSymbol(options.attachSymbol, options.bundle)
      : undefined;

  const scriptHex =
    options.operation === "attach"
      ? buildAttachScript(options.bundle, fromAddress, attachSymbol as string, gasPrice, gasLimit)
      : options.operation === "deploy"
      ? ContractTxHelper.buildDeployScriptFromBundle(
          options.bundle,
          fromAddress,
          gasPrice,
          gasLimit,
        )
      : ContractTxHelper.buildUpgradeScriptFromBundle(
          options.bundle,
          fromAddress,
          gasPrice,
          gasLimit,
        );

  const txHex =
    options.operation === "attach"
      ? buildAndSignTransaction(options, keys, scriptHex, expiration)
      : options.operation === "deploy"
        ? ContractTxHelper.buildDeployTransactionAndEncode({
            nexus: options.nexus,
            chain: options.chain,
            expiration,
            signer: keys,
            from: fromAddress,
            contractName: options.bundle.contractName,
            script: options.bundle.script,
            abi: options.bundle.abi,
            gasPrice,
            gasLimit,
            proofOfWork: options.proofOfWork,
            payloadHex: options.payloadHex,
          })
        : ContractTxHelper.buildUpgradeTransactionAndEncode({
            nexus: options.nexus,
            chain: options.chain,
            expiration,
            signer: keys,
            from: fromAddress,
            contractName: options.bundle.contractName,
            script: options.bundle.script,
            abi: options.bundle.abi,
            gasPrice,
            gasLimit,
            proofOfWork: options.proofOfWork,
            payloadHex: options.payloadHex,
          });

  return {
    operation: options.operation,
    contractName: options.bundle.contractName,
    fromAddress,
    scriptHex,
    txHex,
    scriptBytes: options.bundle.script.length,
    abiBytes: options.bundle.abi.length,
    ...(attachSymbol ? { attachSymbol } : {}),
    expiration,
    gasCeiling: ceiling,
  };
}

/**
 * Reads the gas ceiling for one lifecycle transaction from the chain.
 *
 * A probe transaction is built at the largest ceiling the payer could offer, which is the whole
 * balance, and the chain prices it. The probe is signed because the chain refuses an envelope its
 * gas payer did not sign, and it is never broadcast.
 *
 * The probe carries a larger number in its `AllowGas` call than the transaction that is finally
 * sent, so its script is a few bytes longer and its bill a few atoms higher. The recommendation
 * carries a margin that covers the difference.
 */
async function readGasCeilingFromChain(
  options: ExecuteContractTransactionOptions,
  rpc: PhantasmaAPI,
): Promise<EstimatedGasCeiling> {
  const keys = PhantasmaKeys.fromWIF(options.wif);
  const offered = await payerGasBalance(rpc, keys.Address.Text);
  const probe = prepareContractTransaction(options, offered);
  return estimateGasCeiling(rpc, {
    txHex: probe.txHex,
    expiration: probe.expiration,
    publicKey: keys.publicKey,
    offered: probe.gasCeiling,
  });
}

export async function executeContractTransaction(
  options: ExecuteContractTransactionOptions,
): Promise<ExecuteContractTransactionResult> {
  const rpc = new PhantasmaAPI(options.rpc, null, options.nexus);

  // A ceiling set by hand is taken as given. Otherwise the chain names it, so that no fee number
  // originates in this CLI.
  const estimate =
    options.maxGas === undefined
      ? await readGasCeilingFromChain(options, rpc)
      : undefined;
  const maxGas = estimate?.maxGas ?? (options.maxGas as bigint);

  const prepared = prepareContractTransaction(options, maxGas);
  if (options.dryRun) {
    return {
      prepared,
      dryRun: true,
      ...(estimate ? { estimate } : {}),
    };
  }

  let txHash: string;
  try {
    txHash = requireRpcTxHash(
      await rpc.sendRawTransaction(prepared.txHex),
      `${options.operation} transaction`,
    );
  } catch (err) {
    return {
      prepared,
      dryRun: false,
      success: false,
      result: "",
      broadcastError: err instanceof Error ? err.message : String(err),
      ...(estimate ? { estimate } : {}),
    };
  }
  const waitResult = await waitForTx(rpc, txHash);

  return {
    prepared,
    dryRun: false,
    txHash,
    success: waitResult.success,
    result: waitResult.result,
    ...(estimate ? { estimate } : {}),
  };
}
