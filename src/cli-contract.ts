import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yargs from "yargs/yargs";
import {
  CONTRACT_COMPILER_NAME,
  MIN_SUPPORTED_PHA_TOMB_VERSION,
  buildCompileArgs,
  resolveSupportedCompiler,
  runCompiler,
  selectCompiledContractArtifacts,
  type CompileProcessResult,
  type NativeCheckMode,
} from "./contract/compiler";
import {
  loadContractArtifactsFromManifest,
  loadContractArtifactsFromPaths,
  materializeCompiledArtifacts,
} from "./contract/artifacts";
import { executeContractTransaction, type ContractOperation } from "./contract/deploy";

function printIndentedBlock(title: string, content: string): void {
  console.log(`${title}:`);
  const trimmed = content.trimEnd();
  if (!trimmed) {
    console.log("  (empty)");
    return;
  }

  for (const line of trimmed.split(/\r?\n/)) {
    console.log(`  ${line}`);
  }
}

function printCompileTranscript(result: CompileProcessResult): void {
  console.log("Compiler command:");
  console.log(`  ${result.command} ${result.args.join(" ")}`);
  console.log(`Compiler cwd:`);
  console.log(`  ${result.cwd}`);
  printIndentedBlock(`${CONTRACT_COMPILER_NAME} stdout`, result.stdout);
  printIndentedBlock(`${CONTRACT_COMPILER_NAME} stderr`, result.stderr);
}

