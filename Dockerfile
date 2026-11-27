FROM node:24-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production MODEL_DIR=/app/models/sense-voice DATA_DIR=/app/data
COPY --from=deps /app/node_modules ./node_modules
COPY scripts/fetch-model.ts ./scripts/
RUN node scripts/fetch-model.ts
COPY . .
RUN node scripts/check-clips.ts && mkdir -p data && chown node:node data
USER node
CMD ["node", "src/index.ts"]
