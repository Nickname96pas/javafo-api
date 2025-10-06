# Usa Node per esporre la tua API wrapper
FROM node:20-slim

# --- Dipendenze di sistema: Java + curl ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-17-jre-headless curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Dipendenze Node (se hai package-lock.json verrà usato; altrimenti fallback) ---
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# --- Codice server Node che invoca JaVaFo ---
COPY server.js ./

# --- Scarica automaticamente JaVaFo dal sito ufficiale ---
# Puoi cambiare la URL a build-time con: --build-arg JAVAFO_URL=...
ARG JAVAFO_URL="http://www.rrweb.org/javafo/current/javafo.jar"
RUN echo "Scarico JaVaFo da: $JAVAFO_URL" \
 && curl -fL "$JAVAFO_URL" -o /app/javafo.jar \
 && test -s /app/javafo.jar

# --- Variabili d'ambiente utili al tuo server ---
ENV NODE_ENV=production
ENV JAVAFO_JAR=/app/javafo.jar
# (Se il tuo server si aspetta altro, aggiungilo qui, es. TRF_DIR, ecc.)

# --- Porta esposta dal server Node ---
EXPOSE 8080

# --- Avvio dell'app wrapper ---
CMD ["node", "server.js"]
