(function () {
  if (window.__leadBridgePatched) return;
  window.__leadBridgePatched = true;

  // Central config: update here once and all microsites using this script get it.
  var CONFIG = {
    webhook: 'https://script.google.com/macros/s/AKfycbxBnaaiaDKmtpikQGOz2_uqLNPYY2E4QuEE4WMLptAGhG9NLbG8gr94aoN6Or-mLjVB4g/exec',
    defaultProjectId: '',
    projectByHost: {
      '127.0.0.1:5507': '6110'
    },
    siteNameByHost: {}
  };
  var SCRIPT_CONFIG = readScriptConfig();

  var SENT_CACHE = Object.create(null);
  var SENT_TTL_MS = 15000;

  function makeUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
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
    return Boolean(payload.number || payload.phone || payload.full_phone || payload.mobile || payload.mobile_number || payload.email || payload.name);
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
      var signature = [payload.project_id, payload.form_id, payload.phone, payload.email, payload.name].join('|');
      var now = Date.now();
      if (SENT_CACHE[signature] && now - SENT_CACHE[signature] < SENT_TTL_MS) return Promise.resolve(true);
      SENT_CACHE[signature] = now;

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
          if (init && Object.prototype.hasOwnProperty.call(init, 'body')) maybeForwardLead(init.body);
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
