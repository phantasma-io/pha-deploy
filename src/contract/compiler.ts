import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const CONTRACT_COMPILER_NAME = "pha-tomb";
export const MIN_SUPPORTED_PHA_TOMB_VERSION = "2.0.0";

export type NativeCheckMode = "off" | "warn" | "error";

export interface InstalledCompiler {
  executableName: string;
  executablePath: string;
  version: string;
}

export interface CompileProcessResult {
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CompileArgsOptions {
  sourcePath: string;
  outputRoot: string;
  libPaths?: string[];
  protocol?: number;
  debug?: boolean;
  nativeCheck?: NativeCheckMode;
}

export interface CompiledContractArtifacts {
  contractName: string;
  compilerOutputDir: string;
  scriptPath: string;
  abiPath: string;
  debugPath?: string;
  asmPath?: string;
  scriptHexPath?: string;
  abiHexPath?: string;
}

function parseSemver(version: string): [number, number, number] {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Unsupported semantic version: ${version}`);
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
}

export function isSemverGte(actual: string, minimum: string): boolean {
  const actualParts = parseSemver(actual);
  const minimumParts = parseSemver(minimum);

  for (let i = 0; i < actualParts.length; i += 1) {
    const a = actualParts[i] ?? 0;
    const b = minimumParts[i] ?? 0;
    if (a > b) {
      return true;
    }
    if (a < b) {
      return false;
    }
  }

  return true;
}

export function findExecutableInPath(
  executableName: string,
  envPath: string = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathEntries = envPath.split(path.delimiter).filter(Boolean);
  const candidateNames =
    platform === "win32"
      ? [executableName, `${executableName}.exe`, `${executableName}.cmd`, `${executableName}.bat`]
      : [executableName];

  for (const entry of pathEntries) {
    for (const candidateName of candidateNames) {
      const candidatePath = path.join(entry, candidateName);
      try {
        fs.accessSync(candidatePath, fs.constants.X_OK);
        return candidatePath;
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function runCommandCapture(
  command: string,
  args: string[],
  cwd: string,
): Promise<CompileProcessResult> {
  return await new Promise<CompileProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        command,
        args,
        cwd,
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });
  });
}

export async function queryCompilerVersion(executablePath: string): Promise<string> {
  const result = await runCommandCapture(executablePath, ["--version"], process.cwd());
  if (result.exitCode !== 0) {
    throw new Error(
      `${CONTRACT_COMPILER_NAME} --version exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim() || "no diagnostics"}`,
    );
  }

  const versionLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!versionLine) {
    throw new Error(`${CONTRACT_COMPILER_NAME} --version returned no output`);
  }

  return versionLine;
}

export async function findInstalledCompiler(
  envPath: string = process.env.PATH ?? "",
): Promise<InstalledCompiler | null> {
  const executablePath = findExecutableInPath(CONTRACT_COMPILER_NAME, envPath);
  if (!executablePath) {
    return null;
  }

  return {
    executableName: CONTRACT_COMPILER_NAME,
    executablePath,
    version: await queryCompilerVersion(executablePath),
  };
}

export async function resolveSupportedCompiler(
  minimumVersion: string = MIN_SUPPORTED_PHA_TOMB_VERSION,
  envPath: string = process.env.PATH ?? "",
): Promise<InstalledCompiler> {
  const compiler = await findInstalledCompiler(envPath);
  if (!compiler) {
    throw new Error(`${CONTRACT_COMPILER_NAME} was not found in PATH`);
  }

  if (!isSemverGte(compiler.version, minimumVersion)) {
    throw new Error(
      `${CONTRACT_COMPILER_NAME} ${compiler.version} is below the minimum supported version ${minimumVersion}`,
    );
  }

  return compiler;
}

export function buildCompileArgs(options: CompileArgsOptions): string[] {
  const args: string[] = [
    `output:${path.resolve(options.outputRoot)}`,
  ];

  if (options.protocol !== undefined) {
    args.push(`protocol:${options.protocol}`);
  }
  for (const libPath of options.libPaths ?? []) {
    args.push(`libpath:${path.resolve(libPath)}`);
  }
  if (options.debug) {
    args.push("debug");
  }
  if (options.nativeCheck) {
    args.push(`nativecheck:${options.nativeCheck}`);
  }

  args.push(path.resolve(options.sourcePath));
  return args;
}

export async function runCompiler(
  executablePath: string,
  args: string[],
  cwd: string,
): Promise<CompileProcessResult> {
  return await runCommandCapture(executablePath, args, cwd);
}

export function selectCompiledContractArtifacts(
  compilerOutputDir: string,
  requestedContractName?: string,
): CompiledContractArtifacts {
  const normalizedOutputDir = path.resolve(compilerOutputDir);
  if (!fs.existsSync(normalizedOutputDir)) {
    throw new Error(`Compiler output directory does not exist: ${normalizedOutputDir}`);
  }

  const entries = fs.readdirSync(normalizedOutputDir, { withFileTypes: true });
  const pvmFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pvm"))
    .map((entry) => entry.name)
    .sort();

  if (pvmFiles.length === 0) {
    throw new Error(`No .pvm artifacts were produced in ${normalizedOutputDir}`);
  }

  const requestedName = requestedContractName?.trim();
  let selectedBaseName: string | null = null;
  if (requestedName) {
    const requestedFile = `${requestedName}.pvm`;
    if (pvmFiles.includes(requestedFile)) {
      selectedBaseName = requestedName;
    }
  }

  if (!selectedBaseName && pvmFiles.length === 1) {
    selectedBaseName = path.basename(pvmFiles[0], ".pvm");
  }

  if (!selectedBaseName) {
    const candidates = pvmFiles.map((file) => path.basename(file, ".pvm")).join(", ");
    if (requestedName) {
      throw new Error(
        `Requested contract '${requestedName}' was not found in compiler output. Available artifacts: ${candidates}`,
      );
    }
    throw new Error(
      `Compiler produced multiple .pvm artifacts. Use --contract-name to select one of: ${candidates}`,
    );
  }

  const scriptPath = path.join(normalizedOutputDir, `${selectedBaseName}.pvm`);
  const abiPath = path.join(normalizedOutputDir, `${selectedBaseName}.abi`);
  if (!fs.existsSync(abiPath)) {
    throw new Error(`ABI artifact is missing for contract '${selectedBaseName}': ${abiPath}`);
  }

  const optionalFile = (suffix: string): string | undefined => {
    const candidate = path.join(normalizedOutputDir, `${selectedBaseName}${suffix}`);
    return fs.existsSync(candidate) ? candidate : undefined;
  };

  return {
    contractName: selectedBaseName,
    compilerOutputDir: normalizedOutputDir,
    scriptPath,
    abiPath,
    debugPath: optionalFile(".debug"),
    asmPath: optionalFile(".asm"),
    scriptHexPath: optionalFile(".pvm.hex"),
    abiHexPath: optionalFile(".abi.hex"),
  };
}
