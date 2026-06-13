# Single image used by both the `web` and `worker` services (different commands).
FROM node:24-bookworm-slim

# git is required by the archiver (clone --mirror / fetch / archive)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Build the Next.js app (web service). The worker runs from source via tsx.
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
