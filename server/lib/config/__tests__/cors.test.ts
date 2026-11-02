import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAllowedConfiguredOrigins,
  getCanonicalFrontendUrl,
  isPrivateOrLocalhost,
  isOriginAllowed,
  corsOptions,
} from '../cors';

describe('CORS Origin Validation', () => {
  const originalClientUrl = process.env.CLIENT_URL;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.CLIENT_URL;
    delete process.env.FRONTEND_URL;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
    if (originalFrontendUrl !== undefined) {
      process.env.FRONTEND_URL = originalFrontendUrl;
    } else {
      delete process.env.FRONTEND_URL;
    }
  });

  describe('Configured Origins Parsing', () => {
    it('returns empty list when no env vars are defined in non-production', () => {
      expect(getAllowedConfiguredOrigins()).toEqual([]);
    });

    it('extracts single CLIENT_URL and strips trailing slash', () => {
      process.env.CLIENT_URL = 'https://syncspace.onrender.com/';
      expect(getAllowedConfiguredOrigins()).toEqual(['https://syncspace.onrender.com']);
    });

    it('extracts single FRONTEND_URL and strips multiple trailing slashes', () => {
      process.env.FRONTEND_URL = 'https://app.syncspace.dev///';
      expect(getAllowedConfiguredOrigins()).toEqual(['https://app.syncspace.dev']);
    });

    it('supports comma-separated list of origins with whitespace and trailing slashes', () => {
      process.env.CLIENT_URL = 'https://syncspace.onrender.com/, https://custom-domain.org';
      process.env.FRONTEND_URL = 'https://staging.syncspace.dev/';

      const origins = getAllowedConfiguredOrigins();
      expect(origins).toContain('https://syncspace.onrender.com');
      expect(origins).toContain('https://custom-domain.org');
      expect(origins).toContain('https://staging.syncspace.dev');
      expect(origins).toHaveLength(3);
    });

    it('automatically ensures both www.sync-space.me and apex sync-space.me are trusted', () => {
      process.env.FRONTEND_URL = 'https://sync-space.me';
      const origins = getAllowedConfiguredOrigins();
      expect(origins).toContain('https://www.sync-space.me');
      expect(origins).toContain('https://sync-space.me');
    });

    it('trusts sync-space.me domains in production by default', () => {
      process.env.NODE_ENV = 'production';
      const origins = getAllowedConfiguredOrigins();
      expect(origins).toContain('https://www.sync-space.me');
      expect(origins).toContain('https://sync-space.me');
    });
  });

  describe('Canonical Frontend URL Resolution (getCanonicalFrontendUrl)', () => {
    it('canonicalizes apex sync-space.me to https://www.sync-space.me', () => {
      process.env.FRONTEND_URL = 'https://sync-space.me';
      expect(getCanonicalFrontendUrl()).toBe('https://www.sync-space.me');

      process.env.FRONTEND_URL = 'http://sync-space.me/';
      expect(getCanonicalFrontendUrl()).toBe('https://www.sync-space.me');
    });

    it('preserves already canonical https://www.sync-space.me', () => {
      process.env.FRONTEND_URL = 'https://www.sync-space.me';
      expect(getCanonicalFrontendUrl()).toBe('https://www.sync-space.me');
    });

    it('canonicalizes from comma-separated origins list', () => {
      process.env.FRONTEND_URL = 'https://sync-space.me, https://app.sync-space.me';
      expect(getCanonicalFrontendUrl()).toBe('https://www.sync-space.me');
    });

    it('preserves custom developer domain in test/dev', () => {
      process.env.FRONTEND_URL = 'https://syncspace.example.test';
      expect(getCanonicalFrontendUrl()).toBe('https://syncspace.example.test');
    });

    it('defaults to https://www.sync-space.me in production when unset', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FRONTEND_URL;
      delete process.env.CLIENT_URL;

      expect(getCanonicalFrontendUrl()).toBe('https://www.sync-space.me');
    });

    it('defaults to http://localhost:5173 in development when unset', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.FRONTEND_URL;
      delete process.env.CLIENT_URL;

      expect(getCanonicalFrontendUrl()).toBe('http://localhost:5173');
    });
  });

  describe('Localhost and Private LAN Validation (isPrivateOrLocalhost)', () => {
    it('allows localhost and loopback IP on standard and custom ports', () => {
      expect(isPrivateOrLocalhost('http://localhost:5173')).toBe(true);
      expect(isPrivateOrLocalhost('http://localhost:3000')).toBe(true);
      expect(isPrivateOrLocalhost('http://localhost')).toBe(true);
      expect(isPrivateOrLocalhost('https://localhost:5173')).toBe(true);
      expect(isPrivateOrLocalhost('http://127.0.0.1:5173')).toBe(true);
      expect(isPrivateOrLocalhost('http://127.0.0.1:8080')).toBe(true);
      expect(isPrivateOrLocalhost('http://127.0.0.1')).toBe(true);
    });

    it('allows 10.0.0.0/8 private LAN range', () => {
      expect(isPrivateOrLocalhost('http://10.0.0.5:5173')).toBe(true);
      expect(isPrivateOrLocalhost('http://10.254.1.99:3000')).toBe(true);
      expect(isPrivateOrLocalhost('http://10.0.0.1')).toBe(true);
    });

    it('allows 172.16.0.0/12 private LAN range (172.16.x.x - 172.31.x.x)', () => {
      expect(isPrivateOrLocalhost('http://172.16.0.1:5173')).toBe(true);
      expect(isPrivateOrLocalhost('http://172.20.10.5:5173')).toBe(true);
      expect(isPrivateOrLocalhost('http://172.31.255.254:5173')).toBe(true);
    });

    it('rejects IPs outside the 172.16.0.0/12 range', () => {
      expect(isPrivateOrLocalhost('http://172.15.255.255:5173')).toBe(false);
      expect(isPrivateOrLocalhost('http://172.32.0.1:5173')).toBe(false);
      expect(isPrivateOrLocalhost('http://172.1.1.1:5173')).toBe(false);
    });

    it('allows 192.168.0.0/16 private LAN range', () => {
      expect(isPrivateOrLocalhost('http://192.168.1.50:5173')).toBe(true);
      expect(isPrivateOrLocalhost('http://192.168.0.1:3000')).toBe(true);
      expect(isPrivateOrLocalhost('http://192.168.100.200:80')).toBe(true);
    });

    it('rejects IPs outside the 192.168.0.0/16 range', () => {
      expect(isPrivateOrLocalhost('http://192.167.1.1:5173')).toBe(false);
      expect(isPrivateOrLocalhost('http://192.169.1.1:5173')).toBe(false);
      expect(isPrivateOrLocalhost('http://193.168.1.1:5173')).toBe(false);
    });

    it('rejects public internet IPs', () => {
      expect(isPrivateOrLocalhost('http://8.8.8.8:5173')).toBe(false);
      expect(isPrivateOrLocalhost('http://1.1.1.1:5173')).toBe(false);
      expect(isPrivateOrLocalhost('http://142.250.190.46')).toBe(false);
    });

    it('rejects attacker domain spoofing localhost or private IPs', () => {
      expect(isPrivateOrLocalhost('http://localhost.evil.com')).toBe(false);
      expect(isPrivateOrLocalhost('http://evil-localhost.com')).toBe(false);
      expect(isPrivateOrLocalhost('http://192.168.1.50.attacker.com')).toBe(false);
      expect(isPrivateOrLocalhost('http://attacker10.0.0.1.com')).toBe(false);
    });

    it('rejects non-http/https protocols', () => {
      expect(isPrivateOrLocalhost('ftp://localhost:21')).toBe(false);
      expect(isPrivateOrLocalhost('ws://localhost:5173')).toBe(false);
      expect(isPrivateOrLocalhost('javascript:alert(1)')).toBe(false);
    });

    it('rejects malformed URLs without throwing', () => {
      expect(isPrivateOrLocalhost('not-a-url')).toBe(false);
      expect(isPrivateOrLocalhost('')).toBe(false);
      expect(isPrivateOrLocalhost('://missing-scheme')).toBe(false);
    });
  });

  describe('Full Request Origin Check (isOriginAllowed)', () => {
    it('allows requests without an Origin header (server-to-server, curl, health-check probes)', () => {
      expect(isOriginAllowed(undefined)).toBe(true);
      expect(isOriginAllowed('')).toBe(true);
    });

    it('allows explicitly configured production origin in CLIENT_URL', () => {
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';
      expect(isOriginAllowed('https://syncspace.onrender.com')).toBe(true);
      // Handles trailing slash in incoming request
      expect(isOriginAllowed('https://syncspace.onrender.com/')).toBe(true);
    });

    it('allows explicitly configured frontend origin in FRONTEND_URL', () => {
      process.env.FRONTEND_URL = 'https://staging.syncspace.dev';
      expect(isOriginAllowed('https://staging.syncspace.dev')).toBe(true);
    });

    it('allows local development origins in non-production mode', () => {
      process.env.NODE_ENV = 'development';
      expect(isOriginAllowed('http://localhost:5173')).toBe(true);
      expect(isOriginAllowed('http://127.0.0.1:5173')).toBe(true);
      expect(isOriginAllowed('http://192.168.1.15:5173')).toBe(true);
      expect(isOriginAllowed('http://10.0.0.1:3000')).toBe(true);
    });

    it('rejects unknown external origins in development mode', () => {
      process.env.NODE_ENV = 'development';
      expect(isOriginAllowed('https://malicious-website.com')).toBe(false);
      expect(isOriginAllowed('https://phishing-syncspace.com')).toBe(false);
      expect(isOriginAllowed('http://attacker.com')).toBe(false);
      expect(isOriginAllowed('null')).toBe(false);
    });
  });

  describe('Production LAN Origin Restrictions (NODE_ENV=production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';
    });

    it('allows explicitly configured CLIENT_URL in production', () => {
      expect(isOriginAllowed('https://syncspace.onrender.com')).toBe(true);
      expect(isOriginAllowed('https://syncspace.onrender.com/')).toBe(true);
    });

    it('strictly rejects arbitrary RFC 1918 private LAN origins in production', () => {
      expect(isOriginAllowed('http://192.168.1.50:5173')).toBe(false);
      expect(isOriginAllowed('http://192.168.0.1:3000')).toBe(false);
      expect(isOriginAllowed('http://10.0.0.5:5173')).toBe(false);
      expect(isOriginAllowed('http://172.20.10.5:5173')).toBe(false);
    });

    it('strictly rejects arbitrary localhost origins in production when not configured', () => {
      expect(isOriginAllowed('http://localhost:5173')).toBe(false);
      expect(isOriginAllowed('http://127.0.0.1:5173')).toBe(false);
      expect(isOriginAllowed('http://localhost:3000')).toBe(false);
    });

    it('allows localhost in production only if explicitly configured in CLIENT_URL', () => {
      process.env.CLIENT_URL = 'http://localhost:5173';
      expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    });

    it('allows requests without an Origin header in production (e.g. Render health checks)', () => {
      expect(isOriginAllowed(undefined)).toBe(true);
      expect(isOriginAllowed('')).toBe(true);
    });

    it('rejects untrusted external origins in production', () => {
      expect(isOriginAllowed('https://malicious-site.com')).toBe(false);
      expect(isOriginAllowed('https://fake-syncspace.onrender.com')).toBe(false);
    });
  });

  describe('Express corsOptions Object', () => {
    it('has credentials set to true', () => {
      expect(corsOptions.credentials).toBe(true);
    });

    it('never uses wildcard origin with credentials', () => {
      expect(corsOptions.origin).not.toBe('*');
      expect(typeof corsOptions.origin).toBe('function');
    });

    it('calls callback(null, true) for allowed origin', () => {
      process.env.CLIENT_URL = 'https://syncspace.onrender.com';
      const originFn = corsOptions.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => void;

      let calledWithAllow: boolean | undefined;
      originFn('https://syncspace.onrender.com', (err, allow) => {
        expect(err).toBeNull();
        calledWithAllow = allow;
      });
      expect(calledWithAllow).toBe(true);
    });

    it('calls callback(null, false) for rejected origin', () => {
      const originFn = corsOptions.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => void;

      let calledWithAllow: boolean | undefined;
      originFn('https://evil-untrusted-origin.com', (err, allow) => {
        expect(err).toBeNull();
        calledWithAllow = allow;
      });
      expect(calledWithAllow).toBe(false);
    });

    it('calls callback(null, true) when origin is undefined (no origin header)', () => {
      const originFn = corsOptions.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => void;

      let calledWithAllow: boolean | undefined;
      originFn(undefined, (err, allow) => {
        expect(err).toBeNull();
        calledWithAllow = allow;
      });
      expect(calledWithAllow).toBe(true);
    });
  });
});
