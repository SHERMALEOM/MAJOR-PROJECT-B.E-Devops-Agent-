
import fs from "node:fs";
import path from "node:path";

const GENERATED_MARKER =
    "# AI_DEVOPS_AGENT_GENERATED_DOCKERFILE_V1";

const fail = (error) => ({
    success: false,
    error
});

const exists = (root, name) =>
    fs.existsSync(path.join(root, name));

const isFile = (root, name) => {
    try {
        return fs.statSync(path.join(root, name)).isFile();
    } catch {
        return false;
    }
};

const readText = (file) => {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
};

const readJson = (file) => {
    try {
        return JSON.parse(readText(file));
    } catch {
        return null;
    }
};

const safeEntry = (name) =>
    typeof name === "string" &&
    /^[\w.-]+\.html?$/i.test(name) &&
    !name.includes("..");

const ensureDockerignore = (root) => {
    const file = path.join(root, ".dockerignore");
    const existing = readText(file);

    const required = [
        ".git",
        ".env",
        ".env.*",
        "!.env.example",
        "node_modules",
        ".next",
        "dist",
        "build",
        "coverage",
        ".venv",
        "venv",
        "__pycache__",
        "*.pem",
        "*.key"
    ];

    const lines = new Set(
        existing.split(/\r?\n/).map((line) => line.trim())
    );

    const missing = required.filter((line) => !lines.has(line));

    if (missing.length) {
        fs.appendFileSync(
            file,
            `${existing && !existing.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`
        );
    }
};

/*
 * Shared NGINX configuration for static applications.
 *
 * Important:
 * - Load standard MIME mappings.
 * - Explicitly serve JS/MJS with a JavaScript MIME type.
 * - Return 404 for missing assets instead of returning index.html.
 * - Keep SPA fallback for frontend routes.
 */
const nginxStaticConfig = (entry = "index.html") => `
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index ${entry} index.html;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    location ~* \\.m?js$ {
        default_type application/javascript;
        try_files $uri =404;
    }

    location ~* \\.css$ {
        default_type text/css;
        try_files $uri =404;
    }

    location ~* \\.(?:map|json|wasm|png|jpe?g|gif|svg|ico|woff2?|ttf|eot)$ {
        try_files $uri =404;
    }

    location ~ /\\. {
        deny all;
    }

    location / {
        try_files $uri $uri/ /${entry};
    }
}
`.trim();

/*
 * Plain HTML/CSS/JavaScript application.
 */
const nginxConfigInstallCommand = (entry = "index.html") => {
    // Keep the entire configuration in one valid Dockerfile RUN instruction.
    // A raw multiline shell heredoc is parsed as separate Dockerfile instructions
    // unless Dockerfile heredoc syntax is explicitly enabled.
    const encoded = Buffer.from(nginxStaticConfig(entry), "utf8").toString("base64");
    return `RUN printf '%s' '${encoded}' | base64 -d > /etc/nginx/conf.d/default.conf`;
};

const staticDockerfile = (entry) => `
${GENERATED_MARKER}
FROM nginxinc/nginx-unprivileged:alpine

COPY . /usr/share/nginx/html/
${nginxConfigInstallCommand(entry)}

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
`.trim();

/*
 * Node.js server applications.
 */
