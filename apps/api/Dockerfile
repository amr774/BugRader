FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/nest-demo/package.json apps/nest-demo/package.json
COPY packages/browser-sdk/package.json packages/browser-sdk/package.json
COPY packages/nestjs-sdk/package.json packages/nestjs-sdk/package.json
RUN npm ci --no-audit --no-fund
COPY apps/api apps/api
COPY tsconfig.base.json ./
RUN npm run db:generate && npm run build -w @bugradar/api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app/apps/api
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
