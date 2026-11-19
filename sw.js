'use strict';
self.addEventListener('push',event=>{
 let data={title:'มีออเดอร์ใหม่ ☕',body:'มีคำสั่งซื้อใหม่เข้ามา กรุณาตรวจสอบในระบบ',url:'./orders.html'};
 try{data={...data,...(event.data?event.data.json():{})};}catch(_){}
 event.waitUntil(self.registration.showNotification(data.title||'มีออเดอร์ใหม่ ☕',{body:data.body||'กรุณาตรวจสอบคำสั่งซื้อ',icon:'./assets/cafe-amazon-logo.jpg',badge:'./assets/cafe-amazon-logo.jpg',tag:data.tag||'cafe-new-order',renotify:true,data:{url:data.url||'./orders.html'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||'./orders.html',self.registration.scope).href;
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
  for(const client of list){if(client.url.startsWith(self.registration.scope)&&'focus'in client)return client.navigate(target).then(c=>c?.focus());}
  return clients.openWindow(target);
 }));
});
