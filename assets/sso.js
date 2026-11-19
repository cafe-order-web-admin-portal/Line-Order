/* เข้าระบบอัตโนมัติจากหลังร้าน (CMS: centralized-store-management-system)
 * หลังร้านเปิดลิงก์ ...#sso=<token_hash> (ใช้ครั้งเดียว อายุสั้น) → ยืนยันกับ Supabase Auth → โหลดหน้าใหม่พร้อมเข้าระบบแล้ว
 * ผู้ใช้ / Role / สาขา ซิงก์จาก User Management ของหลังร้านอัตโนมัติ (public.staff.cms_ref)
 * ถ้าลิงก์มีปัญหา หลังร้านส่ง #sso_error=<ข้อความ> มาแสดงแทน */
(function () {
  var h = location.hash || '', m = /[#&]sso=([^&]+)/.exec(h), er = /[#&]sso_error=([^&]+)/.exec(h);
  var clean = function () { history.replaceState(null, '', location.pathname + location.search); };
  var note = function (msg, bad) {
    var show = function () {
      var d = document.getElementById('sso-note') || document.createElement('div');
      d.id = 'sso-note';
      d.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99999;max-width:92vw;padding:12px 18px;border-radius:12px;font:600 14px "IBM Plex Sans Thai",sans-serif;box-shadow:0 8px 24px #0002;background:' + (bad ? '#fde8e4;color:#9b2c1c' : '#e3f1e8;color:#16784a');
      d.textContent = msg;
      if (!d.parentNode) document.body.appendChild(d);
      if (bad) setTimeout(function () { d.remove(); }, 9000);
    };
    document.body ? show() : document.addEventListener('DOMContentLoaded', show);
  };
  if (er) { clean(); note('เข้าระบบจากหลังร้านไม่สำเร็จ: ' + decodeURIComponent(er[1]), true); return; }
  if (!m) return;
  var tokenHash = decodeURIComponent(m[1]); clean();
  var cfg = window.CAFE_AMAZON_SUPABASE_CONFIG || {};
  if (!window.supabase || !cfg.url) return;
  window.CAFE_SSO_PENDING = true;
  var st = document.createElement('style'); st.id = 'sso-hide'; st.textContent = 'body>*:not(#sso-note){visibility:hidden}';
  document.head.appendChild(st);
  note('กำลังเข้าระบบด้วยบัญชีหลังร้าน…');
  var db = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  db.auth.signOut({ scope: 'local' }).catch(function () {}).then(function () {
    return db.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  }).then(function (r) {
    if (r.error) throw r.error;
    // One-time, tab-scoped proof that this session came through the CMS SSO handoff.
    try { sessionStorage.setItem('ca_cms_sso_verified_at', JSON.stringify({at:Date.now(),path:location.pathname})); } catch (_) {}
    location.reload();
  }).catch(function (e) {
    st.remove(); window.CAFE_SSO_PENDING = false;
    note('เข้าระบบจากหลังร้านไม่สำเร็จ: ' + (e && e.message || e) + ' — กดเปิดจากเมนูหลังร้านอีกครั้ง', true);
  });
})();
