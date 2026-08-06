FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY .env ./

COPY . .

EXPOSE 7001

CMD ["node", "server.js"]
