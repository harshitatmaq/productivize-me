# Unlimited job search with self-hosted SearXNG (free)

SearXNG is an open-source metasearch engine. Running your own copy removes the
monthly quotas of Tavily, Serper and the others, so the hourly job search can run
6 web queries per run instead of 2.

## 1. Get a free server

[Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) gives you an
Arm VM (up to 4 cores / 24 GB) at no cost. Create an Ubuntu instance, then in
the VCN security list allow inbound TCP 80 and 443. Any small VPS works too.

## 2. Point a domain at it

Use your own domain, or a free subdomain from [DuckDNS](https://www.duckdns.org)
pointing at the VM's public IP. Caddy fetches the HTTPS certificate automatically.

## 3. Start it

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
git clone https://github.com/harshitatmaq/productivize-me && cd productivize-me/deploy/searxng
cp .env.example .env            # set SEARXNG_DOMAIN and SEARXNG_PATH_SECRET
sed -i "s/CHANGE_ME_TO_A_RANDOM_STRING/$(openssl rand -hex 32)/" settings.yml
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo docker compose up -d
```

Check it: `https://<SEARXNG_DOMAIN>/<SEARXNG_PATH_SECRET>/search?q=backend+engineer+jobs&format=json`
should return JSON.

## 4. Connect Productivize

In Vercel (and `.env.local`):

```
SEARXNG_URL=https://<SEARXNG_DOMAIN>/<SEARXNG_PATH_SECRET>
```

Keep `searxng` in `SEARCH_PROVIDER_ORDER` (it's there by default). Paid-quota
providers are still used first while their monthly budget allows, then the job
search falls back to SearXNG. To use SearXNG only, set `SEARCH_PROVIDER_ORDER=searxng`.
