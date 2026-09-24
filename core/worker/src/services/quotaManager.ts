export class QuotaManager {
  private readonly YOUTUBE_QUOTA_LIMIT = 10000; // units per day
  private readonly UPLOAD_COST = 1600; // units per video upload
  
  constructor(
    private quotasRepo: any // QuotasRepo
  ) {}
  
  async checkQuota(platform: string): Promise<boolean> {
    if (platform !== 'youtube') {
      // For now, only YouTube has quota limits
      return true;
    }
    
    const now = Date.now();
    const quota = this.quotasRepo.get(platform, now);
    
    if (quota.remaining < this.UPLOAD_COST) {
      return false;
    }
    
    return true;
  }
  
  async recordUpload(platform: string): Promise<void> {
    if (platform !== 'youtube') {
      return;
    }
    
    const now = Date.now();
    this.quotasRepo.incrementUsage(platform, this.UPLOAD_COST, now);
  }
  
  async getQuotaStatus(platform: string): Promise<{
    platform: string;
    used: number;
    limit: number;
    remaining: number;
    reset_at: number;
    warning: boolean;
  }> {
    const now = Date.now();
    const quota = this.quotasRepo.get(platform, now);
    
    // Calculate reset time (next midnight UTC)
    const resetAt = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate() + 1
    );
    
    return {
      platform,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      reset_at: resetAt,
      warning: quota.used / quota.limit > 0.8
    };
  }
  
  getUploadCost(): number {
    return this.UPLOAD_COST;
  }
  
  getQuotaLimit(): number {
    return this.YOUTUBE_QUOTA_LIMIT;
  }
}