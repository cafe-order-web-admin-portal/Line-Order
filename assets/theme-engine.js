/* Café Amazon Unified Theme Engine — UI only.
   Theme preference is device-local. No API calls or business logic changes. */
(function(){
  'use strict';
  var KEY='ca.unified.theme.v1';
  var THEMES=['international','classic','forest','espresso','dark'];
  function valid(v){return THEMES.indexOf(v)>=0?v:'international';}
  function read(){
    try{
      var q=new URLSearchParams(location.search).get('ca-theme');
      if(q) return valid(q);
      return valid(localStorage.getItem(KEY)||'international');
    }catch(_){return 'international';}
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
  function reset(){try{localStorage.removeItem(KEY);}catch(_){} return apply('international',false);}
  function init(){
    var link=document.createElement('link');
    link.rel='stylesheet';link.href='./assets/unified-theme.css?v=1.0.0';
    document.head.appendChild(link);
    apply(read(),false);
  }
  window.CafeAmazonTheme={themes:THEMES.slice(),get:function(){return document.documentElement.getAttribute('data-ca-theme')||'international';},set:function(name){return apply(name,true);},reset:reset};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();