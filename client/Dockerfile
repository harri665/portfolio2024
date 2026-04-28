FROM node:18-alpine AS build

WORKDIR /client

COPY package.json package-lock.json ./
RUN npm install --production

COPY . .

RUN npm run build

FROM nginx:alpine

COPY --from=build /client/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
