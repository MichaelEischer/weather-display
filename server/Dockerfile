FROM node:26-slim

# FIXME remove once https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1141488 is fixed
RUN sed -i 's/http:\/\/deb.debian.org\/debian-security/http:\/\/snapshot.debian.org\/archive\/debian-security\/20260705T000000Z/g' /etc/apt/sources.list.d/debian.sources

# Install Chrome dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-symbola \
    fonts-noto \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome binary location and flags
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_ARGS="--no-sandbox --disable-setuid-sandbox"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npx tsc

# Create a non-root user
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# Run as non-root user
USER pptruser

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]