function parseOptionalInteger(value: unknown, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

async function handleContractCompile(argv: {
  source: string;
  out?: string;
  contractName?: string;
  protocol?: number;
  debug?: boolean;
  nativeCheck?: NativeCheckMode;
  libpath?: string[];
}): Promise<void> {
  const compiler = await resolveSupportedCompiler(MIN_SUPPORTED_PHA_TOMB_VERSION);
  const sourcePath = path.resolve(argv.source);
  const preferredContractName = argv.contractName?.trim() || path.basename(sourcePath, path.extname(sourcePath));
  const outputDir = path.resolve(
    argv.out ?? path.join(process.cwd(), "dist", "contracts", preferredContractName),
  );
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pha-deploy-compile-"));

  try {
    const compileArgs = buildCompileArgs({
      sourcePath,
      outputRoot: tempRoot,
      libPaths: argv.libpath,
      protocol: argv.protocol,
      debug: argv.debug,
      nativeCheck: argv.nativeCheck,
    });
    const result = await runCompiler(compiler.executablePath, compileArgs, process.cwd());
    printCompileTranscript(result);

    if (result.exitCode !== 0) {
      throw new Error(`${CONTRACT_COMPILER_NAME} exited with code ${result.exitCode}`);
    }

    const compiled = selectCompiledContractArtifacts(
      path.join(tempRoot, "Output"),
      preferredContractName,
    );
    const materialized = materializeCompiledArtifacts({
      compiled,
      outputDir,
      compilerName: compiler.executableName,
      compilerVersion: compiler.version,
      sourceFileName: sourcePath,
    });

    console.log("Artifacts:");
    console.log(`  contract: ${materialized.bundle.contractName}`);
    console.log(`  output: ${materialized.outputDir}`);
    console.log(`  manifest: ${materialized.manifestPath}`);
    console.log(`  script: ${materialized.scriptPath}`);
    console.log(`  abi: ${materialized.abiPath}`);
    if (materialized.debugPath) {
      console.log(`  debug: ${materialized.debugPath}`);
    }
    if (materialized.asmPath) {
      console.log(`  asm: ${materialized.asmPath}`);
    }
    if (materialized.scriptHexPath) {
      console.log(`  script hex: ${materialized.scriptHexPath}`);
    }
    if (materialized.abiHexPath) {
      console.log(`  abi hex: ${materialized.abiHexPath}`);
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function handleContractBroadcast(
  operation: ContractOperation,
  argv: {
    rpc: string;
    nexus: string;
    chain?: string;
    wif: string;
    manifest?: string;
    contractName?: string;
    script?: string;
    abi?: string;
    debug?: string;
    gasPrice?: unknown;
    gasLimit?: unknown;
    pow?: unknown;
    payloadHex?: string;
    dryRun?: boolean;
  },
): Promise<void> {
  const artifacts = argv.manifest
    ? loadContractArtifactsFromManifest(argv.manifest)
    : loadContractArtifactsFromPaths({
        contractName: argv.contractName ?? "",
        scriptPath: argv.script ?? "",
        abiPath: argv.abi ?? "",
        ...(argv.debug ? { debugPath: argv.debug } : {}),
      });

  const result = await executeContractTransaction({
    operation,
    rpc: argv.rpc,
    nexus: argv.nexus,
    chain: argv.chain,
    wif: argv.wif,
    bundle: artifacts.bundle,
    gasPrice: parseOptionalInteger(argv.gasPrice, "--gas-price"),
    gasLimit: parseOptionalInteger(argv.gasLimit, "--gas-limit"),
    proofOfWork: parseOptionalInteger(argv.pow, "--pow"),
    payloadHex: argv.payloadHex,
    dryRun: argv.dryRun,
  });

  console.log("Transaction:");
  console.log(`  operation: ${result.prepared.operation}`);
  console.log(`  contract: ${result.prepared.contractName}`);
  console.log(`  from: ${result.prepared.fromAddress}`);
  console.log(`  script bytes: ${result.prepared.scriptBytes}`);
  console.log(`  abi bytes: ${result.prepared.abiBytes}`);
  console.log(`  vm script: ${result.prepared.scriptHex}`);
  console.log(`  signed tx: ${result.prepared.txHex}`);

  if (result.dryRun) {
    console.log("Dry-run complete: transaction was not broadcast.");
    return;
  }

  console.log(`  tx hash: ${result.txHash ?? ""}`);
  if (result.broadcastError) {
    throw new Error(result.broadcastError);
  }
  if (!result.success) {
    throw new Error(
      `${operation} transaction failed${result.txHash ? ` (txHash: ${result.txHash})` : ""}`,
    );
  }
}

export async function runContractCli(rawArgv: string[]): Promise<void> {
  const parser = yargs(rawArgv)
    .scriptName("pha-deploy contract")
    .command(
      "compile",
      "Compile a contract through the system-installed pha-tomb",
      (cmd) =>
        cmd
          .option("source", {
            type: "string",
            demandOption: true,
            describe: "Path to the .tomb source file",
          })
          .option("out", {
            type: "string",
            describe: "Output directory for the final artifact bundle",
          })
          .option("contract-name", {
            type: "string",
            describe: "Expected contract artifact name when the compiler emits multiple modules",
          })
          .option("protocol", {
            type: "number",
            describe: "Target protocol version passed to pha-tomb",
          })
          .option("debug", {
            type: "boolean",
            describe: "Request debug artifacts from pha-tomb",
          })
          .option("nativecheck", {
            type: "string",
            choices: ["off", "warn", "error"],
            describe: "Native/foundational interop diagnostics mode",
          })
          .option("libpath", {
            type: "string",
            array: true,
            describe: "Additional library search path(s) passed to pha-tomb",
          }),
      async (argv) => {
        await handleContractCompile({
          source: argv.source,
          out: argv.out,
          contractName: argv["contract-name"],
          protocol: argv.protocol,
          debug: argv.debug,
          nativeCheck: argv.nativecheck as NativeCheckMode | undefined,
          libpath: argv.libpath,
        });
      },
    )
    .command(
      "deploy",
      "Deploy a compiled contract artifact bundle",
      (cmd) =>
        cmd
          .option("rpc", { type: "string", demandOption: true, describe: "RPC endpoint" })
          .option("nexus", { type: "string", demandOption: true, describe: "Nexus name" })
          .option("chain", { type: "string", default: "main", describe: "Target chain" })
          .option("wif", { type: "string", demandOption: true, describe: "WIF used to sign the transaction" })
          .option("manifest", { type: "string", describe: "Path to manifest.json produced by contract compile" })
          .option("contract-name", { type: "string", describe: "Contract name when using direct --script/--abi inputs" })
          .option("script", { type: "string", describe: "Path to compiled .pvm file when not using --manifest" })
          .option("abi", { type: "string", describe: "Path to compiled .abi file when not using --manifest" })
          .option("debug", { type: "string", describe: "Optional path to .debug file when not using --manifest" })
          .option("gas-price", { type: "number", describe: "Gas price passed to AllowGas" })
          .option("gas-limit", { type: "number", describe: "Gas limit passed to AllowGas" })
          .option("pow", { type: "number", describe: "Proof-of-work difficulty for the legacy VM transaction" })
          .option("payload-hex", { type: "string", describe: "Optional transaction payload as raw hex" })
          .option("dry-run", { type: "boolean", describe: "Build and sign the transaction without broadcasting" }),
      async (argv) => {
        await handleContractBroadcast("deploy", {
          rpc: argv.rpc,
          nexus: argv.nexus,
          chain: argv.chain,
          wif: argv.wif,
          manifest: argv.manifest,
          contractName: argv["contract-name"],
          script: argv.script,
          abi: argv.abi,
          debug: argv.debug,
          gasPrice: argv["gas-price"],
          gasLimit: argv["gas-limit"],
          pow: argv.pow,
          payloadHex: argv["payload-hex"],
          dryRun: argv["dry-run"],
        });
      },
    )
    .command(
      "upgrade",
      "Upgrade an already deployed contract artifact bundle",
      (cmd) =>
        cmd
          .option("rpc", { type: "string", demandOption: true, describe: "RPC endpoint" })
          .option("nexus", { type: "string", demandOption: true, describe: "Nexus name" })
          .option("chain", { type: "string", default: "main", describe: "Target chain" })
          .option("wif", { type: "string", demandOption: true, describe: "WIF used to sign the transaction" })
          .option("manifest", { type: "string", describe: "Path to manifest.json produced by contract compile" })
          .option("contract-name", { type: "string", describe: "Contract name when using direct --script/--abi inputs" })
          .option("script", { type: "string", describe: "Path to compiled .pvm file when not using --manifest" })
          .option("abi", { type: "string", describe: "Path to compiled .abi file when not using --manifest" })
          .option("debug", { type: "string", describe: "Optional path to .debug file when not using --manifest" })
          .option("gas-price", { type: "number", describe: "Gas price passed to AllowGas" })
          .option("gas-limit", { type: "number", describe: "Gas limit passed to AllowGas" })
          .option("pow", { type: "number", describe: "Proof-of-work difficulty for the legacy VM transaction" })
          .option("payload-hex", { type: "string", describe: "Optional transaction payload as raw hex" })
          .option("dry-run", { type: "boolean", describe: "Build and sign the transaction without broadcasting" }),
      async (argv) => {
        await handleContractBroadcast("upgrade", {
          rpc: argv.rpc,
          nexus: argv.nexus,
          chain: argv.chain,
          wif: argv.wif,
          manifest: argv.manifest,
          contractName: argv["contract-name"],
          script: argv.script,
          abi: argv.abi,
          debug: argv.debug,
          gasPrice: argv["gas-price"],
          gasLimit: argv["gas-limit"],
          pow: argv.pow,
          payloadHex: argv["payload-hex"],
          dryRun: argv["dry-run"],
        });
      },
    )
    .demandCommand(1)
    .strict()
    .help();

  await parser.parseAsync();
}
