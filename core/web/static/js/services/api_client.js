/**
 * Production-Grade Typed REST API Client
 * จัดการการเชื่อมต่อเครือข่ายระหว่าง Frontend และ FastAPI Backend
 * รองรับ AbortController, Timeout, Anti-cache headers, และ Error Handling
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ApiClient = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class ApiClient {
    constructor(options = {}) {
      this.baseUrl = options.baseUrl || '';
      this.timeoutMs = options.timeoutMs || 15000;
      this.fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(window) : null);
    }

    /**
     * ดึงข้อมูลสรุป Dataset และตัวกรองคลาส
     */
    async getSummary(signal) {
      return this._request('/api/summary', { signal });
    }

    /**
     * ดึงรายการ Index ที่ตรงกับตัวกรองที่เลือก (รองรับทั้ง string filterKey เดิม หรือ options { status, classes })
     */
    async getFilterIndices(options = 'all', signal) {
      if (typeof options === 'string') {
        const q = encodeURIComponent(options || 'all');
        return this._request(`/api/filter-indices?filter=${q}`, { signal });
      }
      const { status = 'all', classes = [], confMin, confMax, includeLowConf } = options;
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (classes && classes.length > 0) params.set('classes', classes.join(','));
      if (confMin !== undefined && confMin !== null) params.set('conf_min', confMin);
      if (confMax !== undefined && confMax !== null) params.set('conf_max', confMax);
      if (includeLowConf !== undefined && includeLowConf !== null) params.set('include_low_conf', includeLowConf);
      return this._request(`/api/filter-indices?${params.toString()}`, { signal });
    }

    /**
     * ดึง Metadata ของภาพและ Annotations ตาม Index
     */
    async getItem(index, signal) {
      return this._request(`/api/item/${index}`, { signal });
    }

    /**
     * ดึง Blob ข้อมูลรูปภาพตาม Index (และ Stem เพื่อความถูกต้อง)
     */
    async fetchImageBlob(index, stem, signal) {
      const url = stem
        ? `${this.baseUrl}/api/image/${index}?stem=${encodeURIComponent(stem)}&t=${Date.now()}`
        : `${this.baseUrl}/api/image/${index}?t=${Date.now()}`;

      const res = await this._rawFetch(url, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache, no-store' },
        signal
      });

      if (!res.ok) {
        throw new Error(`[ApiClient] Failed to fetch image ${index}: HTTP ${res.status}`);
      }
      return res.blob();
    }

    /**
     * บันทึก Annotations และสถานะการตรวจทาน
     */
    async saveItem(index, payload, signal) {
      return this._request(`/api/save/${index}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(payload),
        signal
      });
    }

    async _request(endpoint, options = {}) {
      const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}t=${Date.now()}`;
      const res = await this._rawFetch(url, {
        ...options,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {})
        }
      });

      if (!res.ok) {
        let errDetail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson && errJson.detail) errDetail = errJson.detail;
        } catch (e) {}
        throw new Error(`[ApiClient Error] ${endpoint}: ${errDetail}`);
      }

      return res.json();
    }

    async _rawFetch(url, options = {}) {
      if (!this.fetchFn) {
        throw new Error('[ApiClient] No fetch function available in this environment');
      }

      let timeoutId = null;
      let timedOut = false;

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const combinedSignal = options.signal || (controller ? controller.signal : null);

      if (this.timeoutMs > 0 && controller) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, this.timeoutMs);
      }

      try {
        const res = await this.fetchFn(url, { ...options, signal: combinedSignal });
        return res;
      } catch (err) {
        if (timedOut) {
          throw new Error(`[ApiClient] Request timeout after ${this.timeoutMs}ms: ${url}`);
        }
        throw err;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }

  return ApiClient;
}));
