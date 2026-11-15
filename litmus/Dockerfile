# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY shared/package.json ./shared/
RUN npm ci --ignore-scripts

# ---------- builder ----------
FROM node:22-alpine AS builder
WORKDIR /app
# Alpine's base image has no `openssl` package installed, so Prisma's engine
# can't detect the OpenSSL version at generate-time and silently assumes the
# wrong one (1.1.x instead of the 3.x actually present).
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
# Generate Prisma client + compile TypeScript
RUN cd server && npx prisma generate
RUN npm run build --workspace=shared
RUN npm run build --workspace=server
RUN npm run build --workspace=client

# ---------- runner ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Same reason as the builder stage — needed so Prisma's runtime engine
# selection correctly detects OpenSSL 3.x instead of defaulting to 1.1.x.
RUN apk add --no-cache openssl
# Copy only production artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
# tsc's rootDir inference (due to the @litmus/shared path-mapped import) nests
# compiled output as dist/server/src/*.js — copy just that inner folder so the
# runtime layout (dist/index.js, __dirname two levels below /app) matches what
# index.ts's relative paths already assume, same as running tsx on src/ directly.
COPY --from=builder /app/server/dist/server/src ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/client/dist ./client/dist
# Static uploads directory
RUN mkdir -p /app/uploads
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
