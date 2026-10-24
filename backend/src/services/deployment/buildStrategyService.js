
import fs from "node:fs/promises";
import path from "node:path";

const exists = async (repoPath, file) => {
    try {
        await fs.access(path.join(repoPath, file));
        return true;
    } catch {
        return false;
    }
};

const readJson = async (filePath) => {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
        return {};
    }
};

export const detectBuildStrategy = async (repoPath) => {
    // Check for an existing Dockerfile first.
    if (await exists(repoPath, "Dockerfile")) {
        return {
            success: true,
            strategy: "docker",
            buildTool: "Docker",
            reason: "Existing Dockerfile found",
            commands: [
                ["docker", "build", "-t", "devops-agent-app", "."]
            ]
        };
    }

    // JavaScript / TypeScript
    if (await exists(repoPath, "package.json")) {
        const packageJson = await readJson(
            path.join(repoPath, "package.json")
        );

        const scripts = packageJson.scripts || {};

        if (await exists(repoPath, "package-lock.json")) {
            return {
                success: true,
                strategy: "nodejs",
                buildTool: "npm",
                installCommand: ["npm", "ci"],
                buildCommand: scripts.build
                    ? ["npm", "run", "build"]
                    : null,
                startCommand: scripts.start
                    ? ["npm", "start"]
                    : null,
                reason: "Node.js project with package-lock.json"
            };
        }

        return {
            success: true,
            strategy: "nodejs",
            buildTool: "npm",
            installCommand: ["npm", "install"],
            buildCommand: scripts.build
                ? ["npm", "run", "build"]
                : null,
            startCommand: scripts.start
                ? ["npm", "start"]
                : null,
            reason: "package.json found"
        };
    }

    // Python
    if (
        await exists(repoPath, "requirements.txt") ||
        await exists(repoPath, "pyproject.toml")
    ) {
        return {
            success: true,
            strategy: "python",
            buildTool: "pip",
            installCommand: await exists(repoPath, "requirements.txt")
                ? ["python", "-m", "pip", "install", "-r", "requirements.txt"]
                : ["python", "-m", "pip", "install", "."],
            reason: "Python dependency file found"
        };
    }

    // Java with Maven
    if (await exists(repoPath, "pom.xml")) {
        return {
            success: true,
            strategy: "java-maven",
            buildTool: "Maven",
            buildCommand: ["mvn", "package", "-DskipTests"],
            reason: "pom.xml found"
        };
    }

    // Java / Kotlin with Gradle
    if (
        await exists(repoPath, "gradlew") ||
        await exists(repoPath, "gradlew.bat")
    ) {
        return {
            success: true,
            strategy: "gradle",
            buildTool: "Gradle Wrapper",
            buildCommand: process.platform === "win32"
                ? ["gradlew.bat", "build"]
                : ["./gradlew", "build"],
            reason: "Gradle wrapper found"
        };
    }

    if (
        await exists(repoPath, "build.gradle") ||
        await exists(repoPath, "build.gradle.kts")
    ) {
        return {
            success: true,
            strategy: "gradle",
            buildTool: "Gradle",
            buildCommand: ["gradle", "build"],
            reason: "Gradle build file found"
        };
    }

    // Go
    if (await exists(repoPath, "go.mod")) {
        return {
            success: true,
            strategy: "go",
            buildTool: "Go",
            buildCommand: ["go", "build", "./..."],
            reason: "go.mod found"
        };
    }

    // Rust
    if (await exists(repoPath, "Cargo.toml")) {
        return {
            success: true,
            strategy: "rust",
            buildTool: "Cargo",
            buildCommand: ["cargo", "build", "--release"],
            reason: "Cargo.toml found"
        };
    }

    // .NET
    const files = await fs.readdir(repoPath);
    const dotnetFile = files.find(
        file => file.endsWith(".sln") || file.endsWith(".csproj")
    );

    if (dotnetFile) {
        return {
            success: true,
            strategy: "dotnet",
            buildTool: ".NET CLI",
            buildCommand: ["dotnet", "build", dotnetFile],
            reason: `${dotnetFile} found`
        };
    }

    return {
        success: false,
        strategy: null,
        reason: "No supported build configuration found"
    };
};
