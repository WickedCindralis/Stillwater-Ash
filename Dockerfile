FROM node:24-slim

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=5000
ENV BASE_PATH=/

RUN PORT=5000 BASE_PATH=/ pnpm --filter @workspace/agent-dashboard run build \
  && pnpm --filter @workspace/api-server run build

EXPOSE 5000

CMD ["sh", "./northflank/start.sh"]
