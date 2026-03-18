import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  try {
    const app = express();
    const PORT = 3000;

    console.log(`Starting server in ${process.env.NODE_ENV} mode`);

    app.set("trust proxy", 1);
    
    app.use(cors({
      origin: true,
      credentials: true,
    }));

    app.use(express.json());

    // API Router
    const apiRouter = express.Router();

    apiRouter.get("/config", (req, res) => {
      res.json({ 
        authEnabled: false,
        persistenceType: "local",
        isProduction: process.env.NODE_ENV === "production",
        appUrl: process.env.APP_URL,
      });
    });

    apiRouter.get("/ping", (req, res) => {
      res.json({ status: "ok", time: new Date().toISOString() });
    });

    app.use("/api", apiRouter);

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (startupErr: any) {
    console.error("FATAL STARTUP ERROR:", startupErr);
    process.exit(1);
  }
}

startServer();
