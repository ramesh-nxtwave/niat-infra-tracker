import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.basename(moduleDir) === "dist"
  ? path.dirname(moduleDir)
  : path.resolve(moduleDir, "..", "..");

export const uploadsDir = path.join(artifactDir, "uploads");