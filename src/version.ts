import fs from "node:fs";
import path from "node:path";
import {
  CONTRACT_COMPILER_NAME,
  findExecutableInPath,
  queryCompilerVersion,
} from "./contract/compiler";

export interface VersionReport {
  phaDeployVersion: string;
  tombVersion: string;
  tombPath: string;
}

export function readRequiredPackageVersion(
  packageJsonPath: string = path.resolve(__dirname, "..", "package.json"),
): string {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    version?: string;
  };
  const version = packageJson.version?.trim();
  if (!version) {
    throw new Error(`Missing package version in ${packageJsonPath}`);
  }
  return version;
}

export async function buildVersionReport(
  envPath: string = process.env.PATH ?? "",
  packageJsonPath?: string,
): Promise<VersionReport> {
  const phaDeployVersion = readRequiredPackageVersion(packageJsonPath);
  const tombPath = findExecutableInPath(CONTRACT_COMPILER_NAME, envPath);
  if (!tombPath) {
    return {
      phaDeployVersion,
      tombVersion: "not found",
      tombPath: "not found",
    };
  }

  try {
    return {
      phaDeployVersion,
      tombVersion: await queryCompilerVersion(tombPath),
      tombPath,
    };
  } catch (error) {
    return {
      phaDeployVersion,
      tombVersion: `unavailable (${error instanceof Error ? error.message : String(error)})`,
      tombPath,
    };
  }
}

export function renderVersionReport(report: VersionReport): string {
  return [
    `pha-deploy ${report.phaDeployVersion}`,
    `pha-tomb version ${report.tombVersion}`,
    `pha-tomb path ${report.tombPath}`,
  ].join("\n");
}
