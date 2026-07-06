FROM oven/bun:1.3.12 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build

FROM oven/bun:1.3.12 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV LSM_HOST=0.0.0.0
ENV LSM_PORT=18088
ENV LSM_DATABASE_PATH=/app/data/linux-share-manager.sqlite
ENV LSM_STATIC_ROOT=/app/dist/web

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data

EXPOSE 18088
VOLUME ["/app/data"]

CMD ["bun", "run", "dist/server/index.js"]
