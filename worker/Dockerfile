# Scout worker image (Oracle Cloud Always Free VM or any Docker host).
# Build from the repository root:  docker compose -f worker/docker-compose.yml up -d --build
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python side (JobSpy) in its own virtualenv
COPY worker/requirements.txt worker/requirements.txt
RUN python3 -m venv /opt/jobspy && /opt/jobspy/bin/pip install --no-cache-dir -r worker/requirements.txt
ENV JOBSPY_PYTHON=/opt/jobspy/bin/python

# Node side (shares the app's code in src/lib)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .

ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--conditions=react-server", "--import", "tsx", "worker/index.ts"]
