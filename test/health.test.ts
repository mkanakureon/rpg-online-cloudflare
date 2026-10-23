import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await exports.default.fetch('http://example.com/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'rpg-online-backend' });
  });
});
