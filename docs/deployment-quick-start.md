# Quick Start - Deploy to DigitalOcean

**You only need to do 3 things:**

---

## 1️⃣ Create Droplet (2 minutes)

1. Go to: https://cloud.digitalocean.com
2. Click **Create** → **Droplets**
3. Select:
   - **Image:** Ubuntu 22.04 LTS
   - **Size:** Basic - $6/month
   - **Region:** Singapore
   - **Authentication:** SSH Key or Password
4. Click **Create Droplet**
5. **Copy the IP address** (e.g., `157.245.123.45`)

---

## 2️⃣ SSH into Droplet (1 minute)

```bash
ssh root@YOUR_DROPLET_IP
```

Enter password if using password authentication.

---

## 3️⃣ Run Deployment Script (10 minutes)

Once SSH'd in, run:

```bash
# Download and run the script
curl -fsSL https://raw.githubusercontent.com/kien2803/social-auto/master/scripts/deploy-digitalocean.sh -o deploy.sh && chmod +x deploy.sh && bash deploy.sh
```

**That's it!** The script will:
- ✅ Install Docker and Docker Compose
- ✅ Clone the repository
- ✅ Setup environment variables
- ✅ Build and deploy API + Worker
- ✅ Setup firewall
- ✅ Configure backup automation

---

## ✅ Verify Deployment

After script completes:

```bash
# Check services
docker-compose ps

# Test health endpoint
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "environment": "production"
}
```

---

## 🎉 Done!

Your backend is now running at: `http://YOUR_DROPLET_IP:3000`

---

## 📋 Optional Next Steps

**After deployment, you can:**

1. **Setup Nginx reverse proxy** (access without :3000)
2. **Configure SSL** (HTTPS)
3. **Add custom domain** (kian.is-a.dev)
4. **Setup CI/CD** (auto-deploy on push)

See full guide: `docs/digitalocean-deployment-guide.md`

---

## 🆘 Need Help?

If something goes wrong:
- Check the full guide: `docs/digitalocean-deployment-guide.md`
- View logs: `docker-compose logs -f`
- Restart services: `docker-compose restart`

---

**Total Time:** 15-20 minutes
**Cost:** FREE for 16+ months (GitHub Student Pack $100 credit)
**Difficulty:** Easy (just copy-paste 1 command)
