import {
  ContractArtifactBundle,
  ContractTxHelper,
  PhantasmaAPI,
  PhantasmaKeys,
} from "phantasma-sdk-ts";
import { waitForTx } from "../actions/waitForTx";

export type ContractOperation = "deploy" | "upgrade";

export interface PreparedContractTransaction {
  operation: ContractOperation;
  contractName: string;
  fromAddress: string;
  scriptHex: string;
  txHex: string;
  scriptBytes: number;
  abiBytes: number;
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
}

export interface ExecuteContractTransactionResult {
  prepared: PreparedContractTransaction;
  dryRun: boolean;
  txHash?: string;
  success?: boolean;
  result?: string;
}

export function prepareContractTransaction(
  options: ExecuteContractTransactionOptions,
): PreparedContractTransaction {
  const keys = PhantasmaKeys.fromWIF(options.wif);
  const fromAddress = keys.Address.Text;

  const scriptHex =
    options.operation === "deploy"
      ? ContractTxHelper.buildDeployScriptFromBundle(
          options.bundle,
          fromAddress,
          options.gasPrice,
          options.gasLimit,
        )
      : ContractTxHelper.buildUpgradeScriptFromBundle(
          options.bundle,
          fromAddress,
          options.gasPrice,
          options.gasLimit,
        );

  const txHex =
    options.operation === "deploy"
      ? ContractTxHelper.buildDeployTransactionAndEncode({
          nexus: options.nexus,
          chain: options.chain,
          signer: keys,
          from: fromAddress,
          contractName: options.bundle.contractName,
          script: options.bundle.script,
          abi: options.bundle.abi,
          gasPrice: options.gasPrice,
          gasLimit: options.gasLimit,
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
          gasPrice: options.gasPrice,
          gasLimit: options.gasLimit,
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
  const txHash = await rpc.sendRawTransaction(prepared.txHex);
  const waitResult = await waitForTx(rpc, txHash);

  return {
    prepared,
    dryRun: false,
    txHash,
    success: waitResult.success,
    result: waitResult.result,
  };
}
