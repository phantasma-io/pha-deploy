import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRequiredPackageVersion, renderVersionReport } from "../src/version";

test("readRequiredPackageVersion reads version from package.json", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-version-"));
  const packageJsonPath = path.join(tempRoot, "package.json");
  fs.writeFileSync(packageJsonPath, JSON.stringify({ version: "9.9.9" }), "utf8");

  assert.equal(readRequiredPackageVersion(packageJsonPath), "9.9.9");
});

test("readRequiredPackageVersion throws when version is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pha-deploy-version-missing-"));
  const packageJsonPath = path.join(tempRoot, "package.json");
  fs.writeFileSync(packageJsonPath, JSON.stringify({}), "utf8");

  assert.throws(() => readRequiredPackageVersion(packageJsonPath), {
    message: `Missing package version in ${packageJsonPath}`,
  });
});

test("renderVersionReport keeps pha-tomb path and version on dedicated lines", () => {
  const report = renderVersionReport({
    phaDeployVersion: "0.3.0",
    tombVersion: "2.0.0",
    tombPath: "/usr/local/bin/pha-tomb",
  });

  assert.equal(
    report,
    [
      "pha-deploy 0.3.0",
      "pha-tomb version 2.0.0",
      "pha-tomb path /usr/local/bin/pha-tomb",
    ].join("\n"),
  );
});
