// Serveur sans dépendance (Node 18+). Sert l'appli + une petite API.
const http=require('http'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000,PUB=__dirname,OK=new Set(['index.html','manifest.webmanifest','sw.js','icon-180.png','icon-192.png','icon-512.png']),TCGDEX='https://api.tcgdex.net/v2/fr';
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const cache=new Map();
async function cached(k,ttl,fn){const h=cache.get(k);if(h&&Date.now()-h.t<ttl)return h.v;const v=await fn();cache.set(k,{t:Date.now(),v});return v}
async function jget(u,o){const r=await fetch(u,o);if(!r.ok)throw new Error(r.status+' '+u);return r.json()}
function parse(q){const re=/(\d+)\s*\/\s*(\d+)/,m=q.match(re);return{name:q.replace(re,'').replace(/\b(fr|fran[cç]ais)\b/gi,'').trim(),num:m&&m[1],total:m&&m[2]}}
const slim=c=>({id:c.id,name:c.name,number:c.localId,set:c.set&&c.set.name,total:c.set&&c.set.cardCount&&c.set.cardCount.official,rarity:c.rarity,image:c.image?c.image+'/low.webp':null,pricing:(c.pricing&&c.pricing.cardmarket)||null});
async function search(q){
  const{name,num,total}=parse(q);
  let list=await cached('l:'+name,3600e3,()=>jget(TCGDEX+'/cards?name='+encodeURIComponent(name)));
  if(num){const f=list.filter(c=>parseInt(c.localId,10)===parseInt(num,10));if(f.length)list=f}
  list=list.slice(0,12);
  let out=(await Promise.all(list.map(c=>cached('c:'+c.id,3600e3,()=>jget(TCGDEX+'/cards/'+c.id)).catch(()=>null)))).filter(Boolean);
  if(total){const f=out.filter(c=>c.set&&c.set.cardCount&&c.set.cardCount.official===parseInt(total,10));if(f.length)out=f}
  return out.map(slim);
}
let tok={v:null,exp:0};
async function ebayToken(){
  const id=process.env.EBAY_APP_ID,sec=process.env.EBAY_CERT_ID;if(!id||!sec)return null;
  if(tok.v&&Date.now()<tok.exp)return tok.v;
  const r=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(id+':'+sec).toString('base64')},body:'grant_type=client_credentials&scope='+encodeURIComponent('https://api.ebay.com/oauth/api_scope')});
  if(!r.ok)throw new Error('eBay token '+r.status);const j=await r.json();tok={v:j.access_token,exp:Date.now()+(j.expires_in-60)*1000};return tok.v;
}
async function ebay(q){
  const t=await ebayToken();if(!t)return{enabled:false,items:[]};
  const j=await cached('e:'+q,600e3,()=>jget('https://api.ebay.com/buy/browse/v1/item_summary/search?limit=20&sort=price&q='+encodeURIComponent(q),{headers:{Authorization:'Bearer '+t,'X-EBAY-C-MARKETPLACE-ID':'EBAY_FR'}}));
  return{enabled:true,items:(j.itemSummaries||[]).map(i=>({title:i.title,price:i.price&&i.price.value,currency:i.price&&i.price.currency,url:i.itemWebUrl,image:i.image&&i.image.imageUrl,country:i.itemLocation&&i.itemLocation.country}))};
}
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),send=(c,b,t)=>{res.writeHead(c,{'Content-Type':t||'application/json; charset=utf-8'});res.end(typeof b==='string'||Buffer.isBuffer(b)?b:JSON.stringify(b))};
  try{
    if(u.pathname==='/api/search')return send(200,await search(u.searchParams.get('q')||''));
    if(u.pathname==='/api/ebay')return send(200,await ebay(u.searchParams.get('q')||''));
    if(u.pathname==='/api/status')return send(200,{ebay:!!(process.env.EBAY_APP_ID&&process.env.EBAY_CERT_ID)});
    let f=path.normalize(path.join(PUB,u.pathname==='/'?'index.html':u.pathname));
    if(!OK.has(path.basename(f))||path.dirname(f)!==PUB||!fs.existsSync(f))return send(404,'Introuvable','text/plain');
    send(200,fs.readFileSync(f),TYPES[path.extname(f)]||'application/octet-stream');
  }catch(e){send(500,{error:String(e.message||e)})}
}).listen(PORT,()=>console.log('http://localhost:'+PORT));
