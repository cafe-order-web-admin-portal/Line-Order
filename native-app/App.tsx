import React,{useEffect,useState} from 'react';
import {SafeAreaView,View,Text,Pressable,Alert,StyleSheet} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const TASK='CAFE_AMAZON_ORDER_BACKGROUND_GPS';
const API='https://ytxbnqosenolojifeikf.supabase.co/functions/v1/share-customer-location';
type ShareConfig={orderId:string;idToken:string;liffId:string};
let shareConfig:ShareConfig|null=null;

TaskManager.defineTask(TASK,async({data,error})=>{
 if(error||!data||!shareConfig)return;
 const locations=(data as any).locations||[];
 const latest=locations[locations.length-1];
 if(!latest)return;
 const c=latest.coords;
 try{
  await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_token:shareConfig.idToken,liff_id:shareConfig.liffId,order_id:shareConfig.orderId,action:'update',latitude:c.latitude,longitude:c.longitude,accuracy_m:c.accuracy})});
 }catch(e){console.warn('Location sync failed',e);}
});

export default function App(){
 const [orderId,setOrderId]=useState('');
 const [idToken,setIdToken]=useState('');
 const [liffId,setLiffId]=useState('2012679988-ORHhLD7I');
 const [sharing,setSharing]=useState(false);
 const [status,setStatus]=useState('ยังไม่ได้แชร์ตำแหน่ง');
 const [coords,setCoords]=useState('');
 useEffect(()=>{Location.hasStartedLocationUpdatesAsync(TASK).then(setSharing).catch(()=>{});},[]);
 async function start(){
  if(!orderId.trim()||!idToken.trim()){Alert.alert('ข้อมูลไม่ครบ','ต้องเชื่อม LINE Login และระบุออเดอร์ก่อนเริ่มแชร์');return;}
  const fg=await Location.requestForegroundPermissionsAsync();
  if(!fg.granted){Alert.alert('ต้องอนุญาตตำแหน่ง','กรุณาอนุญาต Location เพื่อแชร์ตำแหน่ง');return;}
  const bg=await Location.requestBackgroundPermissionsAsync();
  if(!bg.granted){Alert.alert('ยังไม่ได้อนุญาตเบื้องหลัง','สามารถแชร์ได้เฉพาะขณะใช้แอป');}
  shareConfig={orderId:orderId.trim(),idToken:idToken.trim(),liffId};
  const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
  setCoords(p.coords.latitude.toFixed(6)+', '+p.coords.longitude.toFixed(6));
  const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_token:shareConfig.idToken,liff_id:liffId,order_id:shareConfig.orderId,action:'start',latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy_m:p.coords.accuracy})});
  const data=await res.json();
  if(!res.ok||data.success!==true){setStatus('เริ่มแชร์ไม่สำเร็จ: '+(data.error||res.status));return;}
  await Location.startLocationUpdatesAsync(TASK,{accuracy:Location.Accuracy.High,timeInterval:15000,distanceInterval:20,pausesUpdatesAutomatically:false,showsBackgroundLocationIndicator:true,foregroundService:{notificationTitle:'Café Amazon กำลังแชร์ตำแหน่ง',notificationBody:'แตะเพื่อกลับมาหยุดแชร์ตำแหน่ง'}});
  setSharing(true);setStatus('กำลังแชร์ตำแหน่งให้ร้าน');
 }
 async function stop(){
  try{
   if(shareConfig)await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_token:shareConfig.idToken,liff_id:liffId,order_id:shareConfig.orderId,action:'stop'})});
   if(await Location.hasStartedLocationUpdatesAsync(TASK))await Location.stopLocationUpdatesAsync(TASK);
   shareConfig=null;setSharing(false);setStatus('หยุดแชร์ตำแหน่งแล้ว');
  }catch(e){Alert.alert('หยุดแชร์ไม่สำเร็จ',String(e));}
 }
 return <SafeAreaView style={st.page}><View style={st.card}><Text style={st.title}>Café Amazon</Text><Text style={st.subtitle}>ติดตามตำแหน่งระหว่างเดินทาง</Text><Text style={st.label}>เลข Order</Text><Text style={st.value}>{orderId||'กรุณาเชื่อมระบบ LINE Login เพื่อโหลดออเดอร์'}</Text><Text style={st.label}>สถานะ GPS</Text><Text style={st.status}>{status}</Text><Text style={st.note}>{coords}</Text><Text style={st.note}>การแชร์ตำแหน่งทำงานเมื่อคุณยินยอมเท่านั้น คุณสามารถหยุดแชร์ได้ทุกเวลา</Text><Pressable style={[st.button,sharing&&st.disabled]} onPress={start} disabled={sharing}><Text style={st.buttonText}>เริ่มแชร์ตำแหน่ง</Text></Pressable><Pressable style={st.stop} onPress={stop}><Text style={st.stopText}>หยุดแชร์ตำแหน่ง</Text></Pressable><Text style={st.warning}>รุ่นพัฒนา: ต้องเชื่อม Native LINE Login ก่อนใช้งานจริง ห้ามกรอกหรือส่ง ID Token ด้วยตนเองในเวอร์ชันเผยแพร่</Text></View></SafeAreaView>
}
const st=StyleSheet.create({page:{flex:1,backgroundColor:'#f2f7f3',justifyContent:'center',padding:20},card:{backgroundColor:'#fff',borderRadius:20,padding:22,gap:12},title:{fontSize:27,fontWeight:'800',color:'#145c39'},subtitle:{fontSize:16,color:'#65756b',marginBottom:14},label:{fontWeight:'700',color:'#40584a'},value:{fontSize:14,color:'#173d2b'},status:{fontSize:17,fontWeight:'700',color:'#087447'},note:{fontSize:12,color:'#758278'},button:{backgroundColor:'#087447',padding:16,borderRadius:12,alignItems:'center',marginTop:10},disabled:{opacity:.5},buttonText:{color:'#fff',fontWeight:'800'},stop:{borderWidth:1,borderColor:'#c65b50',padding:14,borderRadius:12,alignItems:'center'},stopText:{color:'#a33d32',fontWeight:'700'},warning:{fontSize:11,color:'#a35b18',lineHeight:17,marginTop:8}});
