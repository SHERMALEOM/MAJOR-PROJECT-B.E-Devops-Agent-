import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import connectDatabase from "../src/config/db.js";
import User from "../src/models/usermodel.js";

const api = process.env.TEST_API_URL || "http://127.0.0.1:5000";
const email = `codex-http-auth-${crypto.randomUUID()}@example.test`;
const call = async (path, options = {}) => {
    const response = await fetch(`${api}${path}`, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
    return { status: response.status, body: await response.json() };
};
let connected = false;
try {
    await connectDatabase(); connected = true;
    const registration = await call("/auth/register", { method: "POST", body: JSON.stringify({ name: "Temporary HTTP Auth Test", email, password: "correct-horse-123" }) });
    assert.equal(registration.status, 201);
    const saved = await User.findOne({ email }).select("+password");
    assert.ok(saved);
    assert.notEqual(saved.password, "correct-horse-123");

    const duplicate = await call("/auth/register", { method: "POST", body: JSON.stringify({ name: "Temporary HTTP Auth Test", email: email.toUpperCase(), password: "correct-horse-123" }) });
    assert.equal(duplicate.status, 409);
    const rejected = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "wrong-password" }) });
    assert.equal(rejected.status, 401);
    const login = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: email.toUpperCase(), password: "correct-horse-123" }) });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);
    assert.equal("password" in login.body.user, false);

    const authorization = { Authorization: `Bearer ${login.body.token}` };
    const current = await call("/auth/getme", { headers: authorization });
    assert.equal(current.status, 200);
    assert.equal(current.body.user.email, email);
    const protectedBefore = await call("/project", { headers: authorization });
    assert.equal(protectedBefore.status, 200);
    const logout = await call("/auth/logout", { method: "POST", headers: authorization });
    assert.equal(logout.status, 200);
    const currentAfterLogout = await call("/auth/getme", { headers: authorization });
    assert.equal(currentAfterLogout.status, 401);
    const protectedAfterLogout = await call("/project", { headers: authorization });
    assert.equal(protectedAfterLogout.status, 401);
    console.log("PASS: HTTP registration in MongoDB, hashed password, duplicate/login errors, /me, protected API, and logout revocation");
} finally {
    if (connected) {
        await User.deleteOne({ email });
        await mongoose.disconnect();
    }
}
