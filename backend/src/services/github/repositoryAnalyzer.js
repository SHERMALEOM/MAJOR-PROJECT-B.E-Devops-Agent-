
import fs from "node:fs/promises";
import path from "node:path";

const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "coverage",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    "target"
]);

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
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
        return {};
    }
};

const collectProjectFiles = async (root, maxDepth = 3) => {
    const results = [];

    const walk = async (current, depth) => {
        let entries;

        try {
            entries = await fs.readdir(current, {
                withFileTypes: true
            });
        } catch {
            return;
        }

        for (const entry of entries) {
            const absolutePath = path.join(current, entry.name);
            const relativePath = path.relative(root, absolutePath);

            if (entry.isFile()) {
                results.push(relativePath);
                continue;
            }

            if (
                entry.isDirectory() &&
                depth < maxDepth &&
                !entry.name.startsWith(".") &&
                !SKIP_DIRS.has(entry.name)
            ) {
                await walk(absolutePath, depth + 1);
            }
        }
    };

    await walk(root, 0);
    return results;
};

export const analyzeRepository = async (repoPath) => {
    const languages = new Set();
    const frameworks = new Set();
    const buildTools = new Set();

    const allFiles = await collectProjectFiles(repoPath);
    const files = [];

    const has = (name) => allFiles.some(
        file => file.split(path.sep).join("/") === name
    );

    const addManifest = (name) => {
        const found = allFiles.filter(
            file => file.split(path.sep).join("/") === name ||
                file.split(path.sep).join("/").endsWith(`/${name}`)
        );

        for (const file of found) {
            if (!files.includes(file)) files.push(file);
        }

        return found;
    };

    // JavaScript / TypeScript projects, including monorepos.
    const packageFiles = addManifest("package.json");
    const tsConfigFiles = addManifest("tsconfig.json");

    if (packageFiles.length > 0) {
        languages.add("JavaScript");
        buildTools.add("npm");
    }

    if (tsConfigFiles.length > 0) {
        languages.add("TypeScript");
    }

    for (const packageFile of packageFiles) {
        const packagePath = path.join(repoPath, packageFile);
        const packageJson = await readJson(packagePath);

        const deps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
            ...packageJson.peerDependencies
        };

        if (deps.react) frameworks.add("React");
        if (deps.vite) frameworks.add("Vite");
        if (deps.next) frameworks.add("Next.js");
        if (deps.express) frameworks.add("Express");
        if (deps.vue) frameworks.add("Vue");
        if (deps["@angular/core"]) frameworks.add("Angular");

        if (deps["@nestjs/core"]) {
            frameworks.add("NestJS");
        }

        if (deps.svelte) frameworks.add("Svelte");
        if (deps.nuxt) frameworks.add("Nuxt");
        if (deps.astro) frameworks.add("Astro");

        if (packageJson.scripts?.build) {
            buildTools.add("npm");
        }

        if (packageJson.packageManager?.startsWith("pnpm")) {
            buildTools.add("pnpm");
        } else if (packageJson.packageManager?.startsWith("yarn")) {
            buildTools.add("Yarn");
        }

        if (packageJson.scripts?.start) {
            // The start script is recorded by the package itself.
            // Do not assume every package.json is independently deployable.
        }
    }

    // Python
    const pythonManifests = [
        "requirements.txt",
        "pyproject.toml",
        "Pipfile",
        "setup.py"
    ];

    for (const manifest of pythonManifests) {
        if (addManifest(manifest).length > 0) {
            languages.add("Python");
        }
    }

    const requirementFiles = allFiles.filter(
        file => file.split(path.sep).join("/").endsWith("/requirements.txt") ||
            file === "requirements.txt"
    );

    for (const file of requirementFiles) {
        try {
            const content = await fs.readFile(
                path.join(repoPath, file),
                "utf8"
            );

            if (/fastapi/i.test(content)) frameworks.add("FastAPI");
            if (/django/i.test(content)) frameworks.add("Django");
            if (/flask/i.test(content)) frameworks.add("Flask");
        } catch {
            // Ignore unreadable optional manifests.
        }
    }

    const pyprojectFiles = allFiles.filter(
        file => path.basename(file) === "pyproject.toml"
    );

    for (const file of pyprojectFiles) {
        try {
            const content = await fs.readFile(
                path.join(repoPath, file),
                "utf8"
            );

            if (/fastapi/i.test(content)) frameworks.add("FastAPI");
            if (/django/i.test(content)) frameworks.add("Django");
            if (/flask/i.test(content)) frameworks.add("Flask");
        } catch {
            // Ignore unreadable optional manifests.
        }
    }

    // Java
    if (addManifest("pom.xml").length > 0) {
        languages.add("Java");
        buildTools.add("Maven");
    }

    if (
        addManifest("build.gradle").length > 0 ||
        addManifest("build.gradle.kts").length > 0
    ) {
        languages.add("Java");
        buildTools.add("Gradle");
    }

    // Go
    if (addManifest("go.mod").length > 0) {
        languages.add("Go");
        buildTools.add("Go Modules");
    }

    // PHP
    if (addManifest("composer.json").length > 0) {
        languages.add("PHP");
        buildTools.add("Composer");
    }

    // Ruby
    if (addManifest("Gemfile").length > 0) {
        languages.add("Ruby");
        buildTools.add("Bundler");
    }

    // C# / .NET
    if (
        allFiles.some(file => /\.csproj$/i.test(file)) ||
        allFiles.some(file => /\.sln$/i.test(file))
    ) {
        languages.add("C#");
        buildTools.add(".NET");
    }

    // Rust
    if (addManifest("Cargo.toml").length > 0) {
        languages.add("Rust");
        buildTools.add("Cargo");
    }

    // C / C++
    if (allFiles.some(file => /\.(c|h)$/i.test(file))) {
        languages.add("C");
    }

    if (
        allFiles.some(file => /\.(cpp|cc|cxx|hpp|hh|hxx)$/i.test(file)) ||
        has("CMakeLists.txt")
    ) {
        languages.add("C++");
    }

    if (addManifest("CMakeLists.txt").length > 0) {
        buildTools.add("CMake");
    }

    // Static websites
    if (
        has("index.html") &&
        languages.size === 0
    ) {
        languages.add("HTML");
    }

    if (allFiles.some(file => file.endsWith(".css"))) {
        languages.add("CSS");
    }

    // Existing Docker configuration anywhere in the scanned repository.
    const dockerfiles = allFiles.filter(
        file => path.basename(file).toLowerCase() === "dockerfile"
    );

    for (const file of dockerfiles) {
        if (!files.includes(file)) files.push(file);
    }

    // Keep the previous return contract.
    if (languages.size === 0 && dockerfiles.length === 0) {
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
