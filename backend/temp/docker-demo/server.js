import http from "node:http";

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("AI DevOps Agent Docker deployment is working!");
});

server.listen(3000, "0.0.0.0", () => {
    console.log("App running on port 3000");
});