FROM node:18-alpine

RUN apk add --no-cache \
    curl \
    bind-tools \
    iputils \
    net-tools

ENV NODE_OPTIONS=--experimental-vm-modules

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]