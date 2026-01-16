import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
dotenv.config();

import { hianimeRouter } from "./routes/hianime.js";

const app = new Hono<{ Variables: { CACHE_CONFIG: { key: string; duration: number } } }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "Accept"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// Middleware que inicializa CACHE_CONFIG antes dos routers
app.use("*", async (c, next) => {
  // Ajuste conforme sua lógica real (ex: chave baseada na URL ou user)
  c.set("CACHE_CONFIG", {
    key: "global-cache",
    duration: 60_000 // 60s exemplo
  });
  await next();
});

app.get("/public/*", serveStatic({ root: "./public" }));
app.route("/api/v2/hianime", hianimeRouter);

app.get("/health", c =>
  c.json({
    status: "OK",
    message: "API is running",
    timestamp: new Date().toISOString()
  })
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// Inicia somente em ambiente não serverless (ex: local)
if (process.env.VERCEL !== "1") {
  const port = Number(process.env.PORT) || 4000;
  serve({ fetch: app.fetch, port });
  console.log(`🚀 Hono rodando em http://localhost:${port}`);
}

export default app;
