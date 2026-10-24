
import fs from "node:fs/promises";
import path from "node:path";

const exists = async (filePath) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

const readJson = async (filePath) => {
    try {
        return JSON.parse(
            await fs.readFile(filePath, "utf8")
        );
    } catch {
        return {};
    }
};

export const analyzeRepository = async (repoPath) => {
    const languages = new Set();
    const frameworks = new Set();
    const buildTools = new Set();
    const files = [];

    const addIfExists = async (file, callback) => {
        if (await exists(path.join(repoPath, file))) {
            files.push(file);
            callback?.();
        }
    };

    // JavaScript / TypeScript
    const packageJson = await readJson(
        path.join(repoPath, "package.json")
    );

    const tsConfigExists = await exists(
        path.join(repoPath, "tsconfig.json")
    );

    if (Object.keys(packageJson).length > 0) {
        const deps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies
        };

        languages.add("JavaScript");

        if (tsConfigExists) languages.add("TypeScript");

        if (deps.react) frameworks.add("React");
        if (deps.next) frameworks.add("Next.js");
        if (deps.express) frameworks.add("Express");
        if (deps.vue) frameworks.add("Vue");
        if (deps["@angular/core"]) frameworks.add("Angular");
        if (deps.nestjs || deps["@nestjs/core"]) {
            frameworks.add("NestJS");
        }

        if (packageJson.scripts?.build) {
            buildTools.add("npm");
        }

        files.push("package.json");
    }

    if (tsConfigExists) {
        languages.add("TypeScript");
        files.push("tsconfig.json");
    }

    // Python
    for (const file of [
        "requirements.txt",
        "pyproject.toml",
        "Pipfile",
        "setup.py"
    ]) {
        await addIfExists(file, () => languages.add("Python"));
    }

    const requirementsPath = path.join(
        repoPath,
        "requirements.txt"
    );

    try {
        const requirements = await fs.readFile(
            requirementsPath,
            "utf8"
        );

        if (/fastapi/i.test(requirements)) frameworks.add("FastAPI");
        if (/django/i.test(requirements)) frameworks.add("Django");
        if (/flask/i.test(requirements)) frameworks.add("Flask");
    } catch {}

    // Java
    if (await exists(path.join(repoPath, "pom.xml"))) {
        languages.add("Java");
        buildTools.add("Maven");
        files.push("pom.xml");
    }

    for (const file of ["build.gradle", "build.gradle.kts"]) {
        await addIfExists(file, () => {
            languages.add("Java");
            buildTools.add("Gradle");
        });
    }

    // Go
    await addIfExists("go.mod", () => {
        languages.add("Go");
        buildTools.add("Go Modules");
    });

    // PHP
    await addIfExists("composer.json", () => {
        languages.add("PHP");
        buildTools.add("Composer");
    });

    // Ruby
    await addIfExists("Gemfile", () => {
        languages.add("Ruby");
        buildTools.add("Bundler");
    });

    // C# / .NET and Rust
    const rootFiles = await fs.readdir(repoPath, {
        withFileTypes: true
    });

    if (rootFiles.some(file => file.name.endsWith(".csproj") ||
        file.name.endsWith(".sln"))) {
        languages.add("C#");
        buildTools.add(".NET");
    }

    await addIfExists("Cargo.toml", () => {
        languages.add("Rust");
        buildTools.add("Cargo");
    });

    // C / C++
    const sourceFiles = rootFiles
        .filter(file => file.isFile())
        .map(file => file.name);

    if (sourceFiles.some(file => /\.(c|h)$/i.test(file))) {
        languages.add("C");
    }

    if (
        sourceFiles.some(file => /\.(cpp|cc|cxx|hpp|hh)$/i.test(file)) ||
        sourceFiles.includes("CMakeLists.txt")
    ) {
        languages.add("C++");
    }

    if (sourceFiles.includes("CMakeLists.txt")) {
        buildTools.add("CMake");
    }

    // Existing Docker configuration
    if (await exists(path.join(repoPath, "Dockerfile"))) {
        files.push("Dockerfile");
    }

    if (languages.size === 0) {
        return {
            success: true,
            detected: false,
            message: "No supported language detected",
            languages: [],
            frameworks: [],
            buildTools: [],
            files
        };
    }

    return {
        success: true,
        detected: true,
        languages: [...languages],
        frameworks: [...frameworks],
        buildTools: [...buildTools],
        files
    };
};
