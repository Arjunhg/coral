FROM node:22-trixie-slim

# Install Coral via the official install script
RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV CORAL_INSTALL_DIR=/usr/local/bin
RUN curl -fsSL https://withcoral.com/install.sh | sh

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV PORT=3000
ENV CORAL_CONFIG_DIR=/coral-config
RUN mkdir -p /coral-config

# Copy source manifests if present in the build context.
# Before building, run: cp -r ../coral-sources ./coral-sources
# The sidecar will also auto-seed from cwd/coral-sources → /coral-config/coral-sources at startup.
COPY coral-source[s] /app/coral-sources/

EXPOSE 3000
CMD ["node", "server.js"]
