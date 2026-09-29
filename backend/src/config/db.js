const mongoose= require('mongoose');
import dotenv from  "dotenv"
import env from "./env"
dotenv.config();

async function connection() {
   await  mongoose.connect(env.mongouri)
}

module.exports=connection;

