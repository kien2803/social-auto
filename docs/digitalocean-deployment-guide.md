# DigitalOcean Deployment Guide - Quick Start

**Estimated Time:** 15-20 minutes
**Difficulty:** Easy (copy-paste commands)

---

## 📋 Prerequisites

- ✅ GitHub Student Pack activated with DigitalOcean $100 credit
- ✅ SSH client (already installed on your computer)
- ✅ GitHub repository: https://github.com/kien2803/social-auto

---

## 🚀 Step-by-Step Deployment

### Step 1: Activate GitHub Student Pack for DigitalOcean

1. Go to: https://education.github.com/pack
2. Login with your GitHub account
3. Find **DigitalOcean** offer
4. Click **Get Offer** → Sign up with GitHub
5. Verify email
6. You now have $100 credit!

---

### Step 2: Create DigitalOcean Droplet

1. Go to: https://cloud.digitalocean.com
2. Click **Create** → **Droplets**
3. Configure:
   - **Image:** Ubuntu 22.04 LTS (x64)
   - **Size:** Basic - $6/month (1GB RAM, 1 vCPU, 25GB SSD)
   - **Region:** Singapore (sgp1)
   - **Authentication:** SSH Key (recommended) or Password
4. **Hostname:** `social-auto-backend`
5. Click **Create Droplet**
6. Wait 1-2 minutes for droplet to be ready
7. **Copy the IP address** (e.g., `157.245.123.45`)

---

### Step 3: SSH into Droplet

**If using SSH Key:**
```bash
ssh root@YOUR_DROPLET_IP
```

**If using Password:**
```bash
ssh root@YOUR_DROPLET_IP
# Enter your password when prompted
```

---

### Step 4: Run Deployment Script

Once you're SSH'd into the droplet, run:

```bash
# Download the script
curl -fsSL https://raw.githubusercontent.com/kien2803/social-auto/master/scripts/deploy-digitalocean.sh -o deploy.sh

# Make it executable
chmod +x deploy.sh

# Run the script
bash deploy.sh
```

**Or if you want to copy-paste the script directly:**

Copy the entire content of `scripts/deploy-digitalocean.sh` from your local repository and paste it into the droplet.

---

### Step 5: Verify Deployment

After the script completes, verify:

```bash
# Check services are running
docker-compose ps

# Check health endpoint
curl http://localhost:3000/health

# View logs
docker-compose logs -f
```

Expected health response:
```json
{
  "status": "ok",
  "uptime_sec": 123,
  "timestamp": 1697123456789,
  "storage_dir": "./storage",
  "version": "0.1.0",
  "environment": "production",
  "worker": {
    "status": "ok",
    "last_publish_at": null,
    "by_status": {}
  },
  "accounts": []
}
```

---

### Step 6: Access from Your Computer

Replace `YOUR_DROPLET_IP` with your actual IP:

```bash
# Test from your local machine
curl http://YOUR_DROPLET_IP:3000/health
```

---

## 🔧 Optional: Setup Nginx Reverse Proxy (Recommended)

SSH into droplet and run:

```bash
# Install Nginx
apt install nginx -y

# Configure Nginx
cat > /etc/nginx/sites-available/social-auto << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/social-auto /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default

# Test and restart Nginx
nginx -t
systemctl restart nginx
systemctl enable nginx
```

Now access: `http://YOUR_DROPLET_IP` (without :3000)

---

## 🔐 Optional: Setup SSL with Let's Encrypt

SSH into droplet and run:

```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate (replace with your domain)
certbot --nginx -d your-domain.com

# Auto-renewal is already configured
certbot renew --dry-run
```

---

## 📊 Monitor Your Deployment

### View Logs
```bash
cd /opt/social-auto
docker-compose logs -f api
docker-compose logs -f worker
```

### Restart Services
```bash
cd /opt/social-auto
docker-compose restart
```

### Stop Services
```bash
cd /opt/social-auto
docker-compose down
```

### Update Application
```bash
cd /opt/social-auto
git pull origin master
docker-compose down
docker-compose build
docker-compose up -d
```

### Manual Backup
```bash
cd /opt/social-auto
docker-compose -f docker-compose.backup.yml run --rm backup
```

### List Backups
```bash
cd /opt/social-auto
docker-compose -f docker-compose.backup.yml run --rm backup --list
```

---

## 🔑 Update Frontend Web Origin

Update the frontend to point to your new backend:

1. Edit `core/web/src/config.ts` or similar
2. Change API URL to: `http://YOUR_DROPLET_IP:3000`
3. Or if using Nginx: `http://YOUR_DROPLET_IP`
4. Redeploy frontend to Vercel

---

## 🎯 Next Steps

1. ✅ **Completed:** Backend deployment
2. ⏭️ **Optional:** Setup Nginx reverse proxy
3. ⏭️ **Optional:** Configure SSL
4. ⏭️ **Optional:** Add custom domain
5. ⏭️ **Optional:** Configure Sentry
6. ⏭️ **Next:** Setup CI/CD with GitHub Actions

---

## 🆘 Troubleshooting

### Can't SSH into droplet
- Check droplet status in DigitalOcean console
- Verify you're using correct IP
- If using password, try again (first login might have issues)

### Docker build fails
```bash
# Check Docker logs
docker-compose logs

# Rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Services won't start
```bash
# Check ports
netstat -tulpn

# Check Docker
docker ps -a

# Restart
docker-compose restart
```

### Health check fails
```bash
# Check API logs
docker-compose logs api

# Check if port 3000 is accessible
curl http://localhost:3000/health
```

---

## 💰 Cost Estimate

- **Droplet:** $6/month (covered by $100 credit for 16+ months)
- **Storage:** Included in droplet (25GB)
- **Bandwidth:** 1TB/month included
- **Total:** $6/month after credit expires

---

## 📝 Notes

- Web app (frontend) already deployed on Vercel: https://social-auto-three.vercel.app
- This deployment is for backend API + Worker only
- SQLite database is stored in `/opt/social-auto/storage`
- Backups run daily at 2 AM via cron job
- All data persists in Docker volumes

---

**Deployment Status:** Ready to deploy
**Time Estimate:** 15-20 minutes
**Difficulty:** Easy
