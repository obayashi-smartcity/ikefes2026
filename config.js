/* =========================================================================
 * config.js — 地図プロバイダ設定（ここだけ変えれば CARTO ⇄ Google を切替）
 * =========================================================================
 * MAP_PROVIDER:
 *   'carto'  … CARTO(Leaflet) 版を使う（既定）
 *   'google' … Google Maps 版を使う
 *
 * URLパラメータでも一時的に切替可能:
 *   ?map=google / ?map=carto
 *   （別サイトからの event_id 遷移時はそのまま event_id も併用できます）
 * ========================================================================= */
window.APP_CONFIG = {
  // ▼▼▼ 通常はこの1行を 'carto' か 'google' に変えるだけ ▼▼▼
  MAP_PROVIDER: 'carto',

  // CARTO Basemaps はラスタータイルにAPIキーが必須（?key= で付与）
  CARTO_API_KEY: 'cb1_2rcy_1_3673d2ee2e8b7013c29c99aa',

  // Google Maps JavaScript API のキー（Google Cloud で発行）
  // ※未設定のままだと Google 版は地図が表示されません
  GOOGLE_MAPS_API_KEY: 'AIzaSyAFpPT5t7YU9WLD7FhTgqaVokdE8A5cu-w',

  /* Google Maps API の読み込みタイムアウト（ミリ秒）※Google版のみ参照
  * コールバックも onerror も発生しない状況（通信断・プロキシ遮断・無応答）で
  * 画面が "Loading…" のまま固まるのを防ぐ上限時間。経過後はエラー表示に切替。 */
  GOOGLE_MAPS_TIMEOUT_MS: 15000,

  /* Leaflet（CSS/JS）の読み込みタイムアウト（ミリ秒）※CARTO版のみ参照
   * map-carto.js が MapAdapter.init() 内で CDN から Leaflet を動的ロードする際の上限時間。
   * onload も onerror も発生しない状況（通信断・プロキシ遮断・無応答）で
   * 画面が "Loading…" のまま固まるのを防ぐ。経過後はエラー表示に切替。
   * 未定義の場合は 15000ms にフォールバックする。 */
  LEAFLET_TIMEOUT_MS: 15000,

  // 初期表示（中心・ズーム）※両プロバイダ共通
  INITIAL_CENTER: { lat: 34.6937, lng: 135.5023 },
  INITIAL_ZOOM: 14,

  /* =======================================================================
   * カテゴリの一本化（サイドパネルのカテゴリ＝「建築」1件だけにする）
   * -----------------------------------------------------------------------
   * true  … pois.json のエリア別カテゴリを無視し、全POIを下記1カテゴリに寄せる
   *         （ピンの色も COLOR で統一される）
   * false … pois.json のカテゴリ定義をそのまま使う（元の挙動）
   * ======================================================================= */
  SINGLE_CATEGORY: {
    ENABLED: false,
    ID: 'MC01000001',
    NAME: '建築',
    COLOR: '#F2A172'   // ← 建築の色。変えたい場合はこの1行だけ変更
  },

  /* =======================================================================
   * 画像パスの付け替え
   * -----------------------------------------------------------------------
   * pois.json の thumbnail_url は "/collab/upload/assets/images/event/xxx.jpg"
   * のようにドメイン直下からの絶対パスになっている。
   * GitHub Pages 等ではそのままだと 404 になるため、ファイル名だけを取り出して
   * IMAGE_BASE 配下を参照するよう app.js 側で自動変換する。
   *
   * 例）IMAGE_BASE:'images/event/' の場合
   *     /collab/upload/assets/images/event/EV01010001_01_s.jpg
   *       → images/event/EV01010001_01_s.jpg
   *
   * ※ REWRITE を false にすると pois.json の値をそのまま使う
   * ======================================================================= */
  IMAGE_REWRITE: false,
  IMAGE_BASE: 'images/event/'
};

/* URLの ?map= があれば優先（テスト用） */
(function () {
  try {
    var p = new URLSearchParams(window.location.search).get('map');
    if (p === 'google' || p === 'carto') {
      window.APP_CONFIG.MAP_PROVIDER = p;
    }
  } catch (e) {}
})();
