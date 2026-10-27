
import fs from "node:fs";
import path from "node:path";

const MAX_DEPTH = 5;

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".astro",
  ".svelte-kit",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  "vendor"
]);

const fail = (error, checkedFiles = []) => ({
  success: false,
  supported: false,
  detected: false,
  error,
  reason: error,
  checkedFiles
});

const exists = (filePath) => fs.existsSync(filePath);

const isFile = (filePath) => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readText = (filePath) => {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
};

const relativeFile = (root, file) =>
  path.relative(root, file).split(path.sep).join("/");

const listFiles = (root, maxDepth = MAX_DEPTH) => {
  const files = [];

  const walk = (directory, depth) => {
    if (depth > maxDepth) return;

    let entries;

    try {
      entries = fs.readdirSync(directory, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".well-known") {
        if (entry.name !== ".") continue;
      }

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        files.push(relativeFile(root, fullPath));
      }
    }
  };

  walk(root, 0);
  return files;
};

const listProjectRoots = (repositoryPath) => {
  const roots = [];

  const walk = (directory, depth) => {
    roots.push(path.resolve(directory));

    if (depth >= MAX_DEPTH) return;

    let entries;

    try {
      entries = fs.readdirSync(directory, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;

      walk(path.join(directory, entry.name), depth + 1);
    }
  };

  walk(repositoryPath, 0);

  return [...new Set(roots)];
};

const hasAnyFile = (root, names) =>
  names.some((name) => isFile(path.join(root, name)));

const hasPackageScript = (packageJson, name) =>
  typeof packageJson?.scripts?.[name] === "string";

const result = (projectRoot, details) => ({
  success: true,
  supported: true,
  detected: true,
  projectRoot: path.resolve(projectRoot),
  ...details
});

const hasDependency = (packageJson, name) =>
  Boolean(
    packageJson?.dependencies?.[name] ||
      packageJson?.devDependencies?.[name] ||
      packageJson?.peerDependencies?.[name]
  );

const detectNode = (root) => {
  const packagePath = path.join(root, "package.json");

  if (!isFile(packagePath)) return null;

  const pkg = readJson(packagePath);

  if (!pkg) {
    return fail(`Invalid package.json in ${root}`);
  }

  const scripts = pkg.scripts || {};
  const hasBuild = hasPackageScript(pkg, "build");
  const hasStart = hasPackageScript(pkg, "start");

  const hasYarnLock = exists(path.join(root, "yarn.lock"));
  const hasPnpmLock = exists(path.join(root, "pnpm-lock.yaml"));

  const lockfile = hasYarnLock
    ? "yarn"
    : hasPnpmLock
      ? "pnpm"
      : exists(path.join(root, "package-lock.json"))
        ? "npm"
        : "none";

  const common = {
    language: "javascript",
    packageManager: lockfile,
    packageJsonPath: packagePath,
    buildCommand: hasBuild ? "npm run build" : null,
    needsBuild: hasBuild
  };

  if (hasDependency(pkg, "next")) {
    if (!hasStart) {
      return fail(
        `Next.js project at ${root} needs a package.json start script.`
      );
    }

    return result(root, {
      ...common,
      strategy: "node-nextjs",
      framework: "nextjs",
      port: 3000,
      startCommand: "npm start"
    });
  }

  if (hasDependency(pkg, "nuxt")) {
    if (!hasStart) {
      return fail(
        `Nuxt project at ${root} needs a package.json start script.`
      );
    }

    return result(root, {
      ...common,
      strategy: "node-nuxt",
      framework: "nuxt",
      port: 3000,
      startCommand: "npm start"
    });
  }

  if (hasDependency(pkg, "@sveltejs/kit")) {
    if (!hasStart) {
      return fail(
        `SvelteKit project at ${root} needs a package.json start script.`
      );
    }

    return result(root, {
      ...common,
      strategy: "node-sveltekit",
      framework: "sveltekit",
      port: 3000,
      startCommand: "npm start"
    });
  }

  if (hasDependency(pkg, "@nestjs/core")) {
    if (!hasStart) {
      return fail(
        `NestJS project at ${root} needs a package.json start script.`
      );
    }

    return result(root, {
      ...common,
      strategy: "node-nestjs",
      framework: "nestjs",
      port: 3000,
      startCommand: "npm start"
    });
  }

  if (
    hasDependency(pkg, "vite") ||
    hasDependency(pkg, "react-scripts") ||
    hasDependency(pkg, "@angular/core")
  ) {
    if (!hasBuild) {
      return fail(
        `Frontend project at ${root} needs a package.json build script.`
      );
    }

    // Angular's current Dockerfile generator does not have an Angular
    // template. Do not falsely label it as a supported Vite application.
    if (hasDependency(pkg, "@angular/core")) {
      return fail(
        `Angular was detected at ${root}, but the current Dockerfile generator does not yet support Angular.`
      );
    }

    return result(root, {
      ...common,
      strategy: "static-vite",
      framework: hasDependency(pkg, "vite")
        ? "vite"
        : "react-scripts",
      port: 8080,
      startCommand: null
    });
  }

  if (hasDependency(pkg, "astro")) {
    if (!hasBuild) {
      return fail(
        `Astro project at ${root} needs a package.json build script.`
      );
    }

    if (hasDependency(pkg, "@astrojs/static")) {
      return result(root, {
        ...common,
        strategy: "static-astro",
        framework: "astro",
        port: 8080,
        startCommand: null
      });
    }

    return fail(
      `Astro at ${root} does not use the supported static output configuration. Configure static output or add a matching Dockerfile.`
    );
  }

  if (hasStart) {
    return result(root, {
      ...common,
      strategy: "node",
      framework: hasDependency(pkg, "express") ? "express" : "node",
      port: 3000,
      startCommand: "npm start"
    });
  }

  if (hasBuild) {
    return fail(
      `A build script was found at ${root}, but no supported runtime was identified. Add a start script or a matching Dockerfile.`
    );
  }

  return null;
};

const detectPython = (root) => {
  const requirementsPath = path.join(root, "requirements.txt");
  const pyprojectPath = path.join(root, "pyproject.toml");
  const pipfilePath = path.join(root, "Pipfile");
  const setupPath = path.join(root, "setup.py");

  const hasPythonManifest = [
    requirementsPath,
    pyprojectPath,
    pipfilePath,
    setupPath
  ].some(isFile);

  if (!hasPythonManifest) return null;

  const requirements = readText(requirementsPath).toLowerCase();
  const pyproject = readText(pyprojectPath).toLowerCase();
  const setup = readText(setupPath).toLowerCase();

  const allConfig = `${requirements}\n${pyproject}\n${setup}`;

  if (
    allConfig.includes("django") ||
    isFile(path.join(root, "manage.py"))
  ) {
    return fail(
      `Django was detected at ${root}, but the current Dockerfile generator does not have a Django template.`
    );
  }

  if (allConfig.includes("flask")) {
    return fail(
      `Flask was detected at ${root}, but the current Dockerfile generator does not have a Flask template.`
    );
  }

  if (!allConfig.includes("fastapi")) {
    return fail(
      `Python was detected at ${root}, but automatic deployment currently requires a supported FastAPI project or an existing Dockerfile.`
    );
  }

  const files = listFiles(root);
  const pythonFiles = files.filter((file) => file.endsWith(".py"));

  const entryCandidates = [
    "main.py",
    "app.py",
    "src/main.py",
    "src/app.py",
    "app/main.py"
  ];

  const entryFile = entryCandidates.find((file) =>
    pythonFiles.includes(file)
  );

  if (!entryFile) {
    return fail(
      `FastAPI was detected at ${root}, but an entry file such as main.py or app.py was not found.`
    );
  }

  const entrySource = readText(path.join(root, entryFile));

  const appMatch = entrySource.match(
    /\b([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/
  );

  if (!appMatch) {
    return fail(
      `Could not find a FastAPI application declaration in ${entryFile}.`
    );
  }

  const moduleName = entryFile
    .replace(/\.py$/i, "")
    .split(/[\\/]/)
    .join(".");

  return result(root, {
    strategy: "python-fastapi",
    language: "python",
    framework: "fastapi",
    port: 8000,
    entryFile,
    startCommand: `uvicorn ${moduleName}:${appMatch[1]} --host 0.0.0.0 --port 8000`,
    buildCommand: null,
    needsBuild: false
  });
};

const detectJava = (root) => {
  const pomPath = path.join(root, "pom.xml");
  const gradlePath = path.join(root, "build.gradle");
  const gradleKtsPath = path.join(root, "build.gradle.kts");

  if (
    !isFile(pomPath) &&
    !isFile(gradlePath) &&
    !isFile(gradleKtsPath)
  ) {
    return null;
  }

  return result(root, {
    strategy: "java",
    language: "java",
    framework: isFile(pomPath) ? "maven" : "gradle",
    port: 8080,
    buildCommand: isFile(pomPath)
      ? "mvn package"
      : "./gradlew build",
    startCommand: null,
    needsBuild: true
  });
};

const detectGo = (root) => {
  if (!isFile(path.join(root, "go.mod"))) return null;

  return result(root, {
    strategy: "go",
    language: "go",
    framework: "go",
    port: 8080,
    buildCommand: "go build",
    startCommand: null,
    needsBuild: true
  });
};

const detectStatic = (root) => {
  const files = listFiles(root);

  const htmlFiles = files.filter((file) => /\.html?$/i.test(file));

  if (!htmlFiles.length) return null;

  // Prefer a root index.html, then a nested index.html, then another HTML file.
  const html =
    htmlFiles.find((file) => file.toLowerCase() === "index.html") ||
    htmlFiles.find(
      (file) => path.posix.basename(file).toLowerCase() === "index.html"
    ) ||
    htmlFiles[0];

  const absoluteHtmlPath = path.resolve(
    root,
    ...html.split("/")
  );

  // Serve from the folder containing the chosen HTML file so relative
  // CSS, JavaScript and image paths remain relative to the page.
  const projectRoot = path.dirname(absoluteHtmlPath);

  return result(projectRoot, {
    strategy: "static-html",
    language: "html",
    framework: "static",
    entryFile: absoluteHtmlPath,
    entryFileName: path.basename(absoluteHtmlPath),
    buildCommand: null,
    startCommand: null,
    port: 8080,
    needsBuild: false,
    outputDirectory: projectRoot
  });
};

const detectExistingDockerfile = (root) => {
  const dockerfilePath = path.join(root, "Dockerfile");

  if (!isFile(dockerfilePath)) return null;

  const dockerfile = readText(dockerfilePath);

  const exposeMatches = [
    ...dockerfile.matchAll(/^\s*EXPOSE\s+(.+)$/gim)
  ];

  let port = null;

  // Prefer the last EXPOSE declaration in multi-stage Dockerfiles.
  // EXPOSE is a hint; the verification stage confirms the actual listener.
  for (let index = exposeMatches.length - 1; index >= 0; index--) {
    const candidates = exposeMatches[index][1]
      .trim()
      .split(/\\s+/)
      .map(value => value.split("/")[0]);

    const parsed = candidates
      .map(Number)
      .find(value => Number.isInteger(value) && value >= 1 && value <= 65535);

    if (parsed) {
      port = parsed;
      break;
    }
  }

  return result(root, {
    strategy: "dockerfile",
    language: "unknown",
    framework: "custom-dockerfile",
    dockerfilePath,
    port,
    requiresPortDetection: port === null,
    buildCommand: null,
    startCommand: null,
    needsBuild: true
  });
};

const scoreProjectRoot = (root) => {
  let score = 0;

  if (isFile(path.join(root, "Dockerfile"))) score += 100;

  if (
    hasAnyFile(root, [
      "package.json",
      "requirements.txt",
      "pyproject.toml",
      "Pipfile",
      "setup.py",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "go.mod"
    ])
  ) {
    score += 80;
  }

  if (isFile(path.join(root, "index.html"))) score += 35;

  return score;
};

export const findProjectRoots = (repositoryPath) =>
  listProjectRoots(path.resolve(repositoryPath));

export const selectProjectRoot = (repositoryPath) => {
  const roots = findProjectRoots(repositoryPath);
  const root = path.resolve(repositoryPath);

  // Prefer an application manifest at repository root.
  if (
    hasAnyFile(root, [
      "Dockerfile",
      "package.json",
      "requirements.txt",
      "pyproject.toml",
      "Pipfile",
      "setup.py",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "go.mod",
      "index.html"
    ])
  ) {
    return root;
  }

  const candidates = roots
    .filter((candidate) => candidate !== root)
    .map((candidate) => ({
      root: candidate,
      score: scoreProjectRoot(candidate)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.root || root;
};

export const detectBuildStrategy = async (repositoryPath) => {
  try {
    if (
      !repositoryPath ||
      !path.isAbsolute(repositoryPath) ||
      !exists(repositoryPath) ||
      !fs.statSync(repositoryPath).isDirectory()
    ) {
      return fail(
        "Repository path must be an existing absolute directory."
      );
    }

    const repositoryRoot = path.resolve(repositoryPath);
    const roots = findProjectRoots(repositoryRoot);

    const orderedRoots = [
      selectProjectRoot(repositoryRoot),
      repositoryRoot,
      ...roots
    ].filter((root, index, all) => all.indexOf(root) === index);

    const checkedFiles = [];

    for (const root of orderedRoots) {
      const rootRelative = path.relative(repositoryRoot, root);

      if (
        rootRelative === ".." ||
        rootRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(rootRelative)
      ) {
        continue;
      }

      checkedFiles.push(root);

      const dockerfileStrategy = detectExistingDockerfile(root);

      if (dockerfileStrategy) {
        return {
          ...dockerfileStrategy,
          repositoryRoot,
          checkedFiles
        };
      }

      const detectors = [
        detectNode,
        detectPython,
        detectJava,
        detectGo,
        detectStatic
      ];

      for (const detector of detectors) {
        const detected = detector(root);

        if (!detected) continue;

        if (!detected.success) {
          // Continue looking in other roots; a monorepo may have another app.
          continue;
        }

        return {
          ...detected,
          repositoryRoot,
          checkedFiles
        };
      }
    }

    return fail(
      "No supported project was found. Supported automatic strategies include static HTML, Vite-based frontends, Node.js applications, FastAPI, Java, Go, or a repository with a Dockerfile.",
      checkedFiles
    );
  } catch (error) {
    return fail(
      `Project detection failed: ${error.message}`
    );
  }
};
