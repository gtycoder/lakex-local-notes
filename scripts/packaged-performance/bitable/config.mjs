/** Explicit packaged executable + synthetic /tmp fixture only; no production data or credentials. */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
export const fixture = process.env.LAKE_PERF_FIXTURE;
export const executable = process.env.LAKE_PACKAGED_EXECUTABLE;
if (!fixture || !path.isAbsolute(fixture) || !executable || !path.isAbsolute(executable))
  throw new Error("Set absolute LAKE_PERF_FIXTURE and LAKE_PACKAGED_EXECUTABLE paths");
const resolved = fs.realpathSync(fixture);
if (!/^\/(?:private\/)?tmp\/lake-/.test(resolved)) throw new Error("Fixture must be a synthetic /tmp/lake-* directory");
if (!fs.existsSync(executable)) throw new Error("Packaged executable not found");
const contract = JSON.parse(fs.readFileSync(path.join(fixture, "fixture.json")));
if (contract.documents !== 5000 || contract.assetFiles !== 20000)
  throw new Error("Expected synthetic packaged-performance fixture contract (5000 documents/20000 attachments)");
const model = JSON.parse(fs.readFileSync(path.join(fixture, "workspace-default/bitables/perf-bitable-5000.bitable.json")));
if (model.tables[0]?.records.length !== 5000 || model.tables[0]?.fields.length !== 20)
  throw new Error("Expected the isolated 5000×20 packaged-performance fixture");
export const root = path.resolve(process.env.LAKE_PERF_EVIDENCE || ".css-audit/bitable-packaged");
fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
export const cdpPort = Number(process.env.LAKE_PERF_CDP_PORT || 9301);
export const mainPort = cdpPort + 1;
export const assetPort = Number(process.env.LAKE_PERF_ASSET_PORT || 19901);
export async function assertFreePorts() {
  for (const port of [cdpPort, mainPort, assetPort]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid test port");
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () => reject(new Error(`Test port ${port} is occupied`)));
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
  }
}
export function newDataDir(label) {
  return fs.mkdtempSync(path.join("/tmp", `lake-bitable-${label}-`));
}
