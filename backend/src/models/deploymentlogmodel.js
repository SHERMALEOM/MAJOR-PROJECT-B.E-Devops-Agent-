import mongoose from "mongoose";

const deploymentLogSchema = new mongoose.Schema(
  {
    deploymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deployment",
      required: true
    },

    agent: {
      type: String,
      required: true
    },

    level: {
      type: String,
      enum: ["info", "success", "warning", "error"],
      default: "info"
    },

    message: {
      type: String,
      required: true
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const DeploymentLog = mongoose.model(
  "DeploymentLog",
  deploymentLogSchema
);

export default DeploymentLog;