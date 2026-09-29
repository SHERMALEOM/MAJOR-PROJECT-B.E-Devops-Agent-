import dotenv from "dotenv";
import mongoose from "mongoose";
import logger from "./src/config/logger.js";
dotenv.config();


mongoose.connect(process.env.MONGO_URI)
.then(()=>{
        logger.info(" MongoDB Connected Successfully!");
})
.catch(
    (error)=>{
        logger.error("Not connected "),{
        message: error.message,
        stack: error.stack
        }
    }
)