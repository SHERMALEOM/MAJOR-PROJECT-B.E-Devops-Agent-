
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

const repositoryRoot = path.resolve(
    process.cwd(),
    "temp",
    "repositories"
);

export const cloneRepository = async (githubUrl) => {
    // Accept public HTTPS GitHub repository URLs only.
    let url;

    try {
        url = new URL(githubUrl);
    } catch {
        throw new Error("Invalid GitHub URL");
    }

    if (
        url.hostname !== "github.com" ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
    ) {
        throw new Error("Only HTTPS GitHub repository URLs are allowed");
    }

    const match = url.pathname.match(
        /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/
    );

    if (!match) {
        throw new Error("Provide a repository URL like https://github.com/owner/repo");
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, "");

    if (!repo) {
        throw new Error("Invalid repository name");
    }

    const normalizedUrl = `https://github.com/${owner}/${repo}.git`;

    await fs.mkdir(repositoryRoot, { recursive: true });

    // Generate a unique folder to avoid repository-name collisions.
    const folderName = crypto.randomUUID();
    const destination = path.join(repositoryRoot, folderName);

    try {
        await execFileAsync(
            "git",
            ["clone", "--depth", "1", "--", normalizedUrl, destination],
            { timeout: 120000, windowsHide: true }
        );

        return {
            success: true,
            repositoryName: repo,
            localPath: destination
        };
    } catch (error) {
        await fs.rm(destination, {
            recursive: true,
            force: true
        });

        throw new Error(
            `Repository clone failed: ${error.stderr || error.message}`
        );
    }
};
