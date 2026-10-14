import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Run independently isolated children sequentially; never attach to or terminate a user instance.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const file of ["interaction.mjs", "business.mjs"]) {
  const child = spawn(process.execPath, [path.join(here, file)], { env: process.env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) { process.exitCode = code || 1; break; }
}
