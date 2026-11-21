FROM node:22-alpine
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data TRUST_PROXY=1
USER node
EXPOSE 3000
CMD ["node", "server.js"]
