/* =========================================================================
 * map-carto.js — MapAdapter 実装（CARTO / Leaflet）
 * -------------------------------------------------------------------------
 * Leaflet と CARTO タイルへの依存はすべてこのファイルに閉じる。
 * （Leaflet の CSS/JS の動的ロードもここで行う。index.html には持たせない）
 * app.js は window.MapAdapter のインターフェースだけを呼ぶ。
 *
 * - 冒頭でプロバイダを判定し、CARTO版でなければ即座に終了する
 *   → Google版では Leaflet CSS/JS へのリクエストが一切発生しない
 * - CARTO版では MapAdapter.init() が呼ばれた時点で Leaflet CSS/JS を読み込み、
 *   完了後に地図を初期化する（onload / onerror / タイムアウトを設定）
 * - 読み込み失敗・タイムアウト時は Promise を reject し、
 *   app.js 側の既存エラー表示（#loading への Error 表示）に処理を渡す
 * ========================================================================= */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};

  // ▼ プロバイダ判定：CARTO版でなければ何もせずに終了する
  if (String(CFG.MAP_PROVIDER || 'carto').toLowerCase() !== 'carto') return;

  let map, tileLayer, meMarker = null, meCircle = null;

  /* ---------- Leaflet の動的ロード（CARTO版専用） ---------- */
  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
  const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

  // 未定義時は 15 秒にフォールバック（config.js の LEAFLET_TIMEOUT_MS で変更可）
  const LEAFLET_TIMEOUT_MS = Number(CFG.LEAFLET_TIMEOUT_MS) > 0 ? Number(CFG.LEAFLET_TIMEOUT_MS) : 15000;

  let leafletPromise = null;

  function loadCSS(href, integrity) {
    return new Promise(function (resolve, reject) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      if (integrity) { l.integrity = integrity; l.crossOrigin = ''; }
      l.onload = function () { resolve(); };
      l.onerror = function () { reject(new Error('Leaflet CSS の読み込みに失敗: ' + href)); };
      document.head.appendChild(l);
    });
  }

  function loadJS(src, integrity) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // 挿入順どおりに実行させる
      if (integrity) { s.integrity = integrity; s.crossOrigin = ''; }
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Leaflet JS の読み込みに失敗: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // onload / onerror のどちらも発生しない場合に備えたタイムアウト
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      const tid = setTimeout(function () {
        reject(new Error(label + ' がタイムアウトしました (' + ms + 'ms)'));
      }, ms);
      promise.then(function (v) { clearTimeout(tid); resolve(v); },
                   function (e) { clearTimeout(tid); reject(e); });
    });
  }

  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve();
    if (leafletPromise) return leafletPromise;
    leafletPromise = withTimeout(
      Promise.all([
        loadCSS(LEAFLET_CSS, LEAFLET_CSS_SRI),
        loadJS(LEAFLET_JS, LEAFLET_JS_SRI)
      ]).then(function () {
        if (!window.L || !window.L.map) throw new Error('Leaflet の初期化に失敗（L が未定義）');
      }),
      LEAFLET_TIMEOUT_MS,
      'Leaflet の読み込み'
    ).catch(function (e) {
      leafletPromise = null; // 失敗は保持しない（再試行可能にする）
      throw e;
    });
    return leafletPromise;
  }

  const TILE_LIGHT =
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=' + CFG.CARTO_API_KEY;

  function makeIcon(color) {
    const pin = window.MapShared.pinSvg(color); // CSS変数 var(--bg) で中心円
    return L.divIcon({
      className: '',
      html: '<div class="poi-marker">' + pin + '</div>',
      iconSize: [30, 38], iconAnchor: [15, 36], popupAnchor: [0, -32]
    });
  }

  const Adapter = {
    init({ containerId, center, zoom }) {
      // Leaflet CSS/JS を読み込んでから地図を初期化する。
      // 失敗・タイムアウト時は reject され、app.js のエラー表示に渡る。
      return loadLeaflet().then(() => {
        map = L.map(containerId, {
          zoomControl: true, attributionControl: true,
          preferCanvas: true, zoomSnap: .5
        }).setView([center.lat, center.lng], zoom);

        tileLayer = L.tileLayer(TILE_LIGHT, {
          maxZoom: 20, subdomains: 'abcd',
          referrerPolicy: 'strict-origin-when-cross-origin',
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>'
        }).addTo(map);

        document.documentElement.setAttribute('data-theme', 'light');
        const meta = document.getElementById('themeColorMeta');
        if (meta) meta.setAttribute('content', '#ffffff');
      });
    },

    addMarker({ id, lat, lng, color, popupHtml, onClick, onPopupOpen }) {
      const m = L.marker([lat, lng], { icon: makeIcon(color) })
        .bindPopup(popupHtml, { maxWidth: 290, minWidth: 270, closeButton: true });
      if (onClick) m.on('click', onClick);
      if (onPopupOpen) {
        m.on('popupopen', (e) => {
          const el = e.popup.getElement();
          onPopupOpen(el);
        });
      }
      return m; // ref
    },

    showMarker(ref) { if (ref && !map.hasLayer(ref)) ref.addTo(map); },
    hideMarker(ref) { if (ref && map.hasLayer(ref)) map.removeLayer(ref); },

    openPopup(ref) { if (ref) ref.openPopup(); },
    closePopup() { map.closePopup(); },

    setView(lat, lng, zoom, opts) {
      map.setView([lat, lng], zoom, opts || { animate: true });
    },
    getZoom() { return map.getZoom(); },

    fitBounds(points, opts) {
      if (!points || !points.length) return;
      const b = L.latLngBounds(points.map(p => [p.lat, p.lng]));
      if (b.isValid()) {
        const pad = (opts && opts.padding) || 40;
        map.fitBounds(b, { padding: [pad, pad] });
      }
    },

    panBy(dx, dy) { map.panBy([dx, dy], { animate: false }); },

    setMe(lat, lng, accuracy) {
      const ll = [lat, lng];
      if (meMarker) map.removeLayer(meMarker);
      if (meCircle) map.removeLayer(meCircle);
      meMarker = L.marker(ll, {
        icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        zIndexOffset: 1000
      }).addTo(map).bindPopup('現在地 / You are here');
      if (accuracy) {
        meCircle = L.circle(ll, {
          radius: accuracy, color: '#0a0a0a', weight: 1, fillColor: '#0a0a0a', fillOpacity: .05
        }).addTo(map);
      }
    },

    // 現在地がPOI範囲内なら寄せる（共通ロジックから呼ばれる）
    recenterIfWithinPois(lat, lng, pois) {
      try {
        const b = L.latLngBounds(pois.map(p => [p.spot.latitude, p.spot.longitude]));
        if (b.isValid() && b.pad(0.5).contains([lat, lng])) {
          map.setView([lat, lng], Math.max(15, map.getZoom()), { animate: true });
        }
      } catch (_) {}
    },

    invalidateSize() { if (map) map.invalidateSize(); }
  };

  // 冒頭のプロバイダ判定を通過しているので、ここでは常に CARTO版として登録する
  window.MapAdapter = Adapter;
})();
