
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const runDocker = async (args, timeout = 120000) => {
    const { stdout, stderr } = await execFileAsync(
        "docker",
        args,
        {
            timeout,
            windowsHide: true,
            maxBuffer: 5 * 1024 * 1024
        }
    );

    return {
        stdout: stdout.trim(),
        stderr: stderr.trim()
    };
};

export const buildDockerImage = async (repoPath, imageName) => {
    if (!path.isAbsolute(repoPath)) {
        throw new Error("Repository path must be absolute");
    }

   if (!/^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9_][a-zA-Z0-9_.-]*)?$/.test(imageName)) {
    throw new Error("Invalid Docker image name");
}

    const dockerfile = path.join(repoPath, "Dockerfile");
    await fs.access(dockerfile);

    const result = await runDocker(
        ["build", "--tag", imageName, "--file", dockerfile, repoPath],
        10 * 60 * 1000
    );

    return {
        success: true,
        imageName,
        output: result.stdout
    };
};

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

    const result = await runDocker([
        "run",
        "--detach",
        "--publish", `127.0.0.1:${hostPort}:${containerPort}`,
        "--name", `devops-${Date.now()}`,
        "--memory", "512m",
        "--cpus", "1",
        "--pids-limit", "128",
        "--network", "bridge",
        imageName
    ]);

    return {
        success: true,
        containerId: result.stdout
    };
};