const nodeDockerfile = (root, strategy) => {
    const pkg = readJson(path.join(root, "package.json"));

    if (!pkg) {
        return fail("Valid package.json is required.");
    }

    if (!pkg.scripts?.start) {
        return fail(
            "Node.js project requires a scripts.start command."
        );
    }

    if (
        exists(root, "pnpm-lock.yaml") ||
        exists(root, "yarn.lock")
    ) {
        return fail(
            "This template supports npm. Add the matching package-manager template for this repository."
        );
    }

    const locked = exists(root, "package-lock.json");
    const hasBuild = Boolean(pkg.scripts.build);
    const install = locked ? "npm ci" : "npm install";
    const port = Number(strategy.port || 3000);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return fail("Node.js project has an invalid container port.");
    }

    if (strategy.strategy === "node-nextjs") {
        if (!hasBuild) {
            return fail("Next.js project requires a build script.");
        }

        return {
            dockerfile: `
${GENERATED_MARKER}
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN ${install}

COPY . .
RUN npm run build

USER node
EXPOSE ${port}
CMD ["npm", "start"]
`.trim(),
            port
        };
    }

    return {
        dockerfile: `
${GENERATED_MARKER}
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN ${
    hasBuild
        ? install
        : locked
          ? "npm ci --omit=dev"
          : "npm install --omit=dev"
}

COPY . .
${hasBuild ? "RUN npm run build" : ""}

USER node
EXPOSE ${port}
CMD ["npm", "start"]
`.trim(),
        port
    };
};

/*
 * Vite / React / static Astro multi-stage build.
 *
 * The final image contains only the compiled frontend and NGINX.
 */
const viteDockerfile = (root) => {
    if (!isFile(root, "package.json")) {
        return fail("Vite requires package.json.");
    }

    const pkg = readJson(path.join(root, "package.json"));

    if (!pkg?.scripts?.build) {
        return fail("Frontend project has no package.json build script.");
    }

    if (
        exists(root, "pnpm-lock.yaml") ||
        exists(root, "yarn.lock")
    ) {
        return fail(
            "This template supports npm. Add the matching package-manager template for this repository."
        );
    }

    const installCommand = exists(root, "package-lock.json")
        ? "RUN npm ci"
        : "RUN npm install";

    return {
        dockerfile: `
${GENERATED_MARKER}
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
${installCommand}

COPY . .
RUN npm run build

# Fail the image build if the expected output is missing.
RUN test -s /app/dist/index.html

FROM nginxinc/nginx-unprivileged:alpine

COPY --from=build /app/dist/ /usr/share/nginx/html/
${nginxConfigInstallCommand("index.html")}

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
`.trim(),
        port: 8080
    };
};

/*
 * Python FastAPI application.
 */
const pythonDockerfile = (root, strategy) => {
    if (!isFile(root, "requirements.txt")) {
        return fail("Python template requires requirements.txt.");
    }

    if (!strategy.startCommand) {
        return fail(
            "Python entry point/start command needs configuration."
        );
    }

    const match = strategy.startCommand.match(
        /^uvicorn\s+([a-zA-Z0-9_.]+)\s+--host\s+0\.0\.0\.0\s+--port\s+\d+$/
    );

    if (!match) {
        return fail(
            "Automatic Python template supports configured Uvicorn commands only."
        );
    }

    const port = Number(strategy.port || 8000);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return fail("Python project has an invalid container port.");
    }

    return {
        dockerfile: `
${GENERATED_MARKER}
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE ${port}

CMD ["uvicorn", "${match[1]}", "--host", "0.0.0.0", "--port", "${port}"]
`.trim(),
        port
    };
};

/*
 * Java application using Maven or a Gradle wrapper.
 */
const javaDockerfile = (root) => {
    if (exists(root, "pom.xml")) {
        return {
            dockerfile: `
${GENERATED_MARKER}
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /app
COPY . .
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=build /app/target/*.jar /app/application.jar

RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/application.jar"]
`.trim(),
            port: 8080
        };
    }

    if (exists(root, "gradlew")) {
        return {
            dockerfile: `
${GENERATED_MARKER}
FROM gradle:8-jdk21 AS build

WORKDIR /app
COPY . .
RUN chmod +x gradlew && ./gradlew build --no-daemon

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=build /app/build/libs/*.jar /app/application.jar

RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/application.jar"]
`.trim(),
            port: 8080
        };
    }

    return fail("Java project needs pom.xml or a Gradle wrapper.");
};

/*
 * Go application.
 */
