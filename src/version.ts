import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

interface PackageMetadata {
  version: string;
}

const require = createRequire(import.meta.url);

function loadPackageMetadata(): PackageMetadata {
  const productionPackageUrl = new URL("../package.json", import.meta.url);

  const productionPackagePath = fileURLToPath(productionPackageUrl);

  const productionPackageExists = existsSync(productionPackagePath);

  if (productionPackageExists) {
    const packageMetadata = require(productionPackagePath) as PackageMetadata;

    return packageMetadata;
  }

  const testPackageUrl = new URL("../../package.json", import.meta.url);

  const testPackagePath = fileURLToPath(testPackageUrl);

  const packageMetadata = require(testPackagePath) as PackageMetadata;

  return packageMetadata;
}

const packageMetadata = loadPackageMetadata();

export const version = packageMetadata.version;
