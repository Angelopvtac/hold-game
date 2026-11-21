# HOLD: small production image. Browser libraries are committed in public/vendor,
# so the runtime needs only one dependency (ws).
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY data ./data

# The anonymous playtest log (hold-log.jsonl) is written here; Compose mounts a volume on it.
RUN mkdir -p /app/state && chown node:node /app/state
ENV STATE_DIR=/app/state

EXPOSE 8080
USER node

HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.js"]
