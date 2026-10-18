# syntax=docker/dockerfile:1
# One image, four entry points: api (default), worker, trackwizz-mock, mfcentral-mock. Migrations run via `prisma migrate deploy`.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev \
 && npm install --no-save --no-audit --no-fund prisma@$(node -p "require('./package.json').devDependencies.prisma")

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY config ./config
# test-only key pair for the TrackWizz mock (never used against the real vendor)
COPY test/fixtures/trackwizz ./test/fixtures/trackwizz
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh
USER node
EXPOSE 3000 8099 4011
ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["api"]
