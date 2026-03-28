import fs from "node:fs";
import path from "node:path";
import {
  buildContractArtifactBundle,
  buildContractArtifactManifest,
  ContractArtifactBundle,
  ContractArtifactManifest,
} from "phantasma-sdk-ts";
import { CompiledContractArtifacts } from "./compiler";

export interface MaterializedContractArtifacts {
  outputDir: string;
  manifestPath: string;
  manifest: ContractArtifactManifest;
  bundle: ContractArtifactBundle;
  scriptPath: string;
  abiPath: string;
  debugPath?: string;
  asmPath?: string;
  scriptHexPath?: string;
  abiHexPath?: string;
}

export interface LoadArtifactsFromPathsOptions {
  contractName: string;
  scriptPath: string;
  abiPath: string;
  debugPath?: string;
}

function readFileBytes(filePath: string): Uint8Array {
  return fs.readFileSync(filePath);
}

function copyOptionalArtifact(sourcePath: string | undefined, outputDir: string): string | undefined {
  if (!sourcePath) {
    return undefined;
  }

  const destinationPath = path.join(outputDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, destinationPath);
  return destinationPath;
}

export function materializeCompiledArtifacts(options: {
  compiled: CompiledContractArtifacts;
  outputDir: string;
  compilerName: string;
  compilerVersion: string;
  sourceFileName: string;
}): MaterializedContractArtifacts {
  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const scriptPath = copyOptionalArtifact(options.compiled.scriptPath, outputDir)!;
  const abiPath = copyOptionalArtifact(options.compiled.abiPath, outputDir)!;
  const debugPath = copyOptionalArtifact(options.compiled.debugPath, outputDir);
  const asmPath = copyOptionalArtifact(options.compiled.asmPath, outputDir);
  const scriptHexPath = copyOptionalArtifact(options.compiled.scriptHexPath, outputDir);
  const abiHexPath = copyOptionalArtifact(options.compiled.abiHexPath, outputDir);

  const scriptBytes = readFileBytes(scriptPath);
  const abiBytes = readFileBytes(abiPath);
  const debugBytes = debugPath ? readFileBytes(debugPath) : undefined;

  const manifest = buildContractArtifactManifest({
    contractName: options.compiled.contractName,
    compilerName: options.compilerName,
    compilerVersion: options.compilerVersion,
    sourceFile: path.basename(options.sourceFileName),
    scriptPath: path.basename(scriptPath),
    script: scriptBytes,
    abiPath: path.basename(abiPath),
    abi: abiBytes,
    ...(debugPath && debugBytes
      ? {
          debugPath: path.basename(debugPath),
          debug: debugBytes,
        }
      : {}),
  });

  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const bundle = buildContractArtifactBundle({
    contractName: options.compiled.contractName,
    script: scriptBytes,
    abi: abiBytes,
    ...(debugBytes ? { debug: debugBytes } : {}),
    manifest,
  });

  return {
    outputDir,
    manifestPath,
    manifest,
    bundle,
    scriptPath,
    abiPath,
    ...(debugPath ? { debugPath } : {}),
    ...(asmPath ? { asmPath } : {}),
    ...(scriptHexPath ? { scriptHexPath } : {}),
    ...(abiHexPath ? { abiHexPath } : {}),
  };
}

export function loadContractArtifactsFromManifest(manifestPath: string): MaterializedContractArtifacts {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(resolvedManifestPath);
  const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8")) as ContractArtifactManifest;

  if (manifest.format !== "pha.contract.artifacts/v1") {
    throw new Error(`Unsupported manifest format: ${manifest.format}`);
  }

  const scriptPath = path.resolve(manifestDir, manifest.files.script.path);
  const abiPath = path.resolve(manifestDir, manifest.files.abi.path);
  const debugPath = manifest.files.debug
    ? path.resolve(manifestDir, manifest.files.debug.path)
    : undefined;

  const bundle = buildContractArtifactBundle({
    contractName: manifest.contractName,
    script: readFileBytes(scriptPath),
    abi: readFileBytes(abiPath),
    ...(debugPath ? { debug: readFileBytes(debugPath) } : {}),
    manifest,
  });

  return {
    outputDir: manifestDir,
    manifestPath: resolvedManifestPath,
    manifest,
    bundle,
    scriptPath,
    abiPath,
    ...(debugPath ? { debugPath } : {}),
  };
}

export function loadContractArtifactsFromPaths(
  options: LoadArtifactsFromPathsOptions,
): MaterializedContractArtifacts {
  const scriptPath = path.resolve(options.scriptPath);
  const abiPath = path.resolve(options.abiPath);
  const debugPath = options.debugPath ? path.resolve(options.debugPath) : undefined;

  const bundle = buildContractArtifactBundle({
    contractName: options.contractName,
    script: readFileBytes(scriptPath),
    abi: readFileBytes(abiPath),
    ...(debugPath ? { debug: readFileBytes(debugPath) } : {}),
  });

  return {
    outputDir: path.dirname(scriptPath),
    manifestPath: "",
    manifest: bundle.manifest ?? {
      format: "pha.contract.artifacts/v1",
      contractName: options.contractName,
      createdAtUtc: "",
      compiler: {
        name: "",
        version: "",
      },
      files: {
        script: {
          path: scriptPath,
          size: bundle.script.length,
          sha256: "",
        },
        abi: {
          path: abiPath,
          size: bundle.abi.length,
          sha256: "",
        },
      },
    },
    bundle,
    scriptPath,
    abiPath,
    ...(debugPath ? { debugPath } : {}),
  };
}
