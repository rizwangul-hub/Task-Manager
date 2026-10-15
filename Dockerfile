FROM node:22-alpine AS backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "src/server.js"]

FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:stable-alpine AS frontend
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80 443
