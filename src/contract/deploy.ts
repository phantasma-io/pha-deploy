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
import { requireRpcTxHash } from "../rpc/txHash";

export type ContractOperation = "deploy" | "upgrade" | "attach";

/**
 * Gas units the contract lifecycle allows itself when the caller names no `--gas-limit`.
 *
 * `AllowGas` escrows `gasPrice * gasLimit` and refunds what the script does not spend, so this
 * value is a ceiling, and whatever the script does not spend comes back. It has to be large enough
 * for a real deployment on any network. The cost comes mostly from the DeployContract interop, and
 * the size of the script moves it very little. The SDK's own `DefaultGasLimit` is 100,000 units,
 * which does not clear a deployment.
 *
 * A constant does not follow the chain. Governance can raise the price of the DeployContract
 * interop, and this ceiling then stops covering a deployment. A transaction that runs out of gas
 * is still billed its whole allowance, so each failed attempt costs `gasPrice * gasLimit`. The
 * chain names that case in its debug comment, as `gasLimit [interop=Runtime.DeployContract ...]`.
 * Raise `--gas-limit` when it appears.
 */
export const DEFAULT_LIFECYCLE_GAS_LIMIT = 3_000_000;

export interface PreparedContractTransaction {
  operation: ContractOperation;
  contractName: string;
  fromAddress: string;
  scriptHex: string;
  txHex: string;
  scriptBytes: number;
  abiBytes: number;
  attachSymbol?: string;
}

export interface ExecuteContractTransactionOptions {
  operation: ContractOperation;
  rpc: string;
  nexus: string;
  chain?: string;
  wif: string;
  bundle: ContractArtifactBundle;
  gasPrice?: number;
  gasLimit?: number;
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

function normalizeLifecycleGas(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const numeric = value ?? fallback;
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }

  return numeric;
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
  const tx = new Transaction(
    nexus,
    chain,
    scriptHex,
    new Date(Date.now() + 5 * 60 * 1000),
    payloadHex,
  );
  const proofOfWork = options.proofOfWork ?? ProofOfWork.Minimal;
  if (proofOfWork > 0) {
    tx.mineTransaction(proofOfWork);
  }
  tx.signWithKeys(keys);
  return tx.ToStringEncoded(true).toUpperCase();
}

export function prepareContractTransaction(
  options: ExecuteContractTransactionOptions,
): PreparedContractTransaction {
  const keys = PhantasmaKeys.fromWIF(options.wif);
  const fromAddress = keys.Address.Text;
  // Resolved here rather than left to the SDK: its default allowance does not clear a deployment
  // (see DEFAULT_LIFECYCLE_GAS_LIMIT).
  const gasLimit = normalizeLifecycleGas(
    options.gasLimit,
    DEFAULT_LIFECYCLE_GAS_LIMIT,
    "gasLimit",
  );
  const gasPrice = normalizeLifecycleGas(
    options.gasPrice,
    ContractTxHelper.DefaultGasPrice,
    "gasPrice",
  );
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
      ? buildAndSignTransaction(options, keys, scriptHex)
      : options.operation === "deploy"
        ? ContractTxHelper.buildDeployTransactionAndEncode({
            nexus: options.nexus,
            chain: options.chain,
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
  };
}

export async function executeContractTransaction(
  options: ExecuteContractTransactionOptions,
): Promise<ExecuteContractTransactionResult> {
  const prepared = prepareContractTransaction(options);
  if (options.dryRun) {
    return {
      prepared,
      dryRun: true,
    };
  }

  const rpc = new PhantasmaAPI(options.rpc, null, options.nexus);
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
    };
  }
  const waitResult = await waitForTx(rpc, txHash);

  return {
    prepared,
    dryRun: false,
    txHash,
    success: waitResult.success,
    result: waitResult.result,
  };
}
