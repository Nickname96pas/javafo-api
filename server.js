import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import morgan from "morgan";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// --- Sicurezza semplice: token Bearer opzionale ---
const API_TOKEN = process.env.API_TOKEN || null;
app.use((req, res, next) => {
  if (!API_TOKEN) return next(); // nessun token richiesto
  const hdr = req.headers.authorization || "";
  if (!hdr.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }
  const token = hdr.slice("Bearer ".length).trim();
  if (token !== API_TOKEN) {
    return res.status(403).json({ error: "Invalid token" });
  }
  next();
});

app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(morgan("tiny"));

// --- Utils per file temporanei ---
function writeTemp(content, suffix) {
  const p = path.join(os.tmpdir(), `javafo-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  fs.writeFileSync(p, content, "utf8");
  return p;
  }

// --- Mapper minimale: i tuoi dati -> TRF di prova (per round 1 funziona; per round >1 andrà completato) ---
function toTRF(payload) {
  const { players = [], tournament = {}, roundNumber = 1 } = payload || {};
  const lines = [];
  lines.push(`012 ${tournament?.name || "Tournament"}; R${roundNumber}`);
  players.forEach((p, idx) => {
    const cognome = (p.last_name || "").toUpperCase();
    const nome = p.first_name || "";
    const rating = p.elo || 0;
    lines.push(`001 ${String(idx + 1).padStart(4,"0")} ${cognome}, ${nome} ${rating}`);
  });
  // TODO: per round > 1 aggiungi i risultati storici in TRF
  return lines.join("\n") + "\n";
}

// --- Parser output: per partire, restituiamo l'output grezzo (TRF), poi lo miglioreremo ---
function normalizeOutput(text) {
  return { raw: text };
}

// --- Health check: controlla Java & JaVaFo ---
app.get("/api/pairings/health", (req, res) => {
  try {
    const java = process.env.JAVA_BIN || "java";
    const jar  = process.env.JAVAFO_JAR || "/app/javafo.jar";

    const child = spawn(java, ["-version"]);
    let ver = "";
    child.stderr.on("data", d => (ver += d.toString("utf8")));
    child.on("close", code => {
      const help = spawn(java, ["-jar", jar, "--help"]);
      let helpOut = "", helpErr = "";
      help.stdout?.on("data", d => (helpOut += d.toString("utf8")));
      help.stderr?.on("data", d => (helpErr += d.toString("utf8")));
      help.on("close", hcode => {
        if (hcode !== 0) {
          return res.status(500).json({
            ok: false,
            java: (ver.split("\n")[0] || "").trim(),
            jar,
            error: "JaVaFo not runnable",
            stderr: helpErr.trim()
          });
        }
        return res.json({
          ok: true,
          java: (ver.split("\n")[0] || "").trim(),
          jar,
          help: (helpOut || helpErr || "").slice(0, 300)
        });
      });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "health error" });
  }
});

// --- Endpoint che invoca JaVaFo ---
app.post("/api/pairings/fide-dutch", (req, res) => {
  const payload = req.body || {};
  const roundNumber = Number(payload.roundNumber || 1);

  // 1) scrivi l'input TRF
  const trf = toTRF(payload);
  const inFile = writeTemp(trf, ".trf");
  const outFile = writeTemp("", ".out");

  const java = process.env.JAVA_BIN || "java";
  const jar  = process.env.JAVAFO_JAR || "/app/javafo.jar";

  // Nota: le opzioni possono variare a seconda della versione di JaVaFo.
  // Se fallisce, vedremo l'errore in stderr.
  const args = [
    "-jar", jar,
    "--in", inFile,
    "--out", outFile,
    "--system", "fide-dutch",
    "--round", String(roundNumber)
  ];

  const child = spawn(java, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";

  const killTimer = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} }, 15000);

  child.stdout.on("data", d => (stdout += d.toString("utf8")));
  child.stderr.on("data", d => (stderr += d.toString("utf8")));

  child.on("close", code => {
    clearTimeout(killTimer);
    try {
      const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : stdout;
      if (code !== 0) {
        return res.status(500).json({ error: "JaVaFo failed", code, stderr: stderr.trim(), out: (text || "").slice(0, 4000) });
      }
      const json = normalizeOutput(text);
      return res.json({ ...json, engine: { name: "javafo", code, stderr: stderr.trim() || undefined } });
    } catch (e) {
      return res.status(500).json({ error: e?.message || "read error", stderr: stderr.trim() || undefined });
    } finally {
      try { fs.unlinkSync(inFile); } catch {}
      try { fs.unlinkSync(outFile); } catch {}
    }
  });
});

app.get("/", (_req, res) => res.send("javafo-api is running ✅"));
app.listen(PORT, () => console.log(`javafo-api listening on :${PORT}`));
