# Dockerfile optimisé pour Freebox Ultra (ARM64 / Aarch64) & Linux x86_64
FROM node:20-slim

# Machine tools pour compilation SQLite3 native sur ARM64 si nécessaire
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./

# Installation propre des dépendances
RUN npm ci --only=production || npm install --only=production

# Copie du code source
COPY . .

# Création du répertoire data pour la persistance de la DB SQLite
RUN mkdir -p data

# Exposer le port par défaut (3000)
EXPOSE 3000

# Limiter l'empreinte mémoire pour la Freebox OS (1024MB V8 Heap max)
ENV NODE_OPTIONS="--max-old-space-size=1024"
ENV PORT=3000

# Commande de démarrage
CMD ["node", "src/server/app.mjs"]
