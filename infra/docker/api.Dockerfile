# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @klaro/api...

FROM deps AS build
WORKDIR /repo
COPY apps/api ./apps/api
RUN pnpm --filter @klaro/api build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/node_modules ./node_modules
COPY apps/api/package.json ./package.json
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
