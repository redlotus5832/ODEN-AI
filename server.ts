import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// --- API Endpoints ---

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/report-error", async (req, res) => {
  try {
    const { error, context, userEmail } = req.body;
    
    console.log(`[REPORT] Error reported by ${userEmail || 'anonymous'}:`);
    console.log(`[REPORT] Error: ${error}`);
    console.log(`[REPORT] Context: ${JSON.stringify(context)}`);
    
    res.json({ status: "success", message: "Error report received and logged." });
  } catch (e) {
    console.error("Error in /api/report-error:", e);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

// --- Vite Middleware ---

async function startServer() {
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
    console.log(`ODEN Server running on http://localhost:${PORT}`);
  });
}

startServer();
