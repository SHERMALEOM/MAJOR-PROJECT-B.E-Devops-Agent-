import dotenv from "dotenv"
dotenv.config();

const env={
    mongouri: process.env.MONGO_URI,
}

export default env;