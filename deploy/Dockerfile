ARG IMAGE_MODEL=gpt-image-2
ARG AGENT_MODEL=gpt-5.5

# ---- Build stage ----
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build

ARG IMAGE_MODEL
ARG AGENT_MODEL

WORKDIR /app

ENV VITE_PLATFORM_MODE=true
ENV VITE_PLATFORM_IMAGE_MODEL=$IMAGE_MODEL
ENV VITE_PLATFORM_AGENT_MODEL=$AGENT_MODEL
ENV VITE_API_PROXY_AVAILABLE=true
ENV VITE_API_PROXY_LOCKED=true

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:22-bookworm-slim

ARG IMAGE_MODEL
ARG AGENT_MODEL

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV PLATFORM_DB_PATH=/app/data/image-studio.sqlite
ENV PLATFORM_RESULT_DIR=/app/data/results
ENV PLATFORM_IMAGE_MODEL=$IMAGE_MODEL
ENV PLATFORM_AGENT_MODEL=$AGENT_MODEL

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 8080
VOLUME ["/app/data"]

CMD ["node", "server/index.mjs"]
