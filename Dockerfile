# --- Build stage: install deps and build the React client ---
FROM node:18-alpine AS build

WORKDIR /app

# Install server deps
COPY package*.json ./
RUN npm install

# Install client deps
COPY client/package*.json client/
RUN npm --prefix client install

# Hotjar Site ID, baked into the client bundle at build time. Must be declared as an
# ARG here and promoted to ENV before `npm run build`, because Vite reads VITE_* from the
# build process's environment -- a value passed with no matching ARG is silently dropped
# and the bundle ships with Hotjar off. Not a secret: it ships in client-side JavaScript.
# Blank (the default) = Hotjar fully off, no script requested.
ARG VITE_HOTJAR_SITE_ID=""
ENV VITE_HOTJAR_SITE_ID=${VITE_HOTJAR_SITE_ID}

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
