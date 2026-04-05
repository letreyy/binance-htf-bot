FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
# Ускоряем установку, подавляем предупреждения и аудит
RUN npm install --include=dev --legacy-peer-deps --no-fund --no-audit

COPY . .
RUN npm run build

FROM node:20-slim

# Глушим любые всплывающие окна во время установки пакетов Linux (иначе сборка виснет!)
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps --no-fund --no-audit

COPY --from=builder /app/dist ./dist

CMD ["npm", "run", "start"]
