FROM node:24.22.1-bookworm-slim

ARG CHROME_VERSION=156.0.8078.47
ENV CHROME_PATH=/opt/chrome/chrome-linux64/chrome \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl unzip tini xvfb xauth ffmpeg \
        fonts-liberation fonts-noto-color-emoji \
        libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
        libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
        libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
        libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
        libxkbcommon0 libxrandr2 \
    && curl --fail --show-error --silent --location --retry 3 \
        "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" \
        -o /tmp/chrome.zip \
    && unzip -q /tmp/chrome.zip -d /opt/chrome \
    && rm -rf /tmp/chrome.zip /var/lib/apt/lists/* \
    && "$CHROME_PATH" --version

WORKDIR /opt/test-deps
COPY tests/package.json tests/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && rm -rf /tmp/npm-cache

ENV XDG_CONFIG_HOME=/tmp/chrome-config \
    XDG_CACHE_HOME=/tmp/chrome-cache \
    PATH=/opt/test-deps/node_modules/.bin:${PATH}

WORKDIR /workspace/tests
COPY client /workspace/client
COPY scripts /workspace/scripts
COPY VERSION /workspace/VERSION
COPY tests ./
RUN ln -s /opt/test-deps/node_modules node_modules \
    && mkdir -p reports && chown node:node reports

USER node
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/bin/xvfb-run", "-a", "-s", "-screen 0 1920x1080x24 -nolisten tcp"]
CMD ["npm", "test"]
