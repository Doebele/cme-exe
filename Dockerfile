# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --no-audit --no-fund --production
COPY backend/ ./
COPY data/ /data/
COPY --from=frontend-builder /app/frontend/dist ./dist

ENV PORT=8093
ENV STATIC_DIR=/app/dist
ENV DATA_DIR=/data
ENV NODE_ENV=production
EXPOSE 8093

CMD ["node", "server.js"]
