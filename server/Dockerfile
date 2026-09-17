FROM node:26-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npx tsc

USER node

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]
