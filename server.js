// server.js (CommonJS) — API wrapper per JaVaFo con fallback sicuro
require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Auth middleware (Bearer <API_TOKEN>) ---
function auth(req, res, next) {
  const hdr = req.headers['authorization'] || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  const expected = process.env.API_TOKEN || '';
  if (!expected) {
    return res.status(500).json({ error: 'API_TOKEN not configured on server' });
  }
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Health check pubblico (senza auth) ---
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// --- Ping JaVaFo (con auth) ---
app.get('/javafo/ping', auth, async (_req, res) => {
  const child = spawn('java', ['-jar', '/app/javafo.jar', '-h'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', d => (out += d.toString()));
  child.stderr.on('data', d => (err += d.toString()));
  child.on('close', code => {
    res.json({ code, stdout: out, stderr: err });
  });
});

// --- Util: crea file temp in /tmp ---
function tmpFile(ext) {
  const name = `javafo_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  return path.join(os.tmpdir(), name);
}

// --- Fallback pairing semplice per Round 1 (Dutch “top vs bottom”) ---
function fallbackFirstRoundPairing(players) {
  const arr = [...players].sort((a, b) => (b.elo || 0) - (a.elo || 0));
  const n = arr.length;
  const needsBye = n % 2 === 1;
  let pool = arr;
  let bye = null;
  if (needsBye) {
    bye = arr[n - 1];
    pool = arr.slice(0, n - 1);
  }
  const half = Math.ceil(pool.length / 2);
  const S1 = pool.slice(0, half);
  const S2 = pool.slice(half);
  const pairs = [];
  for (let i = 0; i < S1.length; i++) {
    const white = i % 2 === 0 ? S1[i] : S2[i];
    const black = i % 2 === 0 ? S2[i] : S1[i];
    pairs.push({ white_email: white.email, black_email: black.email });
  }
  if (bye) pairs.push({ white_email: bye.email, black_email: null });
  return pairs;
}

/**
 * POST /api/pairings/fide-dutch
 * Body atteso (come stai già usando):
 * {
 *   tournament: {...},
 *   roundNumber: 1,
 *   players: [{email, first_name, last_name, elo}, ...],
 *   tournamentPlayers: [{email, score, color_history, opponents_faced, bye_count, withdrawn}, ...],
 *   matches: [...]
 * }
 */
app.post('/api/pairings/fide-dutch', auth, async (req, res) => {
  try {
    const { tournament, roundNumber, players, tournamentPlayers, matches } = req.body || {};
    if (!Array.isArray(players) || !Array.isArray(tournamentPlayers) || !roundNumber) {
      return res.status(400).json({ error: 'Bad Request: missing players/tournamentPlayers/roundNumber' });
    }

    // TODO: COSTRUIRE FILE DI INPUT CORRETTO PER JaVaFo
    // Senza specifiche ufficiali/flag esatti, molti jar escono con code=1.
    // Qui creiamo un file "placeholder" TRF-like solo per mostrare il wiring.
    const trfPath = tmpFile('trf');
    const outPath = tmpFile('out.txt');

    // Scriviamo un contenuto minimale (NON ancora FIDE-TRF completo!):
    // -> scopo: avere un file reale sul disco da passare a JaVaFo.
    const header = `001 ${tournament?.name || 'Tournament'}\n012 ${players.length}\n`;
    const bodyLines = players.map((p, idx) => {
      // Numero progressivo, Cognome Nome, Elo
      const last = (p.last_name || '').replace(/\s+/g, ' ').trim() || `L${idx+1}`;
      const first = (p.first_name || '').replace(/\s+/g_
