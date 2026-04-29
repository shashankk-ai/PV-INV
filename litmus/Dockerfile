# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/
RUN npm ci --ignore-scripts

# ---------- builder ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY shared ./shared
COPY server ./server
# Generate Prisma client + compile TypeScript
RUN cd server && npx prisma generate
RUN npm run build --workspace=shared
RUN npm run build --workspace=server

# ---------- runner ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy only production artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma
# Static uploads directory
RUN mkdir -p /app/uploads
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
