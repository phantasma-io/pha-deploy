import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCompileArgs,
  findExecutableInPath,
  isSemverGte,
  resolveSupportedCompiler,
  selectCompiledContractArtifacts,
} from "../src/contract/compiler";

test("semantic version gate accepts the supported tomb baseline and newer patches", () => {
  assert.equal(isSemverGte("2.1.1", "2.1.0"), true);
  assert.equal(isSemverGte("2.1.0", "2.1.0"), true);
  assert.equal(isSemverGte("2.0.9", "2.1.0"), false);
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

test("resolveSupportedCompiler prefers an explicit compiler path", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-compiler-"));
  const compilerPath = path.join(tempRoot, "pha-tomb-custom");
  fs.writeFileSync(
    compilerPath,
    "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then\n  echo 2.1.0\n  exit 0\nfi\nexit 0\n",
    { mode: 0o755 },
  );

  const compiler = await resolveSupportedCompiler("2.1.0", "", compilerPath);

  assert.equal(compiler.executablePath, compilerPath);
  assert.equal(compiler.executableName, "pha-tomb-custom");
  assert.equal(compiler.version, "2.1.0");
});

test("resolveSupportedCompiler rejects an explicit compiler path below the minimum version", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-compiler-old-"));
  const compilerPath = path.join(tempRoot, "pha-tomb-old");
  fs.writeFileSync(
    compilerPath,
    "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then\n  echo 2.0.1\n  exit 0\nfi\nexit 0\n",
    { mode: 0o755 },
  );

  await assert.rejects(
    () => resolveSupportedCompiler("2.1.0", "", compilerPath),
    /below the minimum supported version 2\.1\.0/,
  );
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
