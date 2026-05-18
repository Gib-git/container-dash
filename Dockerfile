FROM node:20-alpine

# Build deps for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install deps (including devDependencies for nodemon)
COPY package*.json ./
RUN npm install

EXPOSE 3006

CMD ["npm", "run", "dev"]
