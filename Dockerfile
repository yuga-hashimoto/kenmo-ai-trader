# Shared image for the API and Web services (dev-style, runs from source via tsx/next).
FROM node:20-slim AS base
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate
WORKDIR /app

# Install dependencies (leverages workspace layout).
COPY pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/hermes/package.json packages/hermes/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --config.confirmModulesPurge=false || pnpm install

# Copy the rest of the monorepo and generate the Prisma client.
COPY . .
RUN pnpm --filter @kenmo/db exec prisma generate

EXPOSE 4000 3000
CMD ["pnpm", "--filter", "@kenmo/api", "start"]
