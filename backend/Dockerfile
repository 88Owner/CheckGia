FROM node:22-alpine
RUN apk add --no-cache postgresql16-client
WORKDIR /app
COPY shared ./shared
COPY backend/package.json ./backend/package.json
WORKDIR /app/backend
RUN npm install
COPY backend/tsconfig.json ./tsconfig.json
COPY backend/src ./src
ENV HOST=0.0.0.0
ENV PORT=8787
ENV BACKUP_DIR=/app/backend/backups
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
