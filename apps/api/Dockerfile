FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "src/index.js"]
