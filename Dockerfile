FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Устанавливаем компоненты для генератора картинок
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем конфиги пакетов
COPY package*.json ./

# Устанавливаем ТОЛЬКО продакшен зависимости (без typescript)
RUN npm install --omit=dev --legacy-peer-deps --no-fund --no-audit

# Копируем весь исходный проект, ВКЛЮЧАЯ уже скомпилированную папку /dist
COPY . .

CMD ["npm", "run", "start"]
