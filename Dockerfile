FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY scripts ./scripts
COPY supabase-schema.sql ./
COPY README.md ./

ENV NODE_ENV=production
ENV PORT=4179

EXPOSE 4179

CMD ["node", "server.js"]