const goDockerfile = () => ({
    dockerfile: `
${GENERATED_MARKER}
FROM golang:1.24-alpine AS build

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /app ./...

FROM alpine:3.22

RUN adduser -D -u 10001 appuser

COPY --from=build /app /app

USER appuser
EXPOSE 8080
ENTRYPOINT ["/app"]
`.trim(),
    port: 8080
});

/*
 * Generate or refresh an AI DevOps Agent Dockerfile.
 */
export const generateDockerfile = (repositoryPath, strategy) => {
    try {
        if (
            !repositoryPath ||
            !path.isAbsolute(repositoryPath) ||
            !fs.existsSync(repositoryPath) ||
            !fs.statSync(repositoryPath).isDirectory()
        ) {
            return fail("Repository directory is invalid.");
        }

        if (!strategy?.supported || !strategy.strategy) {
            return fail("A supported deployment strategy is required.");
        }

        const repoRoot = path.resolve(repositoryPath);
        const root = path.resolve(
            strategy.projectRoot || repositoryPath
        );

        const relativeRoot = path.relative(repoRoot, root);

        if (
            !fs.existsSync(root) ||
            !fs.statSync(root).isDirectory() ||
            relativeRoot === ".." ||
            relativeRoot.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativeRoot)
        ) {
            return fail(
                "Detected project root is invalid or outside the repository."
            );
        }

        const dockerfilePath = path.join(root, "Dockerfile");
        const existingDockerfile = isFile(root, "Dockerfile");
        const existingText = existingDockerfile
            ? readText(dockerfilePath)
            : "";

        // Apply secret/build-artifact exclusions even when the repository owns
        // its Dockerfile; otherwise .env and local dependencies may enter image layers.
        ensureDockerignore(root);

        const isAgentGenerated =
            existingText.includes(GENERATED_MARKER);

        // Preserve Dockerfiles created by the repository owner.
        if (existingDockerfile && !isAgentGenerated) {
            return {
                success: true,
                generated: false,
                existing: true,
                projectRoot: root,
                dockerfilePath,
                port: strategy.port ?? null
            };
        }

        let output;

        switch (strategy.strategy) {
            case "static-html": {
                const entry =
                    strategy.entryFileName ||
                    (strategy.entryFile
                        ? path.basename(strategy.entryFile)
                        : "index.html");

                if (!safeEntry(entry) || !isFile(root, entry)) {
                    return fail(
                        "Static HTML entry file was not found in project root."
                    );
                }

                output = {
                    dockerfile: staticDockerfile(entry),
                    port: 8080
                };
                break;
            }

            case "static-vite":
            case "static-astro":
                output = viteDockerfile(root);
                break;

            case "node":
            case "node-nextjs":
            case "node-nuxt":
            case "node-nestjs":
            case "node-sveltekit":
                output = nodeDockerfile(root, strategy);
                break;

            case "python-fastapi":
                output = pythonDockerfile(root, strategy);
                break;

            case "java":
                output = javaDockerfile(root);
                break;

            case "go":
                output = goDockerfile();
                break;

            default:
                return fail(
                    `No automatic Dockerfile template is available for "${strategy.strategy}".`
                );
        }

        if (!output?.dockerfile) {
            return fail(
                output?.error || "Could not generate Dockerfile."
            );
        }

        if (isAgentGenerated) {
            fs.writeFileSync(
                dockerfilePath,
                `${output.dockerfile}\n`,
                "utf8"
            );
        } else {
            fs.writeFileSync(
                dockerfilePath,
                `${output.dockerfile}\n`,
                {
                    encoding: "utf8",
                    flag: "wx"
                }
            );
        }

        return {
            success: true,
            generated: true,
            existing: false,
            refreshed: isAgentGenerated,
            strategy: strategy.strategy,
            projectRoot: root,
            dockerfilePath,
            port: output.port ?? strategy.port ?? null
        };
    } catch (error) {
        return fail(
            `Dockerfile generation failed: ${error.message}`
        );
    }
};
