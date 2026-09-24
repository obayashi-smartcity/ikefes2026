/* =========================================================================
 * map-google.js — MapAdapter 実装（Google Maps JavaScript API）
 * -------------------------------------------------------------------------
 * Google Maps への依存はすべてこのファイルに閉じる。
 * app.js は window.MapAdapter のインターフェースだけを呼ぶ（CARTO版と同一契約）。
 * ========================================================================= */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  if ((CFG.MAP_PROVIDER || 'carto') !== 'google') return; // Google指定のときだけ有効化

  let map, infoWindow, meMarker = null, meCircle = null;
  let currentOpenPopupHandler = null;

  // 現行サイトのミニマルな見た目に寄せる淡色スタイル
  const LIGHT_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#fafafa' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#737373' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
    { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e5eef5' }] }
  ];

  /* Google Maps JS API を動的ロード
   * -----------------------------------------------------------------------
   * Google 側のコールバックも script.onerror も発生しないケース
   * （通信断・プロキシによる遮断・応答が返らない等）では Promise が永久に
   * 未解決となり、画面が "Loading…" のまま固まる。
   * → タイムアウトを設け、一定時間で必ず reject して
   *   app.js 側の catch（エラーメッセージ表示）へ確実に到達させる。 */
  const GMAPS_TIMEOUT_MS = Number(CFG.GOOGLE_MAPS_TIMEOUT_MS) > 0 ?
    Number(CFG.GOOGLE_MAPS_TIMEOUT_MS) : 15000;
  function loadGoogleMaps() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps) { resolve(); return; }
      const key = CFG.GOOGLE_MAPS_API_KEY;
      if (!key || key === 'YOUR_GOOGLE_MAPS_API_KEY') {
        reject(new Error('Google Maps APIキー未設定（config.js の GOOGLE_MAPS_API_KEY）'));
        return;
      }
      const cbName = '__gmapsCb_' + Date.now();
      let settled = false;   // resolve / reject を一度だけにする
      let timerId = null;
      // 後片付け：タイマー解除とグローバルコールバックの削除
      function cleanup() {
        if (timerId !== null) { clearTimeout(timerId); timerId = null; }
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      }
      // err を渡せば reject、省略すれば resolve。二重発火は無視する
      function done(err) {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err); else resolve();
      }
      window[cbName] = () => done();
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
        '&loading=async&callback=' + cbName + '&language=ja&region=JP';
      s.async = true; s.defer = true;
      s.onerror = () => done(new Error('Google Maps スクリプトの読み込みに失敗'));
      // コールバックも onerror も発生しない場合の保険
      timerId = setTimeout(() => {
        // 稀に callback 未発火でも API 本体が利用可能になっている場合があるため最終確認
        if (window.google && window.google.maps) { done(); return; }
        done(new Error('Google Maps の読み込みがタイムアウトしました（' +
          GMAPS_TIMEOUT_MS + 'ms）。通信環境をご確認ください'));
      }, GMAPS_TIMEOUT_MS);
      document.head.appendChild(s);
    });
  }

  function pinIcon(color) {
    // 中心円は白（データURIではCSS変数が効かないため実色を指定）
    const svg = window.MapShared.pinSvg(color, '#ffffff');
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(30, 38),
      anchor: new google.maps.Point(15, 36)
    };
  }
  function meIcon() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
      '<circle cx="8" cy="8" r="6" fill="#0a0a0a" stroke="#ffffff" stroke-width="2.5"/></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(16, 16),
      anchor: new google.maps.Point(8, 8)
    };
  }

  /* =======================================================================
   * InfoWindow 自動フィット
   * -----------------------------------------------------------------------
   * Google は InfoWindow の max-height を控えめに設定するため、タイトルが
   * 2行になると住所行が下で切れてしまう。
   * 「使える高さ」を地図から算出し、住所行の下端までが収まるように
   * サムネイル画像の高さを逆算して縮める（タイトルは常に全行表示）。
   * ======================================================================= */
  function fitInfoWindow() {
    const d = document.querySelector('.gm-style-iw-d');
    if (!d || !map || !map.getDiv()) return;

    const mapH = map.getDiv().offsetHeight || 0;
    if (!mapH) return;

    // 地図の高さに対して InfoWindow が使える実用高さ（上下UI分を差し引く）
    const usable = Math.max(240, Math.round(mapH * 0.74));
    d.style.maxHeight = usable + 'px';
    const c = d.closest('.gm-style-iw-c');
    if (c) c.style.maxHeight = (usable + 20) + 'px';

    const pop   = d.querySelector('.pop');
    const thumb = d.querySelector('.pop-thumb');
    // 住所が無いPOIはタイトルまでを基準にする
    const anchor = d.querySelector('.pop-addr') || d.querySelector('.pop-title');
    if (!pop || !anchor) return;

    const DEFAULT_H = 118;   // 画像の既定の高さ
    const MIN_H     = 64;    // これ以上は縮めない下限
    const MARGIN    = 8;     // 下端の余裕

    // 前回の値が残らないよう、まず既定値に戻してから実測する
    if (thumb) thumb.style.display = '';
    pop.style.setProperty('--pop-thumb-h', DEFAULT_H + 'px');

    // 「popの先頭」から「住所行の下端」までに必要な高さ
    const popTop = pop.getBoundingClientRect().top;
    const needed = anchor.getBoundingClientRect().bottom - popTop + MARGIN;

    if (needed > usable) {
      const newH = Math.max(MIN_H, DEFAULT_H - (needed - usable));
      pop.style.setProperty('--pop-thumb-h', newH + 'px');
      // 下限まで縮めても足りない長いタイトルは、画像より住所を優先する
      if (newH <= MIN_H && thumb) {
        const still = anchor.getBoundingClientRect().bottom - popTop + MARGIN;
        if (still > usable) thumb.style.display = 'none';
      }
    }

    // 開いた直後は必ず先頭から表示
    d.scrollTop = 0;
  }

  const Adapter = {
    init({ containerId, center, zoom }) {
      return loadGoogleMaps().then(() => {
        map = new google.maps.Map(document.getElementById(containerId), {
          center: { lat: center.lat, lng: center.lng },
          zoom: zoom,
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          clickableIcons: false,
          styles: LIGHT_STYLE,
          gestureHandling: 'greedy'
        });
        infoWindow = new google.maps.InfoWindow({ maxWidth: 290 });
        document.documentElement.setAttribute('data-theme', 'light');
        const meta = document.getElementById('themeColorMeta');
        if (meta) meta.setAttribute('content', '#ffffff');
      });
    },

    addMarker({ id, lat, lng, color, popupHtml, onClick, onPopupOpen }) {
      const marker = new google.maps.Marker({
        position: { lat, lng },
        icon: pinIcon(color),
        optimized: false
      });
      marker._popupHtml = popupHtml;
      marker._onPopupOpen = onPopupOpen;
      marker.addListener('click', () => {
        if (onClick) onClick();
        Adapter.openPopup(marker);
      });
      return marker; // ref
    },

    showMarker(ref) { if (ref && ref.getMap() !== map) ref.setMap(map); },
    hideMarker(ref) { if (ref && ref.getMap()) ref.setMap(null); },

    openPopup(ref) {
      if (!ref) return;
      infoWindow.setContent(ref._popupHtml);
      // domready で InfoWindow の中身が生成された後に Read more を配線
      if (currentOpenPopupHandler) google.maps.event.removeListener(currentOpenPopupHandler);
      currentOpenPopupHandler = google.maps.event.addListenerOnce(infoWindow, 'domready', () => {
        const container = document.querySelector('.gm-style-iw-d') || document.querySelector('.gm-style-iw');
        if (ref._onPopupOpen && container) ref._onPopupOpen(container);

        /* InfoWindow 自動フィット：住所行まで必ず見えるように調整する */
        try { fitInfoWindow(); } catch (e) {}
      });
      infoWindow.open({ map, anchor: ref });
    },
    closePopup() { if (infoWindow) infoWindow.close(); },

    setView(lat, lng, zoom, opts) {
      map.setZoom(zoom);
      if (opts && opts.animate) map.panTo({ lat, lng });
      else map.setCenter({ lat, lng });
    },
    getZoom() { return map.getZoom(); },

    fitBounds(points, opts) {
      if (!points || !points.length) return;
      const b = new google.maps.LatLngBounds();
      points.forEach(p => b.extend({ lat: p.lat, lng: p.lng }));
      const pad = (opts && opts.padding) || 40;
      map.fitBounds(b, { top: pad, right: pad, bottom: pad, left: pad });
    },

    panBy(dx, dy) { map.panBy(dx, dy); },

    setMe(lat, lng, accuracy) {
      const pos = { lat, lng };
      if (meMarker) meMarker.setMap(null);
      if (meCircle) meCircle.setMap(null);
      meMarker = new google.maps.Marker({ position: pos, icon: meIcon(), map, zIndex: 1000, optimized: false });
      if (accuracy) {
        meCircle = new google.maps.Circle({
          center: pos, radius: accuracy, map,
          strokeColor: '#0a0a0a', strokeWeight: 1, fillColor: '#0a0a0a', fillOpacity: .05
        });
      }
    },

    recenterIfWithinPois(lat, lng, pois) {
      try {
        const b = new google.maps.LatLngBounds();
        pois.forEach(p => b.extend({ lat: p.spot.latitude, lng: p.spot.longitude }));
        // 0.5相当の余白を持たせて内外判定
        const ne = b.getNorthEast(), sw = b.getSouthWest();
        const latPad = (ne.lat() - sw.lat()) * 0.5, lngPad = (ne.lng() - sw.lng()) * 0.5;
        const within = lat <= ne.lat() + latPad && lat >= sw.lat() - latPad &&
                       lng <= ne.lng() + lngPad && lng >= sw.lng() - lngPad;
        if (within) { map.setZoom(Math.max(15, map.getZoom())); map.panTo({ lat, lng }); }
      } catch (_) {}
    },

    invalidateSize() {
      if (map && window.google) google.maps.event.trigger(map, 'resize');
    }
  };

  window.MapAdapter = Adapter;
})();
