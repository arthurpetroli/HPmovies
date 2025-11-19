import express, { type Express, type Request, type Response, type NextFunction } from "express";
import path from "path";
import { errorHandler } from "./config/errorHandler.js";
import { limiter } from "./config/ratelimit.js";
import { hianimeRouter } from "./routes/hianime.js";
import cors from "cors";

// dotenv config
import dotenv from "dotenv";
dotenv.config();

const app: Express = express();
const PORT: number = Number(process.env.PORT) || 4000;

// CORS - DEVE VIR ANTES DE TUDO
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(limiter);

// routes
app.use("/api/v2/hianime", hianimeRouter);

// health check
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "OK",
    message: "API is running",
    timestamp: new Date().toISOString(),
  });
});

// Serve static files
app.use(express.static(path.join(__dirname, "../public")));

// Error handler deve vir por último
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📖 API Docs: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`🎬 Home: http://localhost:${PORT}/api/v2/hianime/home\n`);
});

export default app;
