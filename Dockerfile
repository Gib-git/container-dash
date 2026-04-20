FROM node:20-alpine

# Build deps for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Create runtime dirs. /app/uploads is the volume mount point for
# user-uploaded files. It lives outside /app/public so express.static
# doesn't conflict with the Docker volume that mounts over it.
RUN mkdir -p data uploads

EXPOSE 3000

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/uploads

CMD ["node", "src/server.js"]