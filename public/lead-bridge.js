(function () {
  if (window.__leadBridgePatched) return;
  window.__leadBridgePatched = true;

  // Central config: update here once and all microsites using this script get6   it. 
  var CONFIG = {
    webhook: 'https://script.google.com/macros/s/AKfycbxBnaaiaDKmtpikQGOz2_uqLNPYY2E4QuEE4WMLptAGhG9NLbG8gr94aoN6Or-mLjVB4g/exec',
    defaultProjectId: '',
    projectByHost: {
      
    },
    siteNameByHost: {}
  };
  var SCRIPT_CONFIG = readScriptConfig();

  var SENT_CACHE = Object.create(null);
  var SENT_TTL_MS = 30 * 60 * 1000;
  var SENT_STORAGE_KEY = '__leadBridgeSentCacheV1';

  function makeUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function readPersistentCache() {
    try {
      if (!window.localStorage) return {};
      var raw = window.localStorage.getItem(SENT_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function writePersistentCache(cache) {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(SENT_STORAGE_KEY, JSON.stringify(cache || {}));
    } catch (err) {
      // Ignore storage errors (quota/privacy modes).
    }
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function leadSignature(payload) {
    payload = payload || {};
    var project = normalizeText(payload.project_id);
    var phone = normalizePhone(payload.phone || payload.full_phone || payload.number);
    var email = normalizeText(payload.email);
    var number = normalizePhone(payload.number);
    var name = normalizeText(payload.name);

    // Primary dedupe key should mirror CRM behavior: one lead per project + phone/email window.
    if (project && phone) return [project, 'phone', phone].join('|');
    if (project && number) return [project, 'number', number].join('|');
    if (project && email) return [project, 'email', email].join('|');
    return [project, 'fallback', name, normalizeText(payload.form_id || payload.tracking_lead_id)].join('|');
  }

  function isDuplicateSignature(signature, now) {
    var ts = SENT_CACHE[signature];
    if (ts && now - ts < SENT_TTL_MS) return true;

    var persistent = readPersistentCache();
    var persistentTs = Number(persistent[signature] || 0);
    if (persistentTs && now - persistentTs < SENT_TTL_MS) {
      SENT_CACHE[signature] = persistentTs;
      return true;
    }
    return false;
  }

  function markSignatureSent(signature, now) {
    SENT_CACHE[signature] = now;
    var persistent = readPersistentCache();
    var next = {};
    Object.keys(persistent).forEach(function (key) {
      var ts = Number(persistent[key] || 0);
      if (ts && now - ts < SENT_TTL_MS) next[key] = ts;
    });
    next[signature] = now;
    writePersistentCache(next);
  }

  function getBridgeScriptTag() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i -= 1) {
      var src = String(scripts[i].getAttribute('src') || '');
      if (src.indexOf('lead-bridge') !== -1) return scripts[i];
    }
    return null;
  }

  function readScriptConfig() {
    var tag = getBridgeScriptTag();
    if (!tag) return {};
    return {
      projectId: String(tag.getAttribute('data-leadhub-project-id') || '').trim(),
      siteDomain: String(tag.getAttribute('data-leadhub-site-domain') || '').trim(),
      siteName: String(tag.getAttribute('data-leadhub-site-name') || '').trim()
    };
  }

  function projectForPayload(payload) {
    var explicit = payload.project_id || payload.projectId || SCRIPT_CONFIG.projectId || window.MICROSITE_PROJECT_ID || window.projectId || window.project_id;
    if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') return String(explicit).trim();
    if (CONFIG.projectByHost[location.host]) return String(CONFIG.projectByHost[location.host]).trim();
    return String(CONFIG.defaultProjectId || '').trim();
  }

  function parsePossiblePayload(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      var s = raw.trim();
      if (!s) return null;
      try {
        return JSON.parse(s);
      } catch (err) {
        var params = new URLSearchParams(s);
        var out = {};
        params.forEach(function (v, k) { out[k] = v; });
        return out;
      }
    }
    if (typeof FormData !== 'undefined' && raw instanceof FormData) {
      var fdOut = {};
      raw.forEach(function (v, k) { fdOut[k] = String(v); });
      return fdOut;
    }
    if (typeof URLSearchParams !== 'undefined' && raw instanceof URLSearchParams) {
      var qsOut = {};
      raw.forEach(function (v, k) { qsOut[k] = v; });
      return qsOut;
    }
    if (typeof raw === 'object') return raw;
    return null;
  }

  function looksLikeLead(payload) {
    if (!payload || typeof payload !== 'object') return false;
    var projectId = projectForPayload(payload);
    if (!projectId) return false;
    var hasPhone = Boolean(payload.number || payload.phone || payload.full_phone || payload.mobile || payload.mobile_number);
    var hasIdentity = Boolean(payload.number || payload.email || payload.name);
    var hasLeadMarker = Boolean(payload.form_id || payload.tracking_lead_id || payload.source_id);

    // Ignore non-lead events that only contain a phone but no lead identity/markers.
    if (hasPhone && !hasIdentity && !hasLeadMarker) return false;
    return Boolean(hasPhone || payload.email || payload.name);
  }

  function enrich(payload) {
    var qs = new URLSearchParams(location.search);
    payload = payload && typeof payload === 'object' ? payload : {};
    var country = payload.country_code || '';
    var number = payload.number || '';
    var phone = payload.phone || payload.full_phone || payload.mobile || payload.mobile_number || (country + number);
    var projectId = projectForPayload(payload);

    return {
      submitted_at: new Date().toISOString(),
      lead_uuid: makeUuid(),
      site_name: payload.site_name || SCRIPT_CONFIG.siteName || CONFIG.siteNameByHost[location.host] || window.MICROSITE_NAME || location.hostname,
      site_domain: payload.site_domain || payload.domain || SCRIPT_CONFIG.siteDomain || location.host,
      form_id: payload.form_id || payload.tracking_lead_id || 'default_tracking_id',
      tracking_lead_id: payload.tracking_lead_id || payload.form_id || 'default_tracking_id',
      name: payload.name || '',
      phone: phone || '',
      number: payload.number || '',
      full_phone: phone || '',
      country_code: country,
      email: payload.email || '',
      message: payload.message || '',
      source_id: String(payload.source_id || ''),
      project_id: projectId,
      page_url: payload.page_url || location.href,
      utm_source: payload.utm_source || qs.get('utm_source') || '',
      utm_medium: payload.utm_medium || qs.get('utm_medium') || '',
      utm_campaign: payload.utm_campaign || qs.get('utm_campaign') || '',
      utm_term: payload.utm_term || qs.get('utm_term') || '',
      utm_content: payload.utm_content || qs.get('utm_content') || '',
      raw_payload: JSON.stringify(payload || {})
    };
  }

  function sendToSheet(payload) {
    if (!CONFIG.webhook) return Promise.resolve(false);
    try {
      var signature = leadSignature(payload);
      var now = Date.now();
      if (isDuplicateSignature(signature, now)) return Promise.resolve(true);
      markSignatureSent(signature, now);

      var body = new URLSearchParams(payload).toString();
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/x-www-form-urlencoded;charset=UTF-8' });
        var queued = navigator.sendBeacon(CONFIG.webhook, blob);
        if (queued) return Promise.resolve(true);
      }

      return fetch(CONFIG.webhook, {
        method: 'POST',
        body: body,
        mode: 'no-cors',
        keepalive: true
      }).then(function () { return true; }).catch(function () { return false; });
    } catch (err) {
      console.error('Lead bridge sheet send failed:', err);
      return Promise.resolve(false);
    }
  }

  function redirectToThankYou(thankyou) {
    var url = String(thankyou || 'thankyou.html').trim();
    if (!url) return;
    if (location.href.indexOf(url) === -1) location.href = url;
  }

  function maybeForwardLead(rawPayload) {
    var parsed = parsePossiblePayload(rawPayload);
    if (!looksLikeLead(parsed)) return;
    sendToSheet(enrich(parsed));
  }

  function installNetworkHooks() {
    if (window.__leadHubNetworkHooked) return;
    window.__leadHubNetworkHooked = true;

    var originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function (input, init) {
        try {
          var url = '';
          if (typeof input === 'string') url = input;
          else if (input && typeof input.url === 'string') url = input.url;
          if (url !== CONFIG.webhook && init && Object.prototype.hasOwnProperty.call(init, 'body')) maybeForwardLead(init.body);
        } catch (err) {
          console.warn('Lead bridge fetch hook error:', err);
        }
        return originalFetch.apply(this, arguments);
      };
    }

    if (typeof XMLHttpRequest !== 'undefined') {
      var originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (body) {
        try {
          maybeForwardLead(body);
        } catch (err) {
          console.warn('Lead bridge xhr hook error:', err);
        }
        return originalSend.call(this, body);
      };
    }
  }

  function patchSendLead() {
    if (typeof window.SendLead !== 'function') {
      setTimeout(patchSendLead, 200);
      return;
    }
    var original = window.SendLead;
    window.SendLead = function () {
      var payload = arguments[0] || {};
      var thankyou = arguments[1];
      try {
        maybeForwardLead(payload);
      } catch (err) {
        console.warn('Lead bridge SendLead hook error:', err);
      }

      try {
        var result = original.apply(this, arguments);

        if (result && typeof result.then === 'function') {
          return result
            .catch(function (err) {
              console.warn('CRM SendLead failed:', err);
              return null;
            })
            .finally(function () {
              redirectToThankYou(thankyou);
            });
        }

        redirectToThankYou(thankyou);
        return result;
      } catch (err) {
        console.warn('CRM SendLead threw error:', err);
        redirectToThankYou(thankyou);
        return null;
      }
    };
  }

  patchSendLead();
  installNetworkHooks();
})();
