import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPoint = path.join(artifactDir, "dist", "index.mjs");
const startupTimeoutMs = 15_000;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: artifactDir,
      stdio: "inherit",
      ...options,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code ?? signal}`));
      }
    });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve an isolated startup-check port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForListening(child, port) {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Built API exited before listening (${child.exitCode ?? child.signalCode})`,
      );
    }
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Built API did not listen within ${startupTimeoutMs}ms`);
}

function stop(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const forceKill = setTimeout(() => child.kill("SIGKILL"), 12_000);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(forceKill);
      if (code === 0 || signal === "SIGTERM") {
        resolve();
      } else {
        reject(new Error(`Built API shutdown failed (${code ?? signal})`));
      }
    });
    child.kill("SIGTERM");
  });
}

await run(process.execPath, ["build.mjs"]);

const port = await reservePort();
const child = spawn(process.execPath, ["--enable-source-maps", entryPoint], {
  cwd: artifactDir,
  env: { ...process.env, NODE_ENV: "test", PORT: String(port) },
  stdio: "inherit",
});

try {
  await waitForListening(child, port);
  console.log(`Built API startup check passed on port ${port}`);
} finally {
  await stop(child);
}