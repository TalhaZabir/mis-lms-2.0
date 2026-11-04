const { errors } = require('./errors');

class RateLimiter {
  constructor({ windowMs, max, name = 'limiter', keyGenerator, message }) {
    this.windowMs = windowMs;
    this.max = max;
    this.name = name;
    this.keyGenerator = keyGenerator || ((req) => req.ip || 'unknown');
    this.message = message;
    this.buckets = new Map();
    this.timer = setInterval(() => this.cleanup(), Math.max(windowMs, 60_000));
    if (this.timer.unref) this.timer.unref();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.reset <= now) this.buckets.delete(key);
    }
  }

  middleware() {
    return (req, res, next) => {
      const key = this.keyGenerator(req);
      const now = Date.now();
      let bucket = this.buckets.get(key);
      if (!bucket || bucket.reset <= now) {
        bucket = { count: 0, reset: now + this.windowMs };
        this.buckets.set(key, bucket);
      }
      bucket.count += 1;
      const remaining = Math.max(0, this.max - bucket.count);
      res.setHeader('RateLimit-Limit', String(this.max));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));
      if (bucket.count > this.max) return next(errors.tooMany(this.message));
      next();
    };
  }

  reset(key) {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }

  destroy() {
    clearInterval(this.timer);
    this.buckets.clear();
  }
}

module.exports = { RateLimiter };
