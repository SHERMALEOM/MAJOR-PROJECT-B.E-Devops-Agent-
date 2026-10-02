import dotenv from "dotenv"
dotenv.config();

const env={
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET:process.env.JWT_SECRET,
    PORT:process.env.PORT,
    NODE_ENV:process.env.NODE_ENV
}

export default env;