FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build:web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4310
CMD ["npm", "run", "dev"]
