# syntax=docker/dockerfile:1.7
# Isolated Playwright worker image for bank scraping jobs.
# Each job runs in an ephemeral container, then the container is destroyed.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

WORKDIR /worker
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile --filter @klaro/api...

USER pwuser
CMD ["pnpm", "--filter", "@klaro/api", "exec", "tsx", "src/services/scraping/orchestrator.ts"]
