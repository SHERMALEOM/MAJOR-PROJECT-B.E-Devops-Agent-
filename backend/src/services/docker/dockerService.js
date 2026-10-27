
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";

// Execute Docker commands safely and capture output.
const runDocker = (
    args,
    timeout = 120000,
    onOutput = () => {}
) =>
    new Promise((resolve, reject) => {
        const child = spawn("docker", args, {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;
        let oversized = false;
        let totalOutput = 0;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeout);

        const finish = (error, result) => {
            if (settled) return;

            settled = true;
            clearTimeout(timer);

            if (error) reject(error);
            else resolve(result);
        };

        const capture = (chunk, stream) => {
            const value = chunk.toString();

            totalOutput += chunk.length;

            if (totalOutput > 5 * 1024 * 1024) {
                oversized = true;
                child.kill();
            }

            if (stream === "stdout") {
                stdout = (stdout + value).slice(-5 * 1024 * 1024);
            } else {
                stderr = (stderr + value).slice(-5 * 1024 * 1024);
            }

            try {
                onOutput(value, stream === "stdout" ? "info" : "warning");
            } catch {
                // Logging must not interrupt Docker operations.
            }
        };

        child.stdout.on("data", chunk => capture(chunk, "stdout"));
        child.stderr.on("data", chunk => capture(chunk, "stderr"));

        child.on("error", error => finish(error));

        child.on("close", code => {
            if (timedOut) {
                return finish(
                    new Error(`Docker command timed out after ${timeout} ms`)
                );
            }

            if (oversized) {
                return finish(
                    new Error("Docker output exceeded the 5 MB safety limit")
                );
            }

            if (code !== 0) {
                const error = new Error(
                    (stderr || stdout || `Docker exited with code ${code}`).trim()
                );

                error.stderr = stderr;
                error.stdout = stdout;

                return finish(error);
            }

            finish(null, {
                stdout: stdout.trim(),
                stderr: stderr.trim()
            });
        });
    });

// Build a Docker image from a repository.
export const buildDockerImage = async (
    repoPath,
    imageName,
    { onOutput } = {}
) => {
    if (!path.isAbsolute(repoPath)) {
        throw new Error("Repository path must be absolute");
    }

    if (
        !/^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9_][a-zA-Z0-9_.-]*)?$/.test(
            imageName
        )
    ) {
        throw new Error("Invalid Docker image name");
    }

    const dockerfile = path.join(repoPath, "Dockerfile");
    await fs.access(dockerfile);

    const result = await runDocker(
        ["build", "--tag", imageName, "--file", dockerfile, repoPath],
        10 * 60 * 1000,
        onOutput
    );

    return {
        success: true,
        imageName,
        output: result.stdout
    };
};

// Check whether a host port is available.
const hostPortAvailable = port =>
    new Promise(resolve => {
        const server = net.createServer();

        server.once("error", () => resolve(false));

        server.listen(port, "127.0.0.1", () => {
            server.close(() => resolve(true));
        });
    });

// Find a free port within a limited range.
const findFreeHostPort = async start => {
    for (
        let port = Math.max(1024, start);
        port <= Math.min(65535, start + 100);
        port++
    ) {
        if (await hostPortAvailable(port)) {
            return port;
        }
    }

    throw new Error("No free host port found in the deployment range");
};

// Start a container and diagnose immediate startup failures.
export const runDockerContainer = async (
    imageName,
    hostPort,
    containerPort
) => {
    for (const port of [hostPort, containerPort]) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error("Ports must be integers between 1 and 65535");
        }
    }

    let selectedPort = hostPort;
    let result;

    for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
            selectedPort = await findFreeHostPort(selectedPort + 1);
        }

        try {
            result = await runDocker([
                "run",
                "--detach",
                "--publish",
                `127.0.0.1:${selectedPort}:${containerPort}`,
                "--name",
                `devops-${crypto.randomUUID()}`,
                "--memory",
                "512m",
                "--cpus",
                "1",
                "--pids-limit",
                "128",
                "--security-opt",
                "no-new-privileges:true",
                "--cap-drop",
                "ALL",
                "--network",
                "bridge",
                imageName
            ]);

            break;
        } catch (error) {
            const detail = `${error.stderr || ""} ${error.message || ""}`;

            const isPortConflict =
                /port is already allocated|address already in use|bind.*failed/i.test(
                    detail
                );

            if (!isPortConflict || attempt === 4) {
                throw error;
            }
        }
    }

    const containerId = result?.stdout?.trim();

    if (!containerId) {
        throw new Error("Docker did not return a container ID");
    }

    // Allow the process time to start.
    await new Promise(resolve => setTimeout(resolve, 2000));

    let inspect;

    try {
        inspect = await runDocker([
            "inspect",
            "--format",
            "{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}",
            containerId
        ]);
    } catch (error) {
        // Keep the container for investigation if inspection fails.
        throw new Error(
            `Container ${containerId} was created, but inspection failed: ${error.message}`
        );
    }

    const [status, exitCode, stateError] = inspect.stdout.split("|");

    if (status !== "running") {
        let logs = "";

        try {
            const logResult = await runDocker([
                "logs",
                "--tail",
                "80",
                containerId
            ]);

            logs = logResult.stdout || logResult.stderr;
        } catch (error) {
            logs = error.message;
        }

        // Do not remove the container here; preserve it for debugging.
        throw new Error(
            `Container failed to stay running. ` +
            `Status=${status}, ExitCode=${exitCode}, ` +
            `Error=${stateError || "none"}. ` +
            `Container=${containerId}. Logs:\n${logs}`
        );
    }

    return {
        success: true,
        containerId,
        hostPort: selectedPort
    };
};

// Remove a container when explicitly requested.
export const removeDockerContainer = async containerId => {
    if (!/^[a-f\d]{12,64}$/i.test(String(containerId))) {
        throw new Error("Invalid container ID for cleanup");
    }

    await runDocker(["rm", "--force", containerId]);
};

// Remove an image when explicitly requested.
export const removeDockerImage = async imageName => {
    if (
        !/^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9_][a-zA-Z0-9_.-]*)?$/.test(
            String(imageName)
        )
    ) {
        throw new Error("Invalid Docker image name for cleanup");
    }

    await runDocker(["image", "rm", "--force", imageName]);
};
