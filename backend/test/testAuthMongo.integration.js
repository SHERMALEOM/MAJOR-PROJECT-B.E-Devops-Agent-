import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import connectDatabase from "../src/config/db.js";
import User from "../src/models/usermodel.js";
import logger from "../src/config/logger.js";
import { registerUser, loginUser, getMe, logout } from "../src/controllers/authcontroller.js";
import authMiddleware from "../src/middleware/authmiddleware.js";

const originalInfo = logger.info;
logger.info = () => {};
const email = `codex-auth-${crypto.randomUUID()}@example.test`;
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const invoke = async (handler, req) => { const res = response(); await handler(req, res); return res; };
let connected = false;
try {
    await connectDatabase(); connected = true;
    const registration = await invoke(registerUser, { body: { name: "Temporary Auth Test", email, password: "correct-horse-123" } });
    assert.equal(registration.statusCode, 201);
    const stored = await User.findOne({ email }).select("+password");
    assert.ok(stored);
    assert.notEqual(stored.password, "correct-horse-123");
    assert.equal(await bcrypt.compare("correct-horse-123", stored.password), true);
    assert.equal("password" in registration.body.user, false);

    const duplicate = await invoke(registerUser, { body: { name: "Temporary Auth Test", email, password: "correct-horse-123" } });
    assert.equal(duplicate.statusCode, 409);
    const rejected = await invoke(loginUser, { body: { email, password: "incorrect-password" } });
    assert.equal(rejected.statusCode, 401);
    const login = await invoke(loginUser, { body: { email: email.toUpperCase(), password: "correct-horse-123" } });
    assert.equal(login.statusCode, 200);
    assert.equal("password" in login.body.user, false);

    let reached = false;
    await authMiddleware({ headers: { authorization: `Bearer ${login.body.token}` } }, response(), () => { reached = true; });
    assert.equal(reached, true);
    const current = await invoke(getMe, { user: { userId: String(stored._id) } });
    assert.equal(current.statusCode, 200);
    assert.equal(current.body.user.email, email);
    const loggedOut = await invoke(logout, { user: { userId: String(stored._id) } });
    assert.equal(loggedOut.statusCode, 200);
    const revoked = response();
    await authMiddleware({ headers: { authorization: `Bearer ${login.body.token}` } }, revoked, () => assert.fail("revoked token was accepted"));
    assert.equal(revoked.statusCode, 401);
    console.log("PASS: Mongo-backed registration, duplicate rejection, bcrypt storage, login, /me, logout, and token revocation");
} finally {
    if (connected) {
        await User.deleteOne({ email });
        await mongoose.disconnect();
    }
    logger.info = originalInfo;
}
