# build the frontend
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# run the server (api + static files)
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
# cloud run sets PORT automatically
CMD ["node", "server.mjs"]
