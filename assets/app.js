/* Café Amazon Web Admin Portal
   Client-side uses Supabase publishable key only.
   Authorization is enforced by PostgreSQL grants + RLS, not by UI hiding. */
(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => Number(v || 0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const boolVal = v => ['true','1','yes','y','ใช่','เปิด','available'].includes(String(v ?? '').trim().toLowerCase());
  const parseBool = (v, fallback=false) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return fallback;
    if (['true','1','yes','y','ใช่','เปิด','available'].includes(s)) return true;
    if (['false','0','no','n','ไม่','ปิด','unavailable'].includes(s)) return false;
    return fallback;
  };
  const toast = msg => {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('on');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove('on'), 3300);
  };
  const state = {
    db:null, session:null, user:null, staff:null, branches:[], categories:[],
    products:[], branchProducts:[], history:[], customers:[], chatMessages:[], selectedChatUserId:'', optionGroups:[], options:[], optionGroupProducts:[], productOptionLinks:[], branchId:'', page:(['dashboard','products','categories','options','import','history','customers','payment-overview','payment-transactions','payment-settings'].includes(location.hash.slice(1))?location.hash.slice(1):'dashboard'), selectedOptionProduct:'', customerSearch:'',
    search:'', categoryFilter:'', importRows:[], importFileName:'', importErrors:[],
    busy:false, paymentRows:[], paymentSettings:null, paymentLoadedBranch:'', paymentSettingsBranch:'', paymentLoadError:'', paymentStatusFilter:'all', paymentSearch:'', paymentLoading:false, paymentExpandedRows:new Set()
  };
  const isSuper = () => state.staff?.role === 'super_admin';
  const isManager = () => state.staff?.role === 'manager';
  const activeBranch = () => state.branches.find(b => b.id === state.branchId);
  const branchProductMap = () => new Map(state.branchProducts.map(x => [x.product_id,x]));
  const categoryName = id => state.categories.find(c => c.id === id)?.category_name || '-';
  const cfg = () => window.CAFE_AMAZON_SUPABASE_CONFIG || {};

  function renderLogin(message='') {
    $('#app').innerHTML = `
      <main class="login-wrap"><section class="login-card">
        <div class="brand"><div class="brand-mark sm">A</div><div><h1>Café Amazon</h1><p>Web Admin Portal · Product & Data Management</p></div></div>
        <h2>เข้าสู่ระบบจัดการร้าน</h2><p class="sub">สำหรับผู้ดูแลระบบและผู้จัดการสาขา</p>
        <div class="field"><label>อีเมล</label><input id="login-email" type="email" autocomplete="username" placeholder="name@example.com"></div>
        <div class="field"><label>รหัสผ่าน</label><input id="login-password" type="password" autocomplete="current-password" placeholder="รหัสผ่าน Supabase Auth"></div>
        <p class="err" id="login-error">${esc(message)}</p>
        <button class="btn primary block" id="login-btn">เข้าสู่ระบบ</button>
      </section></main>`;
    $('#login-btn').onclick = login;
    $('#login-password').onkeydown = e => { if(e.key==='Enter') login(); };
  }

  function initClient() {
    const c = cfg();
    if (!c.url || !c.publishableKey || !window.supabase?.createClient) return false;
    state.db = window.supabase.createClient(c.url,c.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    return true;
  }

  async function login() {
    const err = $('#login-error'), btn=$('#login-btn');
    if (!initClient()) return err.textContent='ระบบยังไม่ได้ตั้งค่าการเชื่อมต่อ กรุณาติดต่อผู้ดูแลระบบ';
    const email=$('#login-email').value.trim(), password=$('#login-password').value;
    if(!email || !password) return err.textContent='กรุณากรอกอีเมลและรหัสผ่าน';
    btn.disabled=true; btn.textContent='กำลังเข้าสู่ระบบ…'; err.textContent='';
    try {
      const {data,error}=await state.db.auth.signInWithPassword({email,password});
      if(error) throw error;
      state.session=data.session; state.user=data.user;
      await loadStaffAndData();
      renderApp();
    } catch(e) {
      await state.db.auth.signOut().catch(()=>{});
      err.textContent=e.message || 'เข้าสู่ระบบไม่สำเร็จ';
    } finally { btn.disabled=false; btn.textContent='เข้าสู่ระบบ'; }
  }

  async function loadStaffAndData() {
    const {data:staff,error:staffErr}=await state.db.from('staff')
      .select('id,auth_user_id,branch_id,staff_name,role,is_active')
      .eq('auth_user_id',state.user.id).eq('is_active',true).maybeSingle();
    if(staffErr) throw new Error('อ่านข้อมูล Staff ไม่สำเร็จ: '+staffErr.message);
    if(!staff) throw new Error('บัญชีนี้ยังไม่ได้ผูกกับ public.staff หรือถูกปิดใช้งาน กรุณาให้ Super Admin ผูกบัญชี');
    if(!['super_admin','manager','staff'].includes(staff.role)) throw new Error('Role นี้ยังไม่ได้รับอนุญาตให้ใช้ Web Admin Portal');
    state.staff=staff;
    await reloadData();
  }

  async function reloadData() {
    const [br,cat,prod,bp,hist,og,op,ogp,pol,cust,chat]=await Promise.all([
      state.db.from('branches').select('id,branch_code,branch_name,is_active').eq('is_active',true).order('branch_code'),
      state.db.from('categories').select('id,category_name,sort_order,is_active').order('sort_order'),
      state.db.from('products').select('id,category_id,product_code,product_name,description,image_url,is_active,is_featured,display_order,created_at').order('display_order').order('product_name'),
      state.db.from('branch_products').select('id,branch_id,product_id,price,is_available'),
      (state.staff?.role === 'super_admin' || state.staff?.role === 'manager')
        ? state.db.from('import_history').select('id,branch_id,import_type,file_name,total_rows,success_rows,failed_rows,status,details,created_at,created_by').order('created_at',{ascending:false}).limit(100)
        : Promise.resolve({data:[],error:null}),
      state.db.from('product_option_groups').select('id,group_code,group_name,selection_type,is_active,sort_order').order('sort_order'),
      state.db.from('product_options').select('id,group_id,option_code,option_name,price_delta,is_active,sort_order').order('sort_order'),
      state.db.from('product_option_group_products').select('product_id,group_id,is_required,min_select,max_select,sort_order'),
      state.db.from('product_option_product_options').select('product_id,option_id,sort_order'),
      state.db.from('customers').select('id,line_user_id,customer_name,phone,created_at').order('created_at',{ascending:false}).limit(500),
      state.db.from('line_chat_messages').select('id,branch_id,line_user_id,direction,event_type,message_type,message_text,event_timestamp,created_at').order('created_at',{ascending:false}).limit(1000)
    ]);
    for (const [label,r] of [['สาขา',br],['หมวดหมู่',cat],['สินค้า',prod],['ราคาสาขา',bp],['ประวัติ Import',hist],['กลุ่มตัวเลือก',og],['ตัวเลือก',op],['ความสัมพันธ์กลุ่ม',ogp],['ความสัมพันธ์ตัวเลือก',pol],['ลูกค้า',cust],['ประวัติแชท',chat]]) {
      if(r.error) throw new Error(`โหลด${label}ไม่สำเร็จ: ${r.error.message}`);
    }
    state.branches=br.data||[]; state.categories=cat.data||[]; state.products=prod.data||[];
    state.branchProducts=bp.data||[]; state.history=hist.data||[];
    state.optionGroups=og.data||[]; state.options=op.data||[];
    state.optionGroupProducts=ogp.data||[]; state.productOptionLinks=pol.data||[]; state.customers=cust.data||[]; state.chatMessages=chat.data||[];
    if(isSuper()) {
      if(!state.branchId || !state.branches.some(b=>b.id===state.branchId)) state.branchId=state.branches[0]?.id||'';
    } else {
      if(!state.staff.branch_id || !state.branches.some(b=>b.id===state.staff.branch_id)) throw new Error('ไม่พบสาขาที่ผูกกับบัญชี Staff');
      state.branchId=state.staff.branch_id;
    }
  }

  function navButton(key,label,ico) {
    return `<button data-page="${key}" class="${state.page===key?'active':''}"><span class="ico">${ico}</span>${label}</button>`;
  }
  function mobileIcon(name) {
    const paths = {
      home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
      products:'<path d="M7 3h10l-1 4H8L7 3Z"/><path d="M6 7h12l2 14H4L6 7Z"/><path d="M9 11h6"/>',
      orders:'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2l2.2 12.2a2 2 0 0 0 2 1.6h9a2 2 0 0 0 1.9-1.4L22 8H6"/>',
      upload:'<path d="M12 16V3m-5 5 5-5 5 5"/><path d="M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
      more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      categories:'<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
      options:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
      history:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      customers:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1.5A5.5 5.5 0 0 1 8.5 13h1A5.5 5.5 0 0 1 15 18.5V20"/><path d="M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4.5V20"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.more}</svg>`;
  }
  function mobileNavButton(key,label,ico) {
    return `<button type="button" data-page="${key}" class="${state.page===key?'active':''}" ${state.page===key?'aria-current="page"':''}>${mobileIcon(ico)}<span>${label}</span></button>`;
  }
  function renderApp() {
    const who=state.staff?.staff_name||state.user?.email||'';
    const roleLabel={super_admin:'Super Admin',manager:'Manager',staff:'Staff'}[state.staff?.role]||state.staff?.role;
    const morePages = [];
    if(isSuper()) morePages.push(['categories','หมวดหมู่','categories'],['options','ตัวเลือกสินค้า','options']);
    if(state.staff?.role !== 'staff') morePages.push(['history','ประวัติ Import','history'],['customers','ข้อมูลลูกค้า','customers'],['payment-overview','QR Payment Overview','history'],['payment-transactions','Payment Transactions','history'],['payment-settings','Payment Settings','options']);
    const moreActive = ['categories','options','history','customers','payment-overview','payment-transactions','payment-settings'].includes(state.page);
    const mobileMore = morePages.length
      ? morePages.map(([key,label,ico])=>`<button type="button" data-page="${key}">${mobileIcon(ico)}<span>${label}</span></button>`).join('')
      : '<div class="mobile-more-empty">ไม่มีเมนูเพิ่มเติมสำหรับบัญชีนี้</div>';
    $('#app').innerHTML=`
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand"><div class="brand-mark sm">A</div><div><h1>Café Amazon</h1><p>Web Admin Portal</p></div></div>
          <nav class="nav">
            ${state.staff?.role !== 'super_admin' ? '<a href="./orders.html" class="nav-link-live" aria-label="เปิดหน้าจัดการออเดอร์"><span class="ico">🛒</span><span class="nav-link-copy"><strong>จัดการออเดอร์</strong><small>LIVE ORDERS</small></span><span class="nav-live-pill">LIVE</span></a>' : ''}
            ${navButton('dashboard','ภาพรวม','▦')}
            ${navButton('products','จัดการสินค้า','☕')}
            ${isSuper()?navButton('categories','หมวดหมู่','▤'):''}
            ${isSuper()?navButton('options','ตัวเลือกสินค้า','☷'):''}
            ${state.staff?.role !== 'staff' ? '<div class="side-label">OPERATIONS</div>' : ''}
            ${state.staff?.role !== 'staff' ? navButton('import','Import ข้อมูล','⇧') : ''}
            ${state.staff?.role !== 'staff' ? navButton('history','ประวัติ Import','◷') : ''}
            ${state.staff?.role !== 'staff' ? navButton('customers','ข้อมูลลูกค้า','♙') : ''}
            ${state.staff?.role !== 'staff' ? '<div class="side-label">PAYMENT OPERATIONS</div><div class="payment-nav-tree"><button type="button" class="payment-nav-toggle" id="payment-nav-toggle" aria-expanded="true"><span class="ico">▣</span><span>QR Payment Transactions</span><span class="payment-nav-caret">⌄</span></button><div class="payment-nav-sub"><button data-page="payment-overview">Dashboard Overview</button><button data-page="payment-transactions">Transactions</button><button data-page="payment-settings">Payment Settings</button></div></div>' : ''}
          </nav>
          <div class="side-foot">☕ &nbsp; ${esc(activeBranch()?.branch_name||'Café Amazon')}<br><span class="side-foot-meta">Store Management · Supabase</span></div>
        </aside>
        <main class="main">
          <header class="topbar">
            <div class="top-left"><div><div class="top-title">${esc(pageTitle())}</div><div class="top-sub">${esc(activeBranch()?.branch_name||'เลือกสาขา')}</div></div></div>
            <div class="top-actions">
              ${isSuper()?'<select id="branch-select" class="select-small">'+state.branches.map(b=>'<option value="'+b.id+'" '+(b.id===state.branchId?'selected':'')+'>'+esc(b.branch_code)+' · '+esc(b.branch_name)+'</option>').join('')+'</select>':''}
              <div class="user-chip"><b>${esc(who)}</b><br>${esc(roleLabel)}</div>
              <button class="btn" id="refresh-btn">↻</button>
              <button class="btn" id="logout-btn">ออกจากระบบ</button>
            </div>
          </header>
          <section class="content" id="page-content">${renderPage()}</section>
        </main>
      </div>
      <div class="mobile-more-menu" id="mobile-more-menu" hidden>${mobileMore}</div>
      <nav class="mobile-bottom-nav portal-mobile-nav" aria-label="เมนูหลัก">
        ${mobileNavButton('dashboard','หน้าหลัก','home')}
        ${mobileNavButton('products','สินค้า','products')}
        ${state.staff?.role !== 'super_admin' ? `<a class="nav-live" href="./orders.html" aria-label="LIVE ORDERS">${mobileIcon('orders')}<span>ออเดอร์</span></a>` : ''}
        ${state.staff?.role !== 'staff' ? mobileNavButton('import','Import','upload') : ''}
        <button type="button" id="mobile-more-toggle" class="${moreActive?'active':''}" aria-expanded="false">${mobileIcon('more')}<span>เพิ่มเติม</span></button>
      </nav>`;
    document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{
      state.page=b.dataset.page;
      history.replaceState(null,'',location.pathname+location.search+'#'+state.page);
      renderApp();
    });
    const moreToggle=$('#mobile-more-toggle'), moreMenu=$('#mobile-more-menu');
    if(moreToggle&&moreMenu) moreToggle.onclick=()=>{
      const open=moreMenu.hidden;
      moreMenu.hidden=!open;
      moreToggle.setAttribute('aria-expanded',String(open));
    };
    if($('#branch-select')) $('#branch-select').onchange=e=>{state.branchId=e.target.value;renderApp();};
    $('#logout-btn').onclick=logout;
    $('#refresh-btn').onclick=async()=>{try{await reloadData();renderApp();toast('โหลดข้อมูลล่าสุดแล้ว')}catch(e){toast(e.message)}};
    bindPageEvents();
  }
  function pageTitle(){return ({dashboard:'ภาพรวม',products:'จัดการสินค้า',categories:'จัดการหมวดหมู่',options:'ตัวเลือกสินค้า',import:'นำเข้าข้อมูล',history:'ประวัติการนำเข้า',customers:'ข้อมูลลูกค้า LINE','payment-overview':'QR Payment Overview','payment-transactions':'QR Payment Transactions','payment-settings':'QR Payment Settings'})[state.page]||'Web Admin Portal';}
  function renderPage(){
    if(state.page==='dashboard') return viewDashboard();
    if(state.page==='products') return viewProducts();
    if(state.page==='categories') return viewCategories();
    if(state.page==='options') return isSuper()?viewOptions():'<div class="alert">ไม่มีสิทธิ์จัดการตัวเลือกสินค้า</div>';
    if(state.page==='import') return (state.staff?.role!=='staff')?viewImport():'<div class="alert">ไม่มีสิทธิ์นำเข้าข้อมูล</div>'; 
    if(state.page==='history') return (state.staff?.role!=='staff')?viewHistory():'<div class="alert">ไม่มีสิทธิ์ดูประวัติ Import</div>';
    if(state.page==='customers') return (state.staff?.role!=='staff')?viewCustomers():'<div class="alert">ไม่มีสิทธิ์ดูข้อมูลลูกค้า</div>';
    if(state.page==='payment-overview') return (state.staff?.role!=='staff')?viewPaymentOverview():'<div class="alert">ไม่มีสิทธิ์เข้าถึงข้อมูลการชำระเงิน</div>';
    if(state.page==='payment-transactions') return (state.staff?.role!=='staff')?viewPaymentTransactions():'<div class="alert">ไม่มีสิทธิ์เข้าถึงข้อมูลการชำระเงิน</div>';
    if(state.page==='payment-settings') return (state.staff?.role!=='staff')?viewPaymentSettings():'<div class="alert">ไม่มีสิทธิ์เข้าถึงข้อมูลการชำระเงิน</div>';
    return '';
  }

  function branchRows() {
    const ids=state.branchId;
    const map=branchProductMap();
    return state.products.map(p=>({p,bp:map.get(p.id)||null})).filter(x=>!ids || (x.bp && x.bp.branch_id===ids));
  }
  function viewDashboard(){
    const rows=branchRows(), active=rows.filter(x=>x.p.is_active&&x.bp?.is_available&&Number(x.bp.price)>0).length;
    const draft=rows.length-active, missingPrice=rows.filter(x=>!x.bp||Number(x.bp.price)<=0).length;
    const unavailable=rows.filter(x=>!x.bp||!x.bp.is_available).length;
    return `<div class="page-head"><div><h2>ภาพรวมข้อมูลสินค้า</h2><p>สถานะ Catalog และราคาของสาขาที่เลือก</p></div><div class="actions"><button class="btn" data-download-template="full">ดาวน์โหลด Template</button></div></div>
      <div class="kpis">
        <div class="kpi"><div class="label">สินค้าทั้งหมด</div><div class="value">${rows.length}</div><div class="hint">ใน Catalog ของสาขา</div></div>
        <div class="kpi"><div class="label">พร้อมจำหน่าย</div><div class="value">${active}</div><div class="hint">เปิดสินค้า + เปิดขาย + มีราคา</div></div>
        <div class="kpi"><div class="label">ยังไม่มีราคา</div><div class="value">${missingPrice}</div><div class="hint">ต้องเติมราคาก่อนเปิดขาย</div></div>
        <div class="kpi"><div class="label">ปิดจำหน่าย</div><div class="value">${unavailable}</div><div class="hint">ยังไม่เปิดขายที่สาขานี้</div></div>
      </div>
      <div class="panel"><div class="panel-title"><h3>สถานะความพร้อม</h3><span class="pill">${esc(activeBranch()?.branch_code||'')}</span></div>
        <div class="alert info">สินค้าเริ่มต้น 40 รายการถูกนำเข้าเป็น Draft ราคา 0 บาท และปิดการขายไว้ เพื่อรอตรวจสอบข้อมูลจริงของสาขาก่อนเปิดให้ลูกค้าสั่ง</div>
        <div class="actions" style="margin-top:14px">${state.staff?.role!=='staff'?'<button class="btn primary" data-goto="import">นำเข้าสินค้า / ราคา</button>':''}<button class="btn" data-goto="products">จัดการสินค้า</button></div>
      </div>
      <div class="panel"><div class="panel-title"><h3>รายการที่ต้องตรวจสอบ</h3><span class="muted small">${rows.length} รายการ</span></div>
        ${rows.length?`<div class="table-wrap"><table><thead><tr><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th>ราคา</th><th>สถานะสินค้า</th><th>สถานะสาขา</th></tr></thead><tbody>${rows.slice(0,12).map(({p,bp})=>`<tr><td>${esc(p.product_code)}</td><td>${esc(p.product_name)}</td><td class="money">${bp?money(bp.price):'—'}</td><td>${p.is_active?'<span class="badge ok">Active</span>':'<span class="badge warn">Draft</span>'}</td><td>${bp?.is_available?'<span class="badge ok">เปิดขาย</span>':'<span class="badge bad">ปิดขาย</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">ยังไม่มีรายการสินค้าของสาขานี้</div>'}
      </div>`;
  }

  function viewProducts(){
    const rows=branchRows().filter(({p})=>{
      const q=state.search.toLowerCase();
      return (!q || [p.product_code,p.product_name].some(x=>String(x||'').toLowerCase().includes(q)))
        && (!state.categoryFilter || p.category_id===state.categoryFilter);
    });
    return `<div class="page-head"><div><h2>จัดการสินค้า</h2><p>สินค้า ราคา และสถานะจำหน่ายตามสาขา</p></div>${isSuper()?'<button class="btn primary" data-add-product>＋ เพิ่มสินค้า</button>':''}</div>
      <div class="panel"><div class="toolbar"><input id="product-search" class="search" placeholder="ค้นหารหัสหรือชื่อสินค้า…" value="${esc(state.search)}">
      <select id="category-filter" class="select-small"><option value="">ทุกหมวดหมู่</option>${state.categories.map(c=>`<option value="${c.id}" ${state.categoryFilter===c.id?'selected':''}>${esc(c.category_name)}</option>`).join('')}</select>
      <span class="muted small">${rows.length} รายการ</span></div></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>สินค้า</th><th>หมวดหมู่</th><th>ราคา</th><th>Product</th><th>สาขา</th><th>การจัดการ</th></tr></thead><tbody>
      ${rows.map(({p,bp})=>`<tr>
        <td><div class="product-cell">${p.image_url?`<img class="thumb" src="${esc(p.image_url)}" alt="">`:`<span class="thumb empty">☕</span>`}<span><b>${esc(p.product_name)}</b><br><span class="muted small">${esc(p.product_code)}</span></span></div></td>
        <td>${esc(categoryName(p.category_id))}</td>
        <td class="money">${bp?money(bp.price):'—'}</td>
        <td>${p.is_active?'<span class="badge ok">Active</span>':'<span class="badge warn">Draft</span>'}</td>
        <td>${bp?.is_available?'<span class="badge ok">เปิดขาย</span>':'<span class="badge bad">ปิดขาย</span>'}</td>
        <td><div class="actions">${isSuper()?`<button class="btn" data-edit-product="${p.id}">แก้สินค้า</button><button class="btn ${p.is_active?'danger':'primary'}" data-toggle-product="${p.id}" data-next-active="${p.is_active?'false':'true'}">${p.is_active?'ซ่อนจากเมนู':'เปิดใช้เมนู'}</button>`:''}${state.staff?.role!=='staff'?`<button class="btn" data-edit-price="${p.id}">ราคา / เปิดขาย</button>`:''}</div></td>
      </tr>`).join('')||'<tr><td colspan="6"><div class="empty-state">ไม่พบสินค้า</div></td></tr>'}
      </tbody></table></div></div>`;
  }

  function viewCategories(){
    if(!isSuper()) return `<div class="alert">ไม่มีสิทธิ์จัดการหมวดหมู่</div>`;
    return `<div class="page-head"><div><h2>จัดการหมวดหมู่</h2><p>สร้างและแก้ไขหมวดหมู่สินค้า</p></div><button class="btn primary" data-add-category>＋ เพิ่มหมวดหมู่</button></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>ลำดับ</th><th>หมวดหมู่</th><th>สถานะ</th><th></th></tr></thead><tbody>
      ${state.categories.map(c=>`<tr><td>${c.sort_order}</td><td><b>${esc(c.category_name)}</b></td><td>${c.is_active?'<span class="badge ok">Active</span>':'<span class="badge warn">Inactive</span>'}</td><td><button class="btn" data-edit-category="${c.id}">แก้ไข</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  function viewOptions(){
    const productId=state.selectedOptionProduct||state.products[0]?.id||'';
    const groups=state.optionGroups;
    const links=state.optionGroupProducts.filter(x=>x.product_id===productId);
    const optionLinks=state.productOptionLinks.filter(x=>x.product_id===productId);
    return `<div class="page-head"><div><h2>ตัวเลือกสินค้า</h2><p>จัดการกลุ่มตัวเลือกและกำหนดว่าแต่ละเมนูใช้ตัวเลือกใด</p></div><button class="btn primary" data-add-group>＋ เพิ่มกลุ่มตัวเลือก</button></div>
      <div class="panel"><div class="panel-title"><h3>กลุ่มตัวเลือก</h3><span class="muted small">${groups.length} กลุ่ม</span></div>
      ${groups.map(g=>{const opts=state.options.filter(o=>o.group_id===g.id);return `<div class="option-card"><div class="panel-title"><div><h4>${esc(g.group_name)} <span class="muted small">${esc(g.group_code)}</span></h4><span class="badge ${g.is_active?'ok':'warn'}">${g.is_active?'Active':'Inactive'}</span> <span class="badge">${g.selection_type==='multiple'?'เลือกได้หลายรายการ':'เลือกได้ 1 รายการ'}</span></div><div class="actions"><button class="btn" data-add-option="${g.id}">＋ เพิ่มตัวเลือก</button><button class="btn" data-edit-group="${g.id}">แก้กลุ่ม</button></div></div>
      <div>${opts.map(o=>`<span class="option-chip">${esc(o.option_name)} · ${money(o.price_delta)} บาท ${o.is_active?'':'(ปิด)'} <button class="linkbtn" data-group="${g.id}" data-edit-option="${o.id}" style="border:0;background:none;color:var(--green);font-weight:700">แก้</button></span>`).join('')||'<span class="muted small">ยังไม่มีตัวเลือก</span>'}</div></div>`;}).join('')}
      </div>
      <div class="panel"><div class="panel-title"><h3>กำหนดตัวเลือกให้สินค้า</h3></div>
        <div class="field"><label>เลือกสินค้า</label><select id="option-product-select">${state.products.map(p=>`<option value="${p.id}" ${p.id===productId?'selected':''}>${esc(p.product_code)} · ${esc(p.product_name)}</option>`).join('')}</select></div>
        ${productId?groups.map(g=>{const assigned=links.find(x=>x.group_id===g.id);const assignedIds=optionLinks.filter(x=>state.options.find(o=>o.id===x.option_id)?.group_id===g.id).map(x=>x.option_id);const ops=state.options.filter(o=>o.group_id===g.id&&o.is_active);return `<div class="option-card"><label class="checkline"><input type="checkbox" data-map-group="${g.id}" ${assigned?'checked':''}> <b>${esc(g.group_name)}</b></label>
        <div class="small muted">${g.selection_type==='multiple'?'เลือกได้หลายรายการ':'เลือกได้ 1 รายการ'} · ${assigned?.is_required?'บังคับเลือก':'ไม่บังคับ'}</div>
        <div class="form-grid" style="margin-top:8px">${ops.map(o=>`<label class="checkline"><input type="checkbox" data-map-option="${g.id}" value="${o.id}" ${assignedIds.includes(o.id)?'checked':''}> ${esc(o.option_name)} ${Number(o.price_delta)>0?'(+'+money(o.price_delta)+' บาท)':''}</label>`).join('')||'<span class="muted small">กลุ่มนี้ยังไม่มีตัวเลือก Active</span>'}</div>
        ${assigned?`<label class="checkline"><input type="checkbox" data-map-required="${g.id}" ${assigned.is_required?'checked':''}> บังคับให้ลูกค้าเลือก</label>`:''}</div>`;}).join(''):'<div class="empty-state">ยังไม่มีสินค้า</div>'}
        <div class="modal-foot"><button class="btn primary" id="save-option-mapping" ${productId?'':'disabled'}>บันทึกตัวเลือกของสินค้านี้</button></div>
      </div>`;
  }

  function openOptionGroup(groupId){
    if(!isSuper())return;
    const g=state.optionGroups.find(x=>x.id===groupId)||{group_code:'',group_name:'',selection_type:'single',is_active:true,sort_order:state.optionGroups.length+1};
    const sh=modal(`<div class="modal-head"><h3>${groupId?'แก้ไขกลุ่มตัวเลือก':'เพิ่มกลุ่มตัวเลือก'}</h3><button class="btn" data-close>ปิด</button></div>
      <div class="field"><label>Group Code</label><input id="og-code" value="${esc(g.group_code)}" ${groupId?'disabled':''}></div>
      <div class="field"><label>ชื่อกลุ่ม</label><input id="og-name" value="${esc(g.group_name)}"></div>
      <div class="field"><label>รูปแบบการเลือก</label><select id="og-type"><option value="single" ${g.selection_type==='single'?'selected':''}>เลือกได้ 1 รายการ</option><option value="multiple" ${g.selection_type==='multiple'?'selected':''}>เลือกได้หลายรายการ</option></select></div>
      <div class="field"><label>ลำดับ</label><input id="og-order" type="number" value="${Number(g.sort_order||0)}"></div>
      <label class="checkline"><input id="og-active" type="checkbox" ${g.is_active?'checked':''}> เปิดใช้งาน</label>
      <div class="modal-foot"><button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="save-og">บันทึก</button></div>`);
    sh.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('.modal-bg').remove());
    $('#save-og',sh).onclick=async()=>{
      const code=$('#og-code',sh).value.trim().toUpperCase(),name=$('#og-name',sh).value.trim();if(!code||!name)return toast('กรุณากรอกรหัสและชื่อกลุ่ม');
      const row={group_code:code,group_name:name,selection_type:$('#og-type',sh).value,sort_order:Number($('#og-order',sh).value||0),is_active:$('#og-active',sh).checked};if(groupId)row.id=g.id;
      const {error}=await state.db.from('product_option_groups').upsert(row,{onConflict:'group_code'});if(error)return toast(error.message);
      $('.modal-bg').remove();await reloadData();renderApp();toast('บันทึกกลุ่มตัวเลือกแล้ว');
    };
  }

  function openOption(groupId, optionId){
    if(!isSuper())return;
    const g=state.optionGroups.find(x=>x.id===groupId);if(!g)return;
    const o=state.options.find(x=>x.id===optionId)||{option_code:'',option_name:'',price_delta:0,is_active:true,sort_order:state.options.filter(x=>x.group_id===groupId).length+1};
    const sh=modal(`<div class="modal-head"><h3>${optionId?'แก้ไขตัวเลือก':'เพิ่มตัวเลือก'} · ${esc(g.group_name)}</h3><button class="btn" data-close>ปิด</button></div>
      <div class="field"><label>Option Code</label><input id="opt-code" value="${esc(o.option_code)}" ${optionId?'disabled':''}></div>
      <div class="field"><label>ชื่อตัวเลือก</label><input id="opt-name" value="${esc(o.option_name)}"></div>
      <div class="form-grid"><div class="field"><label>ราคาเพิ่ม (บาท)</label><input id="opt-price" type="number" step="0.01" min="0" value="${Number(o.price_delta||0)}"></div><div class="field"><label>ลำดับ</label><input id="opt-order" type="number" value="${Number(o.sort_order||0)}"></div></div>
      <label class="checkline"><input id="opt-active" type="checkbox" ${o.is_active?'checked':''}> เปิดใช้งาน</label>
      <div class="modal-foot"><button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="save-opt">บันทึก</button></div>`);
    sh.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('.modal-bg').remove());
    $('#save-opt',sh).onclick=async()=>{
      const code=$('#opt-code',sh).value.trim().toUpperCase(),name=$('#opt-name',sh).value.trim(),price=Number($('#opt-price',sh).value);
      if(!code||!name||!Number.isFinite(price)||price<0)return toast('กรุณาตรวจรหัส ชื่อ และราคาเพิ่ม');
      const row={group_id:groupId,option_code:code,option_name:name,price_delta:price,sort_order:Number($('#opt-order',sh).value||0),is_active:$('#opt-active',sh).checked};if(optionId)row.id=o.id;
      const {error}=await state.db.from('product_options').upsert(row,{onConflict:'group_id,option_code'});if(error)return toast(error.message);
      $('.modal-bg').remove();await reloadData();renderApp();toast('บันทึกตัวเลือกแล้ว');
    };
  }

  async function saveOptionMapping(){
    if(!isSuper())return;
    const productId=state.selectedOptionProduct||$('#option-product-select')?.value;if(!productId)return;
    const btn=$('#save-option-mapping');btn.disabled=true;btn.textContent='กำลังบันทึก…';
    try{
      for(const g of state.optionGroups){
        const selectedGroup=$(`[data-map-group="${g.id}"]`)?.checked||false;
        const checkedOptions=[...document.querySelectorAll(`[data-map-option="${g.id}"]:checked`)].map(x=>x.value);
        const allGroupOptionIds=state.options.filter(o=>o.group_id===g.id).map(o=>o.id);
        if(selectedGroup){
          if(checkedOptions.length===0)throw new Error(`เลือกตัวเลือกอย่างน้อย 1 รายการในกลุ่ม ${g.group_name}`);
          const required=$(`[data-map-required="${g.id}"]`)?.checked ?? (g.group_code==='DRINK_TYPE');
          const max=g.selection_type==='single'?1:Math.max(1,checkedOptions.length);
          const {error:ge}=await state.db.from('product_option_group_products').upsert({product_id:productId,group_id:g.id,is_required:required,min_select:required?1:0,max_select:max,sort_order:g.sort_order},{onConflict:'product_id,group_id'});
          if(ge)throw ge;
          if(allGroupOptionIds.length){const {error:de}=await state.db.from('product_option_product_options').delete().eq('product_id',productId).in('option_id',allGroupOptionIds);if(de)throw de;}
          const payload=checkedOptions.map(id=>({product_id:productId,option_id:id,sort_order:state.options.find(o=>o.id===id)?.sort_order||0}));
          const {error:oe}=await state.db.from('product_option_product_options').insert(payload);if(oe)throw oe;
        }else{
          const {error:de}=await state.db.from('product_option_group_products').delete().eq('product_id',productId).eq('group_id',g.id);if(de)throw de;
          if(allGroupOptionIds.length){const {error:le}=await state.db.from('product_option_product_options').delete().eq('product_id',productId).in('option_id',allGroupOptionIds);if(le)throw le;}
        }
      }
      await reloadData();renderApp();toast('บันทึกตัวเลือกของสินค้าแล้ว');
    }catch(e){btn.disabled=false;btn.textContent='บันทึกตัวเลือกของสินค้านี้';toast(e.message);}
  }

  function viewImport(){
    const manager=isManager();
    return `<div class="page-head"><div><h2>นำเข้าข้อมูล (Import)</h2><p>${manager?'นำเข้าราคาและสถานะขายเฉพาะสาขาที่รับผิดชอบ':'นำเข้าสินค้า ราคา และสถานะจำหน่ายเป็นชุด'}</p></div><button class="btn" data-download-template="${manager?'price':'full'}">ดาวน์โหลด Excel Template</button></div>
      <div class="import-grid">
        <div class="panel">
          <div class="panel-title"><h3>1. เลือกไฟล์</h3></div>
          <div class="dropzone"><strong>ลากไฟล์ Excel หรือ CSV มาวาง</strong><p>รองรับ .xlsx, .xls และ .csv</p><input id="import-file" type="file" accept=".xlsx,.xls,.csv"><div class="help" id="selected-file">ยังไม่ได้เลือกไฟล์</div></div>
          <div class="alert info" style="margin-top:14px">${manager?'Manager แก้ได้เฉพาะราคาและสถานะขายของสาขาตัวเอง ไม่สามารถสร้างหรือแก้ข้อมูล Catalog กลาง':'Super Admin สามารถสร้าง/ปรับปรุง Product Catalog และราคาสาขาที่เลือกได้'}</div>
          <div class="actions" style="margin-top:14px"><button class="btn primary" id="preview-import">อ่านไฟล์และ Preview</button><button class="btn" id="clear-import">ล้างไฟล์</button></div>
        </div>
        <div class="panel">
          <div class="panel-title"><h3>2. ขั้นตอนก่อนบันทึก</h3></div>
          <div class="steps">
            <div class="step"><span class="step-no">1</span><div><b>ดาวน์โหลด Template</b><div class="muted small">ใช้หัวตารางตามไฟล์ตัวอย่าง</div></div></div>
            <div class="step"><span class="step-no">2</span><div><b>กรอกข้อมูลและราคา</b><div class="muted small">ไม่ใส่ราคาหากต้องการคงราคาเดิม</div></div></div>
            <div class="step"><span class="step-no">3</span><div><b>ตรวจสอบ Preview</b><div class="muted small">ระบบแจ้งแถวที่ผิดก่อนบันทึก</div></div></div>
            <div class="step"><span class="step-no">4</span><div><b>ยืนยัน Import</b><div class="muted small">ระบบบันทึกผลใน Import History</div></div></div>
          </div>
        </div>
      </div>
      <div id="import-preview"></div>`;
  }

  function viewHistory(){
    return `<div class="page-head"><div><h2>ประวัติ Import</h2><p>ประวัติการนำเข้าสินค้าและราคา</p></div></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>วันที่ / เวลา</th><th>ไฟล์</th><th>ประเภท</th><th>ทั้งหมด</th><th>สำเร็จ</th><th>ผิดพลาด</th><th>สถานะ</th></tr></thead><tbody>
      ${state.history.map(h=>`<tr><td>${new Date(h.created_at).toLocaleString('th-TH')}</td><td>${esc(h.file_name)}</td><td>${esc(h.import_type)}</td><td>${h.total_rows}</td><td>${h.success_rows}</td><td>${h.failed_rows}</td><td>${h.status==='completed'?'<span class="badge ok">สำเร็จ</span>':h.status==='partial'?'<span class="badge warn">บางส่วน</span>':'<span class="badge bad">ไม่สำเร็จ</span>'}</td></tr>`).join('')||'<tr><td colspan="7"><div class="empty-state">ยังไม่มีประวัติ</div></td></tr>'}
      </tbody></table></div></div>`;
  }

  function viewCustomers(){
    const q=String(state.customerSearch||'').trim().toLowerCase();
    const customers=state.customers.filter(c=>!q||[c.customer_name,c.line_user_id,c.phone].some(v=>String(v||'').toLowerCase().includes(q)));
    const visibleChats=state.chatMessages.filter(m=>!m.branch_id||m.branch_id===state.branchId);
    const conversations=new Map();
    visibleChats.forEach(m=>{
      const key=String(m.line_user_id||'');
      if(!key)return;
      if(!conversations.has(key))conversations.set(key,[]);
      conversations.get(key).push(m);
    });
    const conversationRows=[...conversations.entries()].map(([uid,items])=>{
      items.sort((a,b)=>new Date(a.created_at||a.event_timestamp||0)-new Date(b.created_at||b.event_timestamp||0));
      const customer=state.customers.find(c=>c.line_user_id===uid);
      return {uid,items,last:items[items.length-1],customer};
    }).sort((a,b)=>new Date(b.last?.created_at||0)-new Date(a.last?.created_at||0));
    const selected=conversationRows.find(x=>x.uid===state.selectedChatUserId);
    const fmtTime=value=>value?new Date(value).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}):'-';
    const messageLabel=m=>m.message_text||({image:'ส่งรูปภาพ',video:'ส่งวิดีโอ',audio:'ส่งเสียง',file:'ส่งไฟล์',sticker:'ส่งสติกเกอร์',follow:'เพิ่มเพื่อน',unfollow:'บล็อกบัญชี',unsend:'ยกเลิกการส่งข้อความ'}[m.message_type]||'กิจกรรม LINE');
    return `<div class="page-head"><div><h2>ข้อมูลลูกค้า LINE</h2><p>ข้อมูลลูกค้าและประวัติการสนทนาจาก LINE Official Account</p></div><span class="pill">${customers.length} รายชื่อ · ${conversationRows.length} บทสนทนา</span></div>
      <div class="panel"><div class="toolbar"><input id="customer-search" class="search" placeholder="ค้นหาชื่อ / LINE UID / เบอร์โทร…" value="${esc(state.customerSearch)}"><span class="muted small">ลูกค้าสูงสุด 500 ราย · ประวัติแชทล่าสุด 1,000 ข้อความ</span></div></div>
      <div class="panel"><div class="panel-title"><h3>ประวัติการสนทนา LINE</h3><span class="muted small">จัดเก็บข้อความใหม่จาก Webhook ตั้งแต่เปิดใช้งาน</span></div>
        <div class="table-wrap"><table><thead><tr><th>ลูกค้า</th><th>ข้อความล่าสุด</th><th>เวลา</th><th>จำนวนเหตุการณ์</th><th></th></tr></thead><tbody>
          ${conversationRows.filter(x=>!q||[x.customer?.customer_name,x.uid,x.last?.message_text].some(v=>String(v||'').toLowerCase().includes(q))).map(x=>`<tr><td><b>${esc(x.customer?.customer_name||'LINE Customer')}</b><br><code style="font-size:10px;word-break:break-all">${esc(x.uid)}</code></td><td>${esc(messageLabel(x.last))}</td><td>${fmtTime(x.last?.created_at||x.last?.event_timestamp)}</td><td>${x.items.length}</td><td><button class="btn" data-open-chat="${esc(x.uid)}">เปิดแชท</button></td></tr>`).join('')||'<tr><td colspan="5"><div class="empty-state">ยังไม่มีประวัติแชทใหม่ที่ได้รับจาก LINE Webhook</div></td></tr>'}
        </tbody></table></div>
      </div>
      ${selected?`<div class="panel"><div class="panel-title"><div><h3>บทสนทนา · ${esc(selected.customer?.customer_name||'LINE Customer')}</h3><code class="muted small">${esc(selected.uid)}</code></div><button class="btn" id="close-chat">ปิดบทสนทนา</button></div>
        <div style="display:flex;flex-direction:column;gap:10px;max-height:520px;overflow:auto;padding:8px;background:#f7f8f6;border-radius:12px">
          ${selected.items.map(m=>`<div style="display:flex;justify-content:${m.direction==='outbound'?'flex-end':'flex-start'}"><div style="max-width:82%;padding:10px 13px;border-radius:14px;background:${m.direction==='outbound'?'#e5f4e9':'#fff'};border:1px solid #e5e9e5;box-shadow:0 1px 3px #00000008"><div style="font-size:10px;color:#829087;margin-bottom:3px">${m.direction==='outbound'?'ร้าน':'ลูกค้า'} · ${esc(m.message_type||m.event_type||'message')}</div><div style="white-space:pre-wrap;word-break:break-word">${esc(messageLabel(m))}</div><div style="font-size:10px;color:#89928c;text-align:right;margin-top:4px">${fmtTime(m.event_timestamp||m.created_at)}</div></div></div>`).join('')}
        </div>
      </div>`:''}
      <div class="panel"><div class="panel-title"><h3>รายชื่อลูกค้า</h3><span class="muted small">${customers.length} รายชื่อ</span></div>
        <div class="table-wrap"><table><thead><tr><th>ลูกค้า</th><th>LINE User ID (UID)</th><th>เบอร์โทร</th><th>วันที่เพิ่ม</th></tr></thead><tbody>
          ${customers.map(c=>`<tr><td><b>${esc(c.customer_name||'LINE Customer')}</b></td><td><code style="font-size:11px;word-break:break-all">${esc(c.line_user_id||'-')}</code></td><td>${esc(c.phone||'-')}</td><td>${c.created_at?new Date(c.created_at).toLocaleString('th-TH'):'-'}</td></tr>`).join('')||'<tr><td colspan="4"><div class="empty-state">ยังไม่มีข้อมูลลูกค้า หรือยังไม่มี Order ในสาขานี้</div></td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  function bindPageEvents(){
    if($('#customer-search')) $('#customer-search').oninput=e=>{state.customerSearch=e.target.value;const pos=e.target.selectionStart;renderApp();const n=$('#customer-search');n.focus();n.setSelectionRange(pos,pos);};
    document.querySelectorAll('[data-open-chat]').forEach(b=>b.onclick=()=>{state.selectedChatUserId=b.dataset.openChat;renderApp();});
    if($('#close-chat')) $('#close-chat').onclick=()=>{state.selectedChatUserId='';renderApp();};
    document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>{state.page=b.dataset.goto;history.replaceState(null,'',location.pathname+location.search+'#'+state.page);renderApp();});
    if($('#product-search')) $('#product-search').oninput=e=>{state.search=e.target.value;const pos=e.target.selectionStart;renderApp();const n=$('#product-search');n.focus();n.setSelectionRange(pos,pos);};
    if($('#category-filter')) $('#category-filter').onchange=e=>{state.categoryFilter=e.target.value;renderApp();};
    document.querySelectorAll('[data-edit-price]').forEach(b=>b.onclick=()=>openPrice(b.dataset.editPrice));
    document.querySelectorAll('[data-edit-product]').forEach(b=>b.onclick=()=>openProduct(b.dataset.editProduct));
    document.querySelectorAll('[data-toggle-product]').forEach(b=>b.onclick=()=>setProductMenuState(b.dataset.toggleProduct,b.dataset.nextActive==='true'));
    if($('[data-add-product]')) $('[data-add-product]').onclick=()=>openProduct();
    if($('[data-add-category]')) $('[data-add-category]').onclick=()=>openCategory();
    if($('[data-add-group]')) $('[data-add-group]').onclick=()=>openOptionGroup();
    document.querySelectorAll('[data-edit-group]').forEach(b=>b.onclick=()=>openOptionGroup(b.dataset.editGroup));
    document.querySelectorAll('[data-add-option]').forEach(b=>b.onclick=()=>openOption(b.dataset.addOption));
    document.querySelectorAll('[data-edit-option]').forEach(b=>b.onclick=()=>openOption(b.dataset.group,b.dataset.editOption));
    if($('#option-product-select')) $('#option-product-select').onchange=e=>{state.selectedOptionProduct=e.target.value;renderApp();};
    if($('#save-option-mapping')) $('#save-option-mapping').onclick=saveOptionMapping;
    document.querySelectorAll('[data-edit-category]').forEach(b=>b.onclick=()=>openCategory(b.dataset.editCategory));
    document.querySelectorAll('[data-download-template]').forEach(b=>b.onclick=()=>downloadTemplate(b.dataset.downloadTemplate));
    if($('#preview-import')) $('#preview-import').onclick=previewImport;
    if($('#clear-import')) $('#clear-import').onclick=()=>{state.importRows=[];state.importFileName='';state.importErrors=[];renderApp();};
    const dz=$('.dropzone'), fi=$('#import-file');
    if(dz&&fi){
      fi.onchange=()=>{const lab=$('#selected-file');if(lab)lab.textContent=fi.files[0]?.name||'ยังไม่ได้เลือกไฟล์';};
      dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag');});
      dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
      dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');const f=e.dataTransfer.files?.[0];if(!f)return;const dt=new DataTransfer();dt.items.add(f);fi.files=dt.files;const lab=$('#selected-file');if(lab)lab.textContent=f.name;});
    }
  }


  const PAYMENT_API_URL = 'https://ytxbnqosenolojifeikf.supabase.co/functions/v1/payment-portal';
  const PAYMENT_QR_URL = 'https://cafe-order-web-admin-portal.github.io/Line-Order/assets/promptpay-qr.png';
  const paymentPageKeys = ['payment-overview','payment-transactions','payment-settings'];
  const paymentStatusLabel = {awaiting_payment:'รอชำระเงิน',submitted:'รอตรวจสอบ',matched:'ยืนยันรับเงินแล้ว',rejected:'ไม่ผ่านการตรวจสอบ',needs_review:'ต้องตรวจสอบเพิ่มเติม',expired:'หมดเวลาชำระ'};
  const paymentStatusBadge = status => '<span class="badge '+(status==='matched'?'ok':(['submitted','needs_review','awaiting_payment'].includes(status)?'warn':'bad'))+'">'+esc(paymentStatusLabel[status]||status||'-')+'</span>';
  const paymentSourceLabel = source => source==='line_oa'?'LINE OA':source==='web_upload'?'เว็บไซต์':'ยังไม่ส่งสลิป';
  const paymentAuditLabel = key => ({
    payment_session_created:'สร้างรายการชำระเงิน',
    proof_submitted:'ลูกค้าอัปโหลดสลิปผ่านเว็บไซต์',
    proof_submitted_via_line:'ลูกค้าส่งสลิปผ่าน LINE OA',
    payment_matched:'ยืนยันรับชำระเงิน',
    payment_rejected:'ปฏิเสธสลิป / ไม่พบยอดเงิน',
    payment_needs_review:'ส่งตรวจสอบเพิ่มเติม',
    payment_settings_updated:'เปลี่ยนการตั้งค่า QR Payment'
  }[key]||key||'-');

  async function callPaymentApi(action, extra={}) {
    const {data,error}=await state.db.auth.getSession();
    if(error||!data.session?.access_token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const response=await fetch(PAYMENT_API_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg().publishableKey,'Authorization':'Bearer '+data.session.access_token},body:JSON.stringify({action,branch_id:state.branchId,...extra})});
    const result=await response.json().catch(()=>({error:'ระบบตอบกลับไม่ถูกต้อง'}));
    if(!response.ok||result.success!==true) throw new Error(result.error||'เรียกใช้ระบบ QR Payment ไม่สำเร็จ');
    return result;
  }
  async function loadPaymentRows(status='all') {
    const result=await callPaymentApi('admin-list',{status});
    state.paymentRows=result.transactions||[];
    state.paymentLoadedBranch=state.branchId;
  }
  async function loadPaymentSettings() {
    const result=await callPaymentApi('admin-get-settings');
    state.paymentSettings=result.settings||null;
    state.paymentSettingsBranch=state.branchId;
  }
  async function ensurePaymentPageData(force=false) {
    if(!paymentPageKeys.includes(state.page)||state.staff?.role==='staff'||!state.db) return;
    if(!force&&state.paymentLoadedBranch===state.branchId&&state.paymentSettingsBranch===state.branchId) return;
    state.paymentLoadError='';
    try {
      const jobs=[loadPaymentSettings()];
      if(state.page!=='payment-settings') jobs.push(loadPaymentRows('all'));
      await Promise.all(jobs);
    } catch(e) { state.paymentLoadError=e.message||'โหลดข้อมูลการชำระเงินไม่สำเร็จ'; }
    if(paymentPageKeys.includes(state.page)) renderApp();
  }
  function paymentPageHead(title,desc) {
    return '<div class="page-head"><div><h2>'+title+'</h2><p>'+desc+'</p></div><div class="actions"><button class="btn" id="payment-refresh">↻ รีเฟรชข้อมูล</button></div></div>';
  }
  function paymentRowsTable(rows) {
    if(!rows.length) return '<div class="empty-state">ยังไม่มีรายการชำระเงิน</div>';
    return '<div class="table-wrap"><table class="payment-table"><thead><tr><th>วันเวลาสั่งซื้อ</th><th>Order / ลูกค้า</th><th>ยอดที่ต้องชำระ</th><th>ยอดที่ยืนยัน</th><th>สถานะ</th><th>ช่องทางรับสลิป</th><th>เวลาส่งสลิป</th><th>หลักฐาน</th><th></th></tr></thead><tbody>'+
      rows.map(row=>'<tr><td>'+esc(row.created_at?new Date(row.created_at).toLocaleString('th-TH'):'-')+'</td><td><b>'+esc(row.order_number)+'</b><small class="payment-cell-sub">'+esc(row.customer_name||'ลูกค้า LINE')+'</small><small class="payment-cell-sub">'+esc(row.customer_line_user_id||'')+'</small></td><td class="money">฿'+money(row.expected_amount)+'</td><td class="money">'+(row.paid_amount==null?'-':'฿'+money(row.paid_amount))+'</td><td>'+paymentStatusBadge(row.status)+'</td><td><span class="payment-source '+(row.submission_source==='line_oa'?'line':'')+'">'+paymentSourceLabel(row.submission_source)+'</span></td><td>'+esc(row.submitted_at?new Date(row.submitted_at).toLocaleString('th-TH'):'-')+'</td><td>'+(row.slip_url?'<a href="'+esc(row.slip_url)+'" target="_blank" rel="noopener">เปิดสลิป ↗</a>':'-')+'</td><td><button class="btn" data-payment-detail="'+esc(row.id)+'">รายละเอียด</button></td></tr>').join('')+
      '</tbody></table></div>';
  }
  function viewPaymentOverview() {
    const rows=state.paymentRows||[];
    const matched=rows.filter(x=>x.status==='matched');
    const submitted=rows.filter(x=>x.status==='submitted');
    const awaiting=rows.filter(x=>x.status==='awaiting_payment');
    const review=rows.filter(x=>x.status==='needs_review');
    const collected=matched.reduce((sum,x)=>sum+Number(x.paid_amount||0),0);
    const pendingAmount=submitted.concat(awaiting).reduce((sum,x)=>sum+Number(x.expected_amount||0),0);
    return paymentPageHead('QR Payment Overview','ภาพรวมการรับชำระเงินและรายการที่ต้องตรวจสอบ')+
      (state.paymentLoadError?'<div class="alert">'+esc(state.paymentLoadError)+'</div>':'')+
      '<div class="kpis payment-kpis"><div class="kpi"><div class="label">Transactions ทั้งหมด</div><div class="value">'+rows.length+'</div><div class="hint">รายการในสาขาที่เลือก</div></div>'+
      '<div class="kpi"><div class="label">ยอดรับเงินที่ยืนยันแล้ว</div><div class="value">฿'+money(collected)+'</div><div class="hint">'+matched.length+' รายการ</div></div>'+
      '<div class="kpi"><div class="label">รอตรวจสอบสลิป</div><div class="value">'+submitted.length+'</div><div class="hint">ต้องตรวจสอบกับยอดเงินจริง</div></div>'+
      '<div class="kpi"><div class="label">รอชำระ / ตรวจสอบเพิ่ม</div><div class="value">'+(awaiting.length+review.length)+'</div><div class="hint">ยอดคงค้าง ฿'+money(pendingAmount)+'</div></div></div>'+
      '<div class="panel payment-panel"><div class="panel-title"><h3>รายการล่าสุดที่ต้องดำเนินการ</h3><button class="btn" data-goto="payment-transactions">ดูรายการทั้งหมด →</button></div>'+
      paymentRowsTable(rows.filter(x=>['submitted','needs_review','awaiting_payment'].includes(x.status)).slice(0,10))+'</div>'+
      '<div class="alert info">ต้องตรวจสอบยอดเงินจริงจากแอปธนาคารหรือ Statement ก่อนยืนยัน Paid ระบบไม่ยืนยันจากภาพสลิปหรือยอดเงินที่ตรงกันเพียงอย่างเดียว</div>';
  }
  function viewPaymentTransactions() {
    const rows=state.paymentRows||[], q=String(state.paymentSearch||'').toLowerCase();
    const filtered=rows.filter(row=>(state.paymentStatusFilter==='all'||row.status===state.paymentStatusFilter)&&(!q||[row.order_number,row.customer_name,row.transfer_reference].some(v=>String(v||'').toLowerCase().includes(q))));
    return paymentPageHead('QR Payment Transactions','ตรวจสอบคำสั่งซื้อ สลิป และสถานะการรับเงิน')+
      (state.paymentLoadError?'<div class="alert">'+esc(state.paymentLoadError)+'</div>':'')+
      '<div class="panel payment-panel"><div class="toolbar payment-toolbar"><input class="search" id="payment-search" placeholder="ค้นหา Order / ลูกค้า / เลขอ้างอิง" value="'+esc(state.paymentSearch)+'"><select class="select-small" id="payment-status-filter">'+
      [['all','ทุกสถานะ'],['awaiting_payment','รอชำระเงิน'],['submitted','รอตรวจสอบ'],['matched','ยืนยันรับเงินแล้ว'],['needs_review','ต้องตรวจสอบเพิ่ม'],['rejected','ไม่ผ่านการตรวจสอบ'],['expired','หมดเวลาชำระ']].map(([v,l])=>'<option value="'+v+'" '+(state.paymentStatusFilter===v?'selected':'')+'>'+l+'</option>').join('')+
      '</select><span class="pill">'+filtered.length+' รายการ</span></div>'+paymentRowsTable(filtered)+'</div>';
  }
  function viewPaymentSettings() {
    const p=state.paymentSettings||{}, enabled=p.qr_payment_enabled===true;
    return paymentPageHead('QR Payment Settings','ตั้งค่าเปิด–ปิดการชำระเงินด้วย PromptPay QR ของร้าน')+
      (state.paymentLoadError?'<div class="alert">'+esc(state.paymentLoadError)+'</div>':'')+
      '<div class="payment-settings-grid"><section class="panel payment-panel"><div class="panel-title"><h3>สถานะการรับชำระเงิน</h3><span class="badge '+(enabled?'ok':'warn')+'">'+(enabled?'เปิดใช้งาน':'ปิดใช้งาน')+'</span></div>'+
      '<label class="payment-switch-row"><span><b>เปิดรับชำระด้วย QR PromptPay</b><small>เมื่อปิด ลูกค้าจะเห็นข้อความให้ชำระเงินที่หน้าร้าน</small></span><input type="checkbox" id="payment-enabled" '+(enabled?'checked':'')+'></label>'+
      '<div class="field"><label>ข้อความแนะนำการชำระเงิน</label><textarea id="payment-customer-message">'+esc(p.customer_message||'กรุณาสแกน QR PromptPay และชำระเงินตามยอดคำสั่งซื้อ')+'</textarea></div>'+
      '<div class="field"><label>เวลารอชำระเงิน (นาที)</label><input id="payment-timeout" type="number" min="5" max="240" value="'+Number(p.payment_timeout_minutes||20)+'"></div>'+
      '<div class="alert info">ลูกค้าชำระเงินด้วย QR แล้วกด “ส่งสลิปผ่าน LINE” เพื่อส่งรูปเข้า LINE OA ของสาขาโดยตรง พนักงานตรวจสอบยอดเงินจริงก่อนยืนยัน Paid</div><div class="actions"><button class="btn primary" id="payment-save-settings">บันทึกการตั้งค่า</button></div></section>'+
      '<section class="panel payment-panel payment-qr-preview"><div class="panel-title"><h3>QR PromptPay ของร้าน</h3></div><img src="'+esc(p.qr_image_url||PAYMENT_QR_URL)+'" alt="PromptPay QR"><div class="payment-qr-caption">ลูกค้าสแกน QR แล้วกรอกยอดเงินตาม Order</div><div class="alert info">การตรวจสอบเงินยังเป็น Manual Verification ไม่มีการอ่าน Krungsri Simple หรือ Bank API อัตโนมัติ</div></section></div>'+
      '<div class="alert info">เมื่อปิดระบบ ลูกค้าจะไม่เห็น QR และจะแสดงข้อความ: <b>ยืนยันคำสั่งซื้อเรียบร้อยแล้ว กรุณาชำระเงินที่หน้าร้านเมื่อมารับสินค้า</b></div>';
  }
  async function openPaymentDetail(id) {
    try {
      const result=await callPaymentApi('admin-detail',{transaction_id:id});
      const tx=result.transaction, audit=result.audit||[];
      const canReview=['submitted','needs_review','rejected'].includes(tx.status);
      const proof=tx.slip_url?'<div class="payment-proof-wrap"><div class="payment-proof-heading">หลักฐานการชำระเงิน · '+esc(paymentSourceLabel(tx.submission_source))+'</div><a class="payment-proof-link" href="'+esc(tx.slip_url)+'" target="_blank" rel="noopener"><img class="payment-proof-image" src="'+esc(tx.slip_url)+'" alt="หลักฐานการโอน"></a><a href="'+esc(tx.slip_url)+'" target="_blank" rel="noopener" class="payment-proof-open">เปิดภาพขนาดเต็ม ↗</a></div>':'<div class="empty-state">ยังไม่มีหลักฐานสลิป</div>';
      const sh=modal('<div class="modal-head"><h3>QR Payment · '+esc(tx.order_number)+'</h3><button class="btn" data-close>ปิด</button></div>'+
        '<div class="payment-detail-grid"><div><div class="payment-detail-label">ยอดที่ต้องชำระ</div><strong>฿'+money(tx.expected_amount)+'</strong></div><div><div class="payment-detail-label">สถานะ</div>'+paymentStatusBadge(tx.status)+'</div><div><div class="payment-detail-label">ช่องทางส่งสลิป</div><strong>'+esc(paymentSourceLabel(tx.submission_source))+'</strong></div><div><div class="payment-detail-label">วันเวลาส่งสลิป</div><strong class="payment-detail-small">'+esc(tx.submitted_at?new Date(tx.submitted_at).toLocaleString('th-TH'):'ยังไม่ส่ง')+'</strong></div><div><div class="payment-detail-label">ชื่อลูกค้า</div><strong class="payment-detail-small">'+esc(tx.customer_name||'-')+'</strong></div><div><div class="payment-detail-label">LINE User ID</div><strong class="payment-detail-small">'+esc(tx.customer_line_user_id||'-')+'</strong></div><div><div class="payment-detail-label">ยอดเงินจริงที่ตรวจสอบ</div><input id="payment-actual-paid" type="number" min="0" step="0.01" value="'+(tx.paid_amount??tx.expected_amount)+'"></div><div><div class="payment-detail-label">เลขอ้างอิงธุรกรรม (ถ้ามี)</div><input id="payment-transfer-reference" value="'+esc(tx.transfer_reference||'')+'"></div></div>'+
        '<div class="field"><label>บันทึกการตรวจสอบ</label><textarea id="payment-review-note" placeholder="เช่น ตรวจพบเงินเข้าใน Krungsri Simple เวลา...">'+esc(tx.verification_note||'')+'</textarea></div>'+proof+
        '<p class="help">เปิดแอปธนาคารหรือ Statement ตรวจสอบยอดเงินจริง ผู้รับเงิน และรายการอ้างอิงก่อนกดยืนยัน</p>'+
        '<div class="payment-audit"><b>ประวัติรายการ</b>'+(audit.length?audit.map(a=>'<div><b>'+esc(paymentAuditLabel(a.action_key))+'</b><small class="payment-audit-meta">'+esc(new Date(a.created_at).toLocaleString('th-TH'))+' · '+esc(a.actor_ref||'-')+'</small></div>').join(''):'<div class="muted">ยังไม่มีประวัติ</div>')+'</div>'+
        (canReview?'<div class="modal-foot payment-review-actions"><button class="btn danger" id="payment-reject">ไม่พบเงิน / ปฏิเสธ</button><button class="btn" id="payment-needs-review">ตรวจสอบเพิ่ม</button><button class="btn primary" id="payment-match">ยืนยันรับเงิน (Paid)</button></div>':'<div class="alert info">รายการนี้ยังไม่มีหลักฐานให้ตรวจสอบหรือได้รับการยืนยันรับเงินแล้ว</div>'));
      sh.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('.modal-bg').remove());
      const submitReview=async decision=>{
        const actual=Number($('#payment-actual-paid',sh).value), reference=$('#payment-transfer-reference',sh).value.trim(), note=$('#payment-review-note',sh).value.trim();
        if(decision==='matched'&&actual!==Number(tx.expected_amount)){toast('ยอดเงินจริงไม่ตรงกับยอด Order');return;}
        const button=decision==='matched'?$('#payment-match',sh):decision==='rejected'?$('#payment-reject',sh):$('#payment-needs-review',sh);
        button.disabled=true;button.textContent='กำลังบันทึก…';
        try {
          if(decision==='matched'&&!confirm('ยืนยันว่าได้ตรวจสอบรายการเงินจริงในบัญชีธนาคารแล้ว และยอดตรงกับ Order ใช่หรือไม่?')){button.disabled=false;button.textContent='ยืนยันรับเงิน (Paid)';return;}
          await callPaymentApi('admin-review',{transaction_id:id,decision,paid_amount:actual,transfer_reference:reference,note});
          $('.modal-bg')?.remove();state.paymentLoadedBranch='';await loadPaymentRows('all');renderApp();
          toast(decision==='matched'?'ยืนยันรับเงินเรียบร้อย':'อัปเดตผลการตรวจสอบแล้ว');
        } catch(e) {button.disabled=false;button.textContent=decision==='matched'?'ยืนยันรับเงิน (Paid)':decision==='rejected'?'ไม่พบเงิน / ปฏิเสธ':'ตรวจสอบเพิ่ม';toast(e.message);}
      };
      if(canReview){
        $('#payment-match',sh).onclick=()=>submitReview('matched');
        $('#payment-reject',sh).onclick=()=>submitReview('rejected');
        $('#payment-needs-review',sh).onclick=()=>submitReview('needs_review');
      }
    } catch(e) {toast(e.message||'เปิดรายละเอียด Transaction ไม่สำเร็จ');}
  }
  function bindPaymentEvents() {
    const toggle=$('#payment-nav-toggle');
    if(toggle) toggle.onclick=()=>{
      const sub=$('.payment-nav-sub'), open=sub?.hidden??true;
      if(sub) sub.hidden=!open;
      toggle.setAttribute('aria-expanded',String(open));
    };
    if($('#payment-refresh')) $('#payment-refresh').onclick=async()=>{
      state.paymentLoadedBranch='';state.paymentSettingsBranch='';await ensurePaymentPageData(true);
    };
    if(paymentPageKeys.includes(state.page)&&state.staff?.role!=='staff'&&(state.paymentLoadedBranch!==state.branchId||state.paymentSettingsBranch!==state.branchId)&&!state.paymentLoading) {
      state.paymentLoading=true;ensurePaymentPageData(true).finally(()=>{state.paymentLoading=false;});
    }
    if($('#payment-status-filter')) $('#payment-status-filter').onchange=async e=>{
      state.paymentStatusFilter=e.target.value;
      try {await loadPaymentRows(state.paymentStatusFilter);renderApp();} catch(err){toast(err.message);}
    };
    if($('#payment-search')) $('#payment-search').oninput=e=>{
      state.paymentSearch=e.target.value;const pos=e.target.selectionStart;renderApp();const n=$('#payment-search');n?.focus();n?.setSelectionRange(pos,pos);
    };
    document.querySelectorAll('[data-payment-detail]').forEach(b=>b.onclick=()=>openPaymentDetail(b.dataset.paymentDetail));
    if($('#payment-save-settings')) $('#payment-save-settings').onclick=async()=>{
      const btn=$('#payment-save-settings');btn.disabled=true;btn.textContent='กำลังบันทึก…';
      try {
        const result=await callPaymentApi('admin-save-settings',{qr_payment_enabled:$('#payment-enabled').checked,qr_image_url:PAYMENT_QR_URL,customer_message:$('#payment-customer-message').value.trim(),payment_timeout_minutes:Number($('#payment-timeout').value||20),require_slip:true});
        state.paymentSettings=result.settings;state.paymentSettingsBranch=state.branchId;renderApp();toast('บันทึก QR Payment Settings แล้ว');
      } catch(e) {btn.disabled=false;btn.textContent='บันทึกการตั้งค่า';toast(e.message);}
    };
    bindPaymentEvents();
  }

  function modal(html){
    const old=$('.modal-bg'); if(old) old.remove();
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-bg"><section class="modal">${html}</section></div>`);
    const bg=$('.modal-bg'); bg.addEventListener('click',e=>{if(e.target===bg)bg.remove();});
    return $('.modal',bg);
  }

  function openPrice(productId){
    const p=state.products.find(x=>x.id===productId); if(!p)return;
    const bp=state.branchProducts.find(x=>x.product_id===productId&&x.branch_id===state.branchId);
    const sh=modal(`<div class="modal-head"><h3>ราคาและสถานะจำหน่าย</h3><button class="btn" data-close>ปิด</button></div>
      <p><b>${esc(p.product_name)}</b> <span class="muted">${esc(p.product_code)}</span></p>
      <div class="field"><label>ราคาขาย (บาท)</label><input id="price-value" type="number" min="0" step="0.01" value="${bp?Number(bp.price):0}"></div>
      <label class="checkline"><input id="price-available" type="checkbox" ${bp?.is_available?'checked':''}> เปิดจำหน่ายที่สาขานี้</label>
      <p class="help">หากยังไม่ยืนยันราคา ให้คง 0.00 และปิดจำหน่ายไว้</p>
      <div class="modal-foot"><button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="save-price">บันทึก</button></div>`);
    sh.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('.modal-bg').remove());
    $('#save-price',sh).onclick=async()=>{
      const price=Number($('#price-value',sh).value),available=$('#price-available',sh).checked;
      if(!Number.isFinite(price)||price<0)return toast('กรุณากรอกราคาให้ถูกต้อง');
      if(available&&price<=0)return toast('กำลังเปิดขาย กรุณากำหนดราคามากกว่า 0 บาท');
      const payload={branch_id:state.branchId,product_id:p.id,price,is_available:available};
      const btn=$('#save-price',sh);btn.disabled=true;btn.textContent='กำลังบันทึก…';
      try{
        const {error}=await state.db.from('branch_products').upsert(payload,{onConflict:'branch_id,product_id'});
        if(error)throw error;
        $('.modal-bg').remove();await reloadData();renderApp();toast('บันทึกราคาสาขาแล้ว');
      }catch(e){btn.disabled=false;btn.textContent='บันทึก';toast(e.message);}
    };
  }

  async function setProductMenuState(productId, nextActive){
    if(!isSuper())return;
    const p=state.products.find(x=>x.id===productId);if(!p)return;
    const action=nextActive?'เปิดใช้เมนู':'ซ่อนเมนู';
    const detail=nextActive?'สินค้าแสดงกลับในระบบ แต่สถานะขายของแต่ละสาขายังคงปิดอยู่ ต้องเปิดขายแยกตามสาขา':'สินค้าจะหายจากหน้าสั่งซื้อ LINE ทุกสาขา โดยเก็บข้อมูลสินค้าและประวัติออเดอร์เดิมไว้';
    if(!window.confirm(action+' “'+p.product_name+'” ใช่หรือไม่?\n\n'+detail))return;
    try{
      if(!nextActive){const {error:branchError}=await state.db.from('branch_products').update({is_available:false}).eq('product_id',productId);if(branchError)throw branchError;}
      const {error}=await state.db.from('products').update({is_active:nextActive}).eq('id',productId);if(error)throw error;
      await reloadData();renderApp();
      toast(nextActive?'เปิดใช้เมนูแล้ว — กรุณาตรวจสอบสถานะขายของแต่ละสาขา':'ซ่อนเมนูจากหน้าสั่งซื้อทุกสาขาแล้ว');
    }catch(e){toast('ดำเนินการไม่สำเร็จ: '+e.message);}
  }

  function openProduct(productId){
    if(!isSuper())return;
    const p=state.products.find(x=>x.id===productId)||{product_code:'',product_name:'',category_id:state.categories[0]?.id||'',description:'',image_url:'',is_active:false,is_featured:false,display_order:0};
    const editing=!!productId;
    const sh=modal(`<div class="modal-head"><h3>${editing?'แก้ไขสินค้า':'เพิ่มสินค้า'}</h3><button class="btn" data-close>ปิด</button></div>
      <div class="form-grid">
        <div class="field"><label>Product Code *</label><input id="p-code" value="${esc(p.product_code)}" ${editing?'disabled':''}></div>
        <div class="field"><label>หมวดหมู่ *</label><select id="p-category">${state.categories.map(c=>`<option value="${c.id}" ${c.id===p.category_id?'selected':''}>${esc(c.category_name)}</option>`).join('')}</select></div>
        <div class="field span2"><label>ชื่อสินค้า *</label><input id="p-name" value="${esc(p.product_name)}"></div>
        <div class="field span2"><label>รายละเอียด</label><textarea id="p-description">${esc(p.description||'')}</textarea></div>
        <div class="field span2"><label>รูปสินค้า</label><input id="p-image" type="file" accept="image/png,image/jpeg,image/webp"><span class="help">JPG / PNG / WebP ไม่เกิน 5 MB</span>${p.image_url?`<img src="${esc(p.image_url)}" class="thumb" style="width:84px;height:84px">`:''}</div>
        <div class="field"><label>ลำดับแสดงผล</label><input id="p-order" type="number" value="${Number(p.display_order||0)}"></div>
        <div class="field"><label>สถานะ Product</label><select id="p-active"><option value="false" ${!p.is_active?'selected':''}>Draft / ปิด</option><option value="true" ${p.is_active?'selected':''}>Active</option></select></div>
        <label class="checkline span2"><input id="p-featured" type="checkbox" ${p.is_featured?'checked':''}> เมนูแนะนำ</label>
      </div>
      <div class="modal-foot"><button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="save-product">บันทึกสินค้า</button></div>`);
    sh.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('.modal-bg').remove());
    $('#save-product',sh).onclick=async()=>{
      const code=$('#p-code',sh).value.trim().toUpperCase(),name=$('#p-name',sh).value.trim(),category=$('#p-category',sh).value;
      if(!code||!name||!category)return toast('กรุณากรอกรหัส ชื่อ และหมวดหมู่');
      const btn=$('#save-product',sh);btn.disabled=true;btn.textContent='กำลังบันทึก…';
      try{
        let imageUrl=p.image_url||null;
        const file=$('#p-image',sh).files[0];
        if(file){
          if(file.size>5*1024*1024)throw new Error('รูปภาพต้องไม่เกิน 5 MB');
          const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
          const path=`${code}/${Date.now()}.${ext}`;
          const {error:upErr}=await state.db.storage.from('product-images').upload(path,file,{upsert:true,contentType:file.type});
          if(upErr)throw upErr;
          imageUrl=state.db.storage.from('product-images').getPublicUrl(path).data.publicUrl;
        }
        const payload={category_id:category,product_code:code,product_name:name,description:$('#p-description',sh).value.trim()||null,image_url:imageUrl,is_active:$('#p-active',sh).value==='true',is_featured:$('#p-featured',sh).checked,display_order:Number($('#p-order',sh).value||0)};
        if(editing)payload.id=p.id;
        const {data:savedProduct,error}=await state.db.from('products').upsert(payload,{onConflict:'product_code'}).select('id').single();
        if(error)throw error;
        const hasBranchRow=state.branchProducts.some(x=>x.product_id===savedProduct.id&&x.branch_id===state.branchId);
        if(!hasBranchRow){
          const {error:branchErr}=await state.db.from('branch_products').insert({branch_id:state.branchId,product_id:savedProduct.id,price:0,is_available:false});
          if(branchErr)throw branchErr;
        }
        $('.modal-bg').remove();await reloadData();renderApp();toast('บันทึกสินค้าเรียบร้อย');
      }catch(e){btn.disabled=false;btn.textContent='บันทึกสินค้า';toast(e.message);}
    };
  }

  function openCategory(categoryId){
    if(!isSuper())return;
    const c=state.categories.find(x=>x.id===categoryId)||{category_name:'',sort_order:state.categories.length+1,is_active:true};
    const sh=modal(`<div class="modal-head"><h3>${categoryId?'แก้ไขหมวดหมู่':'เพิ่มหมวดหมู่'}</h3><button class="btn" data-close>ปิด</button></div>
      <div class="field"><label>ชื่อหมวดหมู่</label><input id="cat-name" value="${esc(c.category_name)}"></div>
      <div class="field"><label>ลำดับ</label><input id="cat-order" type="number" value="${Number(c.sort_order||0)}"></div>
      <label class="checkline"><input id="cat-active" type="checkbox" ${c.is_active?'checked':''}> เปิดใช้งาน</label>
      <div class="modal-foot"><button class="btn" data-close>ยกเลิก</button><button class="btn primary" id="save-category">บันทึก</button></div>`);
    sh.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('.modal-bg').remove());
    $('#save-category',sh).onclick=async()=>{
      const name=$('#cat-name',sh).value.trim();if(!name)return toast('กรุณากรอกชื่อหมวดหมู่');
      if(state.categories.some(x=>x.id!==categoryId&&x.category_name.trim().toLowerCase()===name.toLowerCase()))return toast('มีหมวดหมู่นี้อยู่แล้ว');
      const payload={category_name:name,sort_order:Number($('#cat-order',sh).value||0),is_active:$('#cat-active',sh).checked};
      if(categoryId)payload.id=c.id;
      const {error}=await state.db.from('categories').upsert(payload);
      if(error)return toast(error.message);
      $('.modal-bg').remove();await reloadData();renderApp();toast('บันทึกหมวดหมู่แล้ว');
    };
  }

  function headerVal(row, names){
    const map={};Object.keys(row||{}).forEach(k=>map[String(k).trim().toLowerCase()]=row[k]);
    for(const n of names){const x=map[n.toLowerCase()];if(x!==undefined)return x;}
    return '';
  }
  function normalizeImportRows(input){
    const rows=[],errors=[],seen=new Set();
    input.forEach((raw,i)=>{
      const line=i+2;
      const branchCode=String(headerVal(raw,['branch_code','branch code','รหัสสาขา'])||activeBranch()?.branch_code||'').trim().toUpperCase();
      const code=String(headerVal(raw,['product_code','product code','รหัสสินค้า'])||'').trim().toUpperCase();
      const row={line,branchCode,productCode:code};
      if(!code){errors.push({line,reason:'ไม่มี Product Code'});return;}
      if(seen.has(code)){errors.push({line,reason:'Product Code ซ้ำในไฟล์'});return;}
      seen.add(code);
      if(branchCode!==activeBranch()?.branch_code){errors.push({line,reason:`รหัสสาขา ${branchCode} ไม่ตรงกับสาขาที่เลือก`});return;}
      const priceRaw=headerVal(raw,['price','ราคาขาย','ราคา']);
      row.price=String(priceRaw??'').trim()===''?null:Number(priceRaw);
      if(row.price!==null&&(!Number.isFinite(row.price)||row.price<0)){errors.push({line,reason:'ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'});return;}
      const availRaw=headerVal(raw,['is_available','available','เปิดขาย']);
      row.available=String(availRaw??'').trim()===''?null:parseBool(availRaw,false);
      if(isSuper()){
        row.name=String(headerVal(raw,['product_name','product name','ชื่อสินค้า'])||'').trim();
        row.categoryName=String(headerVal(raw,['category_name','category','หมวดหมู่'])||'').trim();
        row.description=String(headerVal(raw,['description','รายละเอียด'])||'').trim();
        row.activeRaw=headerVal(raw,['is_active','active','สถานะสินค้า']);
        row.active=String(row.activeRaw??'').trim()===''?null:parseBool(row.activeRaw,false);
        row.featured=parseBool(headerVal(raw,['is_featured','featured','เมนูแนะนำ']),false);
        row.order=Number(headerVal(raw,['display_order','order','ลำดับ'])||0);
        row.imageUrl=String(headerVal(raw,['image_url','image','รูปภาพ'])||'').trim()||null;
        if(!row.name){errors.push({line,reason:'ไม่มีชื่อสินค้า'});return;}
        const cat=state.categories.find(c=>c.category_name.toLowerCase()===row.categoryName.toLowerCase());
        if(!cat){errors.push({line,reason:`ไม่พบหมวดหมู่ "${row.categoryName}"`});return;}
        row.categoryId=cat.id;
      } else {
        if(!state.products.some(p=>p.product_code===code)){errors.push({line,reason:'ไม่พบสินค้าใน Catalog (ให้ Super Admin เพิ่มก่อน)'});return;}
      }
      rows.push(row);
    });
    return {rows,errors};
  }

  async function previewImport(){
    const file=$('#import-file')?.files?.[0];if(!file)return toast('กรุณาเลือกไฟล์ก่อน');
    try{
      const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array'});
      const sheet=wb.Sheets[wb.SheetNames[0]];
      const json=XLSX.utils.sheet_to_json(sheet,{defval:''});
      if(!json.length)throw new Error('ไม่พบข้อมูลในไฟล์');
      const result=normalizeImportRows(json);
      state.importRows=result.rows;state.importErrors=result.errors;state.importFileName=file.name;
      renderImportPreview(json.length);
    }catch(e){toast('อ่านไฟล์ไม่สำเร็จ: '+e.message);}
  }

  function renderImportPreview(total){
    const ok=state.importRows.length,fail=state.importErrors.length,el=$('#import-preview');
    if(!el)return;
    el.innerHTML=`<div class="panel"><div class="panel-title"><h3>3. Preview ข้อมูล</h3><span class="pill">${esc(state.importFileName)}</span></div>
      <div class="kpis"><div class="kpi"><div class="label">ทั้งหมด</div><div class="value">${total}</div></div><div class="kpi"><div class="label">พร้อมนำเข้า</div><div class="value">${ok}</div></div><div class="kpi"><div class="label">พบข้อผิดพลาด</div><div class="value">${fail}</div></div><div class="kpi"><div class="label">สาขา</div><div class="value" style="font-size:17px">${esc(activeBranch()?.branch_code||'-')}</div></div></div>
      ${fail?`<div class="alert" style="margin-bottom:12px"><b>แถวที่ต้องแก้ไข</b><ul>${state.importErrors.slice(0,30).map(e=>`<li>แถว ${e.line}: ${esc(e.reason)}</li>`).join('')}</ul>${fail>30?`<div>และอีก ${fail-30} รายการ</div>`:''}</div>`:'<div class="alert good">ไม่พบข้อผิดพลาด สามารถนำเข้าข้อมูลได้</div>'}
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>แถว</th><th>รหัสสินค้า</th>${isSuper()?'<th>ชื่อสินค้า</th><th>หมวดหมู่</th>':''}<th>ราคา</th><th>เปิดขาย</th></tr></thead><tbody>
      ${state.importRows.slice(0,50).map(r=>`<tr><td>${r.line}</td><td>${esc(r.productCode)}</td>${isSuper()?`<td>${esc(r.name)}</td><td>${esc(r.categoryName)}</td>`:''}<td>${r.price===null?'คงเดิม':money(r.price)}</td><td>${r.available===null?'คงเดิม':r.available?'เปิด':'ปิด'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="modal-foot"><span class="muted small">นำเข้าได้ ${ok} แถว · ข้ามแถวผิดพลาด ${fail} แถว</span><button class="btn primary" id="commit-import" ${ok?'':'disabled'}>ยืนยัน Import ${ok} รายการ</button></div>
    </div>`;
    $('#commit-import').onclick=commitImport;
  }

  async function commitImport(){
    const btn=$('#commit-import');if(!state.importRows.length||!btn)return;
    btn.disabled=true;btn.textContent='กำลังนำเข้า…';
    let success=0;const errors=[...state.importErrors];
    try{
      const codes=[...new Set(state.importRows.map(r=>r.productCode))];
      const {data:oldProducts,error:prodErr}=await state.db.from('products').select('id,product_code,is_active,is_featured,display_order,image_url,description,product_name,category_id').in('product_code',codes);
      if(prodErr)throw prodErr;
      const oldMap=new Map((oldProducts||[]).map(p=>[p.product_code,p]));
      let productMap=oldMap;
      if(isSuper()){
        const productPayload=state.importRows.map(r=>{
          const old=oldMap.get(r.productCode);
          return {
            product_code:r.productCode,
            product_name:r.name,
            category_id:r.categoryId,
            description:r.description||null,
            image_url:r.imageUrl||old?.image_url||null,
            is_active:r.active===null?(old?.is_active??false):r.active,
            is_featured:r.featured,
            display_order:Number.isFinite(r.order)?r.order:(old?.display_order??0),
            ...(old?{id:old.id}:{})
          };
        });
        const {data:newProducts,error}=await state.db.from('products').upsert(productPayload,{onConflict:'product_code'}).select('id,product_code');
        if(error)throw error;
        productMap=new Map((newProducts||[]).map(p=>[p.product_code,p]));
      }
      const ids=[...productMap.values()].map(p=>p.id);
      const {data:oldBp,error:bpErr}=await state.db.from('branch_products').select('id,branch_id,product_id,price,is_available').eq('branch_id',state.branchId).in('product_id',ids);
      if(bpErr)throw bpErr;
      const bpMap=new Map((oldBp||[]).map(x=>[x.product_id,x]));
      const pricePayload=state.importRows.map(r=>{
        const p=productMap.get(r.productCode);if(!p)return null;
        const old=bpMap.get(p.id);
        return {
          branch_id:state.branchId,
          product_id:p.id,
          price:r.price===null?(old?.price??0):r.price,
          is_available:r.available===null?(old?.is_available??false):r.available
        };
      }).filter(Boolean);
      const {error:priceErr}=await state.db.from('branch_products').upsert(pricePayload,{onConflict:'branch_id,product_id'});
      if(priceErr)throw priceErr;
      success=pricePayload.length;
    }catch(e){
      errors.push({line:'-',reason:e.message});
    }
    const status=errors.length===0?'completed':success>0?'partial':'failed';
    const log={
      branch_id:state.branchId,
      import_type:isSuper()?'catalog_and_branch_price':'branch_price_only',
      file_name:state.importFileName||'unknown',
      total_rows:state.importRows.length+state.importErrors.length,
      success_rows:success,
      failed_rows:errors.length,
      status,
      details:errors.slice(0,200),
      created_by:state.user.id
    };
    try{
      const {error:logErr}=await state.db.from('import_history').insert(log);
      if(logErr)throw logErr;
    }catch(e){errors.push({line:'-',reason:'บันทึก Import History ไม่สำเร็จ: '+e.message});}
    await reloadData().catch(()=>{});
    state.page='history';renderApp();
    toast(`Import สำเร็จ ${success} รายการ · ผิดพลาด ${errors.length} รายการ`);
  }

  function downloadTemplate(mode){
    const manager=mode==='price';
    const header=manager
      ? ['branch_code','product_code','price','is_available']
      : ['branch_code','product_code','product_name','category_name','description','price','is_available','is_active','is_featured','display_order','image_url'];
    const rows=[header, manager
      ? ['B0001','CA-COF-001','', 'FALSE']
      : ['B0001','CA-COF-001','เอสเปรสโซ','กาแฟ','', '', 'FALSE','FALSE','FALSE',1,'']];
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=header.map(h=>({wch:Math.max(16,h.length+4)}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Import');
    const guide=XLSX.utils.aoa_to_sheet([
      ['คำแนะนำการกรอกข้อมูล'],
      ['branch_code','รหัสสาขา เช่น B0001 ต้องตรงกับสาขาที่เลือกบนหน้าเว็บ'],
      ['product_code','รหัสสินค้า ไม่ซ้ำในไฟล์'],
      ['product_name','ชื่อสินค้า (Super Admin เท่านั้น)'],
      ['category_name','ชื่อหมวดหมู่ต้องตรงกับข้อมูลในระบบ'],
      ['price','ราคาเป็นตัวเลขบาท เว้นว่างเพื่อคงราคาเดิม'],
      ['is_available','TRUE/FALSE หรือ เปิด/ปิด เว้นว่างเพื่อคงค่าเดิม'],
      ['is_active','TRUE/FALSE เปิด/ปิด Product Catalog'],
      ['is_featured','TRUE/FALSE เมนูแนะนำ'],
      ['display_order','ลำดับการแสดงผล'],
      ['image_url','URL รูปภาพ (ไม่บังคับ)'],
      ['หมายเหตุ','ลบแถวตัวอย่างออกก่อนนำเข้า และห้ามตั้งราคา 0 บาทพร้อมเปิดขาย']
    ]);
    guide['!cols']=[{wch:22},{wch:90}];
    XLSX.utils.book_append_sheet(wb,guide,'วิธีกรอก');
    XLSX.writeFile(wb,manager?'CafeAmazon_Price_Import_Template.xlsx':'CafeAmazon_Product_Import_Template.xlsx');
  }

  function bindImportFileName(){}
  async function logout(){
    await state.db?.auth.signOut();
    state.session=null;state.user=null;state.staff=null;state.page='dashboard';
    renderLogin();
  }

  async function boot(){
    if(!initClient()){renderLogin('ระบบยังไม่ได้ตั้งค่าการเชื่อมต่อ กรุณาติดต่อผู้ดูแลระบบ');return;}
    const {data:{session}}=await state.db.auth.getSession();
    if(!session){renderLogin();return;}
    state.session=session;state.user=session.user;
    try{await loadStaffAndData();renderApp();}
    catch(e){await state.db.auth.signOut();renderLogin(e.message);}
    state.db.auth.onAuthStateChange(async(event,session)=>{
      if(event==='SIGNED_OUT'||!session){state.session=null;state.user=null;state.staff=null;renderLogin();}
    });
  }
  boot();
})();