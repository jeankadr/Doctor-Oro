FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV PORT=8080
EXPOSE 8080

# El volumen /app/data debe montarse persistente (docker-compose.yml lo hace)
CMD ["node", "src/server.js"]
