/* Café Amazon Unified Theme Engine — UI only.
   Theme preference is device-local. No API calls or business logic changes. */
(function(){
  'use strict';
  var KEY='ca.unified.theme.v1';
  var THEMES=['international','forest','espresso','ocean','charcoal','terracotta','dark'];
  function valid(v){return THEMES.indexOf(v)>=0?v:'forest';}
  function read(){
    try{
      var q=new URLSearchParams(location.search).get('ca-theme');
      if(q) return valid(q);
      return valid(localStorage.getItem(KEY)||'forest');
    }catch(_){return 'forest';}
  }
  function apply(name, persist){
    var theme=valid(name);
    document.documentElement.setAttribute('data-ca-theme',theme);
    if(persist!==false){try{localStorage.setItem(KEY,theme);}catch(_){}}
    var meta=document.querySelector('meta[name="theme-color"]');
    if(meta) meta.content=theme==='dark'?'#183D2B':'#0B6842';
    window.dispatchEvent(new CustomEvent('ca:themechange',{detail:{theme:theme}}));
    return theme;
  }
  function reset(){try{localStorage.removeItem(KEY);}catch(_){} return apply('forest',false);}
  function addPicker(){
    var host=document.querySelector('.top-actions')||document.querySelector('.header-right');
    if(!host||host.querySelector('.ca-theme-picker'))return;
    var select=document.createElement('select');
    select.className='ca-theme-picker';select.setAttribute('aria-label','เลือกธีม');
    select.innerHTML='<option value="international">International</option><option value="forest">Forest</option><option value="espresso">Espresso</option><option value="ocean">Ocean</option><option value="charcoal">Charcoal</option><option value="terracotta">Terracotta</option><option value="dark">Dark</option>';
    select.value=window.CafeAmazonTheme.get();
    select.addEventListener('change',function(){apply(select.value,true);});
    host.insertBefore(select,host.firstChild);
  }
  function init(){
    var link=document.createElement('link');
    link.rel='stylesheet';link.href='./assets/unified-theme.css?v=1.0.1';
    document.head.appendChild(link);
    apply(read(),false);
    addPicker();
    new MutationObserver(addPicker).observe(document.body,{childList:true,subtree:true});
  }
  window.CafeAmazonTheme={themes:THEMES.slice(),get:function(){return document.documentElement.getAttribute('data-ca-theme')||'international';},set:function(name){return apply(name,true);},reset:reset};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();