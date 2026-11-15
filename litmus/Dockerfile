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
