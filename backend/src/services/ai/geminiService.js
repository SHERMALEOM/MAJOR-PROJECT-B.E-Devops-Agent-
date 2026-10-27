
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

let model;

const getModel = () => {
    if (model) return model;

    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL;

    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is missing from backend .env");
    }

    if (!modelName) {
        throw new Error("GEMINI_MODEL is missing from backend .env");
    }

    model = new ChatGoogleGenerativeAI({
        apiKey,
        model: modelName,
        temperature: 0.2,
        maxRetries: 1,
        timeout: 30000
    });

    return model;
};

export const askGemini = async prompt => {
    const response = await getModel().invoke(prompt);

    if (typeof response.content === "string") {
        return response.content;
    }

    return response.content
        .filter(item => item.type === "text")
        .map(item => item.text)
        .join("\n");
};

export const explainDeploymentError = async ({
    stage,
    message,
    repositoryName,
    buildStrategy
}) => {
    const prompt = `
You are a DevOps troubleshooting assistant.

Explain the deployment failure and recommend diagnostic steps.
Do not claim that you executed commands or changed any files.
Do not invent logs or facts.
Do not recommend exposing secrets or blindly executing commands.

Repository: ${repositoryName || "Unknown"}
Build strategy: ${JSON.stringify(buildStrategy || {})}
Failed stage: ${stage || "Unknown"}
Error: ${message || "No error message supplied"}

Return:
1. Likely cause based only on the supplied facts.
2. Up to three diagnostic steps.
3. A safe suggested fix, if enough information exists.
`;

    return askGemini(prompt);
};
