import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 2000),
      commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS ?? 1000),
      keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'master-backend:',
      maxRetriesPerRequest: 2,
    });

    this.client.on('error', (error: Error & { code?: string }) => {
      // AggregateError (IPv4+IPv6 both refused) has an empty message — show the code instead
      this.logger.warn(
        `Redis unavailable: ${error.message || error.code || error.name}`,
      );
    });
  }

  async set(key: string, value: string, ttlseconds?: number) {
    if (ttlseconds) {
      return await this.client.set(key, value, 'EX', ttlseconds);
    }
    return await this.client.set(key, value);
  }

  async get(key: string) {
    return await this.client.get(key);
  }

  async del(key: string) {
    return await this.client.del(key);
  }

  async incr(key: string) {
    return await this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number) {
    return await this.client.expire(key, ttlSeconds);
  }

  async ttl(key: string) {
    return await this.client.ttl(key);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
  async exists(key: string) {
    return await this.client.exists(key);
  }
}
