FROM node:22.1 AS BUILD_IMAGE

RUN curl -sf https://gobinaries.com/tj/node-prune | bash -s -- -b /usr/local/bin

RUN mkdir -p /srv/api
WORKDIR /srv/api
ENV NODE_ENV production

ADD ./dist/apps/unified-chatbot-api /srv/api
ADD ./package.json /srv/api

RUN npm install --production
RUN npm prune --production
RUN /usr/local/bin/node-prune

FROM node:22.1-alpine

ENV NODE_ENV production
COPY --from=BUILD_IMAGE /srv/api /srv/api

WORKDIR /srv/api
CMD node /srv/api/main.js
