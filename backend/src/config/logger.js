import winston from "winston";

const logger = winston.createLogger({
  level: "info",

  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),

  transports: [
    // Show logs in terminal
    new winston.transports.Console(),

    // Store only errors
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error"
    }),

    // Store all logs
    new winston.transports.File({
      filename: "logs/combined.log"
    })
  ]
});

export default logger;