FROM node:20-alpine

WORKDIR /app

# 安装 openssl，Prisma 在 alpine 系统里必须有它才能运行
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

# 👇 最关键的一行：在打包前生成 Prisma Client
RUN npx prisma generate

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]