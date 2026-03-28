import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCompileArgs,
  findExecutableInPath,
  isSemverGte,
  selectCompiledContractArtifacts,
} from "../src/contract/compiler";

test("semantic version gate accepts newer patch versions", () => {
  assert.equal(isSemverGte("2.0.1", "2.0.0"), true);
  assert.equal(isSemverGte("2.0.0", "2.0.0"), true);
  assert.equal(isSemverGte("1.9.9", "2.0.0"), false);
});

test("findExecutableInPath resolves the first executable match", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-path-"));
  const binA = path.join(tempRoot, "bin-a");
  const binB = path.join(tempRoot, "bin-b");
  fs.mkdirSync(binA);
  fs.mkdirSync(binB);

  const tombPath = path.join(binB, "pha-tomb");
  fs.writeFileSync(tombPath, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

  const resolved = findExecutableInPath("pha-tomb", [binA, binB].join(path.delimiter), "linux");
  assert.equal(resolved, tombPath);
});

test("buildCompileArgs keeps compiler invocation strict and explicit", () => {
  const args = buildCompileArgs({
    sourcePath: "/tmp/sample.tomb",
    outputRoot: "/tmp/build-root",
    libPaths: ["/tmp/libs"],
    protocol: 19,
    debug: true,
    nativeCheck: "warn",
  });

  assert.deepEqual(args, [
    "output:/tmp/build-root",
    "protocol:19",
    "libpath:/tmp/libs",
    "debug",
    "nativecheck:warn",
    "/tmp/sample.tomb",
  ]);
});

test("selectCompiledContractArtifacts picks the requested contract and optional extras", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-artifacts-"));
  const outputDir = path.join(tempRoot, "Output");
  fs.mkdirSync(outputDir);

  const write = (fileName: string) => fs.writeFileSync(path.join(outputDir, fileName), "x");
  write("Alpha.pvm");
  write("Alpha.abi");
  write("Alpha.debug");
  write("Alpha.asm");
  write("Alpha.pvm.hex");
  write("Alpha.abi.hex");
  write("Beta.pvm");
  write("Beta.abi");

  const artifacts = selectCompiledContractArtifacts(outputDir, "Alpha");
  assert.equal(artifacts.contractName, "Alpha");
  assert.equal(path.basename(artifacts.scriptPath), "Alpha.pvm");
  assert.equal(path.basename(artifacts.abiPath), "Alpha.abi");
  assert.equal(path.basename(artifacts.debugPath ?? ""), "Alpha.debug");
  assert.equal(path.basename(artifacts.asmPath ?? ""), "Alpha.asm");
  assert.equal(path.basename(artifacts.scriptHexPath ?? ""), "Alpha.pvm.hex");
  assert.equal(path.basename(artifacts.abiHexPath ?? ""), "Alpha.abi.hex");
});
