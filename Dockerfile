# --- Build stage: install deps and build the React client ---
FROM node:18-alpine AS build

WORKDIR /app

# Install server deps
COPY package*.json ./
RUN npm install

# Install client deps
COPY client/package*.json client/
RUN npm --prefix client install

# Copy the rest of the source and build the frontend
COPY . .
RUN npm run build

# --- Runtime stage: slim image with only what's needed to run ---
FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=1009

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=build /app/server ./server
COPY --from=build /app/data ./data
COPY --from=build /app/client/dist ./client/dist

EXPOSE 1009

CMD ["node", "server/index.js"]
