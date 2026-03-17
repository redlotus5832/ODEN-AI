import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// --- API Endpoints ---

app.post("/api/report-error", async (req, res) => {
  const { error, context, userEmail } = req.body;
  
  console.log(`[REPORT] Error reported by ${userEmail || 'anonymous'}:`);
  console.log(`[REPORT] Error: ${error}`);
  console.log(`[REPORT] Context: ${JSON.stringify(context)}`);
  
  // In a real production app, we would use a service like SendGrid or AWS SES here.
  // For now, we log it prominently.
  
  res.json({ status: "success", message: "Error report received and logged." });
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
