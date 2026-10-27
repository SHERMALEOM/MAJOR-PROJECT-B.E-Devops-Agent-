import dotenv from "dotenv"
dotenv.config();

const CLOUDFLARE_TUNNEL_MODE = process.env.CLOUDFLARE_TUNNEL_MODE || "quick";
if (CLOUDFLARE_TUNNEL_MODE !== "quick") {
    throw new Error("CLOUDFLARE_TUNNEL_MODE currently supports only 'quick'");
}
const CLOUDFLARE_TUNNEL_START_TIMEOUT_MS = Number(process.env.CLOUDFLARE_TUNNEL_START_TIMEOUT_MS || 30000);
if (!Number.isInteger(CLOUDFLARE_TUNNEL_START_TIMEOUT_MS) || CLOUDFLARE_TUNNEL_START_TIMEOUT_MS < 1000 || CLOUDFLARE_TUNNEL_START_TIMEOUT_MS > 120000) {
    throw new Error("CLOUDFLARE_TUNNEL_START_TIMEOUT_MS must be an integer from 1000 to 120000");
}

const env={
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET:process.env.JWT_SECRET,
    PORT:process.env.PORT || 5000,
    NODE_ENV:process.env.NODE_ENV,
    MONGO_SERVER_SELECTION_TIMEOUT_MS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000),
    CLOUDFLARE_TUNNEL_MODE,
    CLOUDFLARE_TUNNEL_START_TIMEOUT_MS,
    CLOUDFLARED_PATH: process.env.CLOUDFLARED_PATH || "cloudflared"
}

export default env;
