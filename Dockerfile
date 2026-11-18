# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
FROM ${NODE_IMAGE} AS build
WORKDIR /work
RUN npm install --global npm@11.20.0
COPY package.json package-lock.json ./
COPY erp/package.json erp/package-lock.json ./erp/
RUN npm ci && npm ci --prefix erp
COPY . .
RUN npm run typecheck && npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /opt/procurementflow
RUN npm install --global npm@11.20.0 && mkdir .local && chown node:node .local
ENV NODE_ENV=development
COPY deployment/container/start.mjs ./scripts/start.mjs
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node

FROM runtime AS cap
USER root
COPY --from=build /work/gen/srv/ ./
COPY --from=build /work/db/data/ ./db/data/
RUN npm ci --omit=dev && npm cache clean --force
USER node
ENV PORT=4004
EXPOSE 4004
CMD ["node", "scripts/start.mjs"]

FROM runtime AS erp
USER root
COPY --from=build /work/gen/erp/ ./
RUN npm ci --omit=dev && npm cache clean --force
USER node
ENV PORT=4005
EXPOSE 4005
CMD ["node", "scripts/start.mjs"]
