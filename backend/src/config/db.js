import mongoose from "mongoose";
import env from "./env.js";
import logger from "./logger.js";

const connectDatabase = async () => {
    if (!env.MONGO_URI) throw new Error("MONGO_URI is required to start the API");
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: env.MONGO_SERVER_SELECTION_TIMEOUT_MS });
    logger.info("MongoDB connected successfully");
    return mongoose.connection;
};

export default connectDatabase;

