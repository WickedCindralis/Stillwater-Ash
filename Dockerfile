FROM mcr.microsoft.com/dotnet/sdk:8.0 AS companion-builder

WORKDIR /src
COPY desktop-companion/Stillwater.Companion.csproj desktop-companion/Program.cs ./desktop-companion/
RUN dotnet publish ./desktop-companion/Stillwater.Companion.csproj \
  --configuration Release \
  --runtime win-x64 \
  --self-contained true \
  --property:PublishSingleFile=true \
  --property:IncludeNativeLibrariesForSelfExtract=true \
  --property:DebugType=None \
  --output /out

FROM node:24-slim

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

COPY . .
COPY --from=companion-builder /out/Stillwater.Companion.exe ./desktop-companion/release/Stillwater.Companion.exe

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=5000
ENV BASE_PATH=/

RUN PORT=5000 BASE_PATH=/ pnpm --filter @workspace/agent-dashboard run build \
  && pnpm --filter @workspace/api-server run build

EXPOSE 5000

CMD ["sh", "./northflank/start.sh"]
