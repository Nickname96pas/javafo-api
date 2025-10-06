FROM node:20-slim

# Installa Java (OpenJDK)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dipendenze Node
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Codice server
COPY server.js ./

# Copia il motore JaVaFo (il file .jar verrà aggiunto nel passo successivo)
COPY javafo.jar /app/javafo.jar

ENV NODE_ENV=production
ENV JAVAFO_JAR=/app/javafo.jar

EXPOSE 8080
CMD ["node", "server.js"]
