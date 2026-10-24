
import assert from "node:assert/strict";
import { analyzeRepository } from "../src/services/github/repositoryAnalyzer.js";

const repoPath = (name) =>
    `./temp/repositories/${name}`;

const tests = [
    {
        name: "python-app",
        language: "Python",
        framework: "FastAPI"
    },
    {
        name: "java-app",
        language: "Java",
        framework: null
    },
    {
        name: "react-app",
        language: "JavaScript",
        framework: "React"
    },
    {
        name: "go-app",
        language: "Go",
        framework: null
    }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
    try {
        const result = await analyzeRepository(
            repoPath(test.name)
        );

        console.log(
    `\n${test.name} output:`,
    JSON.stringify(result, null, 2)
);

        assert.equal(result.success, true);
        assert.equal(result.detected, true);
        assert.ok(
            result.languages.includes(test.language),
            `Expected language ${test.language}, got ${result.languages}`
        );

        if (test.framework) {
            assert.ok(
                result.frameworks.includes(test.framework),
                `Expected framework ${test.framework}, got ${result.frameworks}`
            );
        }

        console.log(`PASS: ${test.name}`);
        passed++;
    } catch (error) {
        console.error(`FAIL: ${test.name} - ${error.message}`);
        failed++;
    }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exitCode = 1;
}
