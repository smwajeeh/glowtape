document.documentElement.lang="en";
const START_HASH=location.hash;
const DATA = window.GT_DATA;
let SNAP = new Date(DATA.asOf);
const MARKETS=[
  {id:"spx",name:"S&P 500",etf:"SPY",rows:DATA.spx,caps:[0,25,50,100,250,1000],note:"Weights are the index's own float-adjusted market-cap weights."},
  {id:"ndx",name:"Nasdaq-100",etf:"QQQ",rows:DATA.ndx,caps:[0,50,100,250,1000],note:"QQQ holds these same stocks, so this view covers the Nasdaq-100, NQ futures and QQQ."},
  {id:"dow",name:"Dow 30",etf:"DIA",rows:DATA.dow,caps:[0,100,250,500,1000],note:"The Dow is price-weighted, so a high-priced stock moves it more than a bigger company with a lower share price."},
  {id:"rut",name:"Russell 2000",etf:"IWM",rows:DATA.rut,caps:[0,5,6,8,10],note:"Shows the 150 largest Russell 2000 members, about 31% of the index by weight."},
  {id:"crypto",name:"Crypto",soon:true}
];
const TFS=[["m5","5m","5 minutes","in the last 5 minutes"],["m15","15m","15 minutes","in the last 15 minutes"],["h1","1H","1 hour","in the last hour"],["d1","1D","1 day","today"],["w1","1W","1 week","over the past week"],["mo1","1M","1 month","over the past month"]];
const TFI=()=>Math.max(0,TFS.findIndex(x=>x[0]===S.tf)),TF=()=>TFS[TFI()];
const mkETF=d=>Object.fromEntries(d.etf.map(([s,p,cs])=>[s,{p,cs,get c(){return this.cs[TFI()];}}]));
let ETF=mkETF(DATA);
const SECTOR={Tech:"Technology",Comm:"Communication",Consumer:"Consumer disc.",Staples:"Consumer staples",Health:"Health care",Financials:"Financials",Industrials:"Industrials",Energy:"Energy",Utilities:"Utilities",RealEstate:"Real estate",Materials:"Materials"};
const SECC={Tech:[124,92,255],Comm:[59,130,246],Consumer:[192,86,255],Staples:[20,184,166],Health:[16,201,129],Financials:[14,165,233],Industrials:[99,102,241],Energy:[245,158,11],Utilities:[34,211,238],RealEstate:[236,72,153],Materials:[132,204,22]};
const hexOf=c=>"#"+c.map(v=>v.toString(16).padStart(2,"0")).join("");

const fmtCap=b=>b>=1000?"$"+(b/1000).toFixed(2)+"T":b>=10?"$"+b.toFixed(b>=100?0:1)+"B":"$"+b.toFixed(2)+"B";
const fmtPct=c=>c==null?"n/a":(c>0?"+":c<0?"−":"")+Math.abs(c).toFixed(2)+"%";
const arrow=c=>c==null||Math.abs(c)<0.005?"":c>0?"▲ ":"▼ ";
const fmtPctA=c=>arrow(c)+fmtPct(c);
const fmtBp=b=>(b>0?"+":b<0?"−":"")+(Math.abs(b)>=10?Math.abs(b).toFixed(0):Math.abs(b).toFixed(1))+" bp";
const fmtPx=p=>"$"+p.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:p<10?3:2});
const cls=c=>c==null||Math.abs(c)<0.005?"flat":c>0?"up":"down";
const esc=s=>String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
const $=id=>document.getElementById(id);
const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
const sheetMode=matchMedia("(max-width:1220px)"),drawerMode=matchMedia("(max-width:900px)");
const live=$("live");function announce(t){live.textContent="";setTimeout(()=>live.textContent=t,30);}

/* ---------- state ---------- */
const S={market:"spx",tf:"d1",limit:"100",page:0,size:"cap",color:"move",show:"all",minCap:0,solo:null,sel:null,sortKey:"w",sortDir:-1,theme:null};
try{const v=JSON.parse(localStorage.getItem("glowtape")||"{}");for(const k of["market","tf","limit","size","theme"])if(v[k]!=null)S[k]=v[k];}catch(e){}
if(!["25","50","100","0"].includes(String(S.limit)))S.limit="100";
if(START_HASH){const h=START_HASH.slice(1);if(MARKETS.some(m=>m.id===h&&!m.soon))S.market=h;}
function save(){try{localStorage.setItem("glowtape",JSON.stringify({market:S.market,tf:S.tf,limit:S.limit,size:S.size,color:S.color,theme:S.theme}))}catch(e){}}

/* ---------- theme ---------- */
function isDark(){if(S.theme)return S.theme==="dark";const ht=document.documentElement.getAttribute("data-theme");if(ht)return ht==="dark";return matchMedia("(prefers-color-scheme: dark)").matches;}
function applyTheme(){if(S.theme)document.documentElement.setAttribute("data-gt",S.theme);else document.documentElement.removeAttribute("data-gt");
  const d=isDark();$("thDark").setAttribute("aria-pressed",d);$("thLight").setAttribute("aria-pressed",!d);readC();sprites.clear();wake(4);}
$("thDark").addEventListener("click",()=>{S.theme="dark";save();applyTheme();announce("Dark theme");});
$("thLight").addEventListener("click",()=>{S.theme="light";save();applyTheme();announce("Light theme");});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{if(!S.theme)applyTheme();});
new MutationObserver(()=>{if(!S.theme)applyTheme();}).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

function renderStamp(){const mins=Math.max(0,Math.round((Date.now()-SNAP)/60000));
  const ago=mins<1?"just now":mins<60?`${mins} min ago`:mins<1440?`${Math.round(mins/60)} h ago`:`${Math.round(mins/1440)} d ago`;
  const t=SNAP.toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/Chicago"});
  $("stamp").innerHTML=`<span class="dot" aria-hidden="true" style="${mins>=1440?"background:var(--down)":mins>=30?"background:var(--flat)":""}"></span>Prices as of ${t} CT · ${ago}`;}

let M,nodes=[],bySec={};
function loadMarket(id){
  M=MARKETS.find(m=>m.id===id);
  const old=Object.fromEntries(nodes.map(n=>[n.sym,n]));
  nodes=M.rows.map(([sym,name,price,chgs,cap,w,sec,alt])=>{const o=old[sym];return{sym,alt:alt||null,name,price,chgs,chg:chgs[TFI()],cap,w,sec,impact:0,x:o?o.x:W/2+(Math.random()-.5)*W*.9,y:o?o.y:H/2+(Math.random()-.5)*H*.9,vx:0,vy:0,r:o?o.r:0,tr:0,on:true,f:true};});
  bySec={};nodes.forEach(n=>(bySec[n.sec] ||= []).push(n));
  [...nodes].sort((a,b)=>b.cap-a.cap).forEach((n,i)=>n.capRank=i+1);
  S.solo=null;S.sel=null;S.minCap=0;S.page=0;
  $("minCap").innerHTML=M.caps.map(c=>`<option value="${c}">${c===0?"Any size":c>=1000?"$"+c/1000+"T or more":"$"+c+"B or more"}</option>`).join("");
  try{if(location.hash.slice(1)!==id)history.replaceState(null,"","#"+id)}catch(e){}
  $("foot").innerHTML=`${esc(M.note)} Prices and moves come from Alpaca (IEX exchange feed) and refresh about every 5 minutes while the market is open; index lists, weights and market caps come from StockAnalysis.com, scaled by the latest price. Sectors use GICS groupings. For learning and screening only, not financial advice. <button id="footAbout">Glowtape by Zalin Studios</button>`;
  $("footAbout").addEventListener("click",()=>openAbout(true));
  $("cv").setAttribute("aria-label",`${M.name} bubble chart`);
  applyTF(true);renderMkts();sprites.clear();refresh();
}
function applyTF(quiet){
  const i=TFI();
  for(const n of nodes){n.chg=n.chgs[i];n.impact=n.chg==null?0:n.w*n.chg;}
  for(const a of Object.values(bySec))a.sort((p,q)=>(q.chg??-99)-(p.chg??-99)).forEach((n,j)=>{n.secRank=j+1;n.secN=a.length});
  const mv=nodes.filter(n=>n.chg!=null).map(n=>Math.abs(n.chg)).sort((a,b)=>a-b);
  M.p95=Math.max(0.05,mv[Math.floor(mv.length*.95)]||1);
  $("logoOrb").classList.toggle("down",(ETF[M.etf].c||0)<0);
  sprites.clear();renderTF();renderMkts();renderBrief();
  if(!quiet){refresh();announce(`Showing change over ${TF()[2]}`);}
}

/* ---------- controls ---------- */
function renderMkts(){
  $("mkts").innerHTML=MARKETS.map(m=>{if(m.soon)return `<button class="mbtn" role="tab" disabled aria-selected="false" tabindex="-1">${m.name}<small style="color:var(--muted)">soon</small></button>`;
    const e=ETF[m.etf],sel=m.id===S.market;return `<button class="mbtn" role="tab" data-id="${m.id}" aria-selected="${sel}" tabindex="${sel?0:-1}">${m.name}<small class="${cls(e.c)}">${m.etf} ${fmtPct(e.c)}</small></button>`;}).join("");
}
function goMarket(id,focus){if(id===S.market||!MARKETS.some(m=>m.id===id&&!m.soon))return;S.market=id;save();loadMarket(id);if(focus)$("mkts").querySelector('[aria-selected="true"]')?.focus();announce(`${M.name} loaded`);}
$("mkts").addEventListener("click",e=>{const b=e.target.closest(".mbtn[data-id]");if(b)goMarket(b.dataset.id);});
$("mkts").addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))return;e.preventDefault();const ids=MARKETS.filter(m=>!m.soon).map(m=>m.id);let i=ids.indexOf(S.market);i=(i+(e.key==="ArrowRight"||e.key==="ArrowDown"?1:-1)+ids.length)%ids.length;goMarket(ids[i],true);});
addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(h==="about"){if(aboutEl.hidden)openAbout(false);}else{if(!aboutEl.hidden)closeAbout();goMarket(h);}});

function renderTF(){$("tfSeg").innerHTML=TFS.map(([k,l,full])=>`<button role="radio" data-tf="${k}" aria-checked="${S.tf===k}" tabindex="${S.tf===k?0:-1}" aria-label="${full}">${l}</button>`).join("");}
function setTF(k,focus){if(k===S.tf)return;S.tf=k;save();applyTF();if(focus)$("tfSeg").querySelector(`[data-tf="${k}"]`)?.focus();}
$("tfSeg").addEventListener("click",e=>{const b=e.target.closest("button[data-tf]");if(b)setTF(b.dataset.tf,true);});
$("tfSeg").addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight"].includes(e.key))return;e.preventDefault();let i=TFI()+(e.key==="ArrowRight"?1:-1);i=(i+TFS.length)%TFS.length;setTF(TFS[i][0],true);});
function seg(id,key){const el=$(id);const sync=()=>el.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===String(S[key])));
  el.addEventListener("click",e=>{const b=e.target.closest("button");if(!b||String(S[key])===b.dataset.v)return;S[key]=b.dataset.v;sync();save();if(key==="color"){sprites.clear();wake(4);renderHeat();renderTable();}else{if(key==="show")S.page=0;refresh();}});sync();return sync;}
seg("sizeSeg","size");seg("colorSeg","color");const syncShow=seg("showSeg","show");
$("minCap").addEventListener("change",e=>{S.minCap=+e.target.value;S.page=0;refresh();});
function resetFilters(){S.show="all";S.minCap=0;S.solo=null;S.page=0;$("minCap").value="0";syncShow();refresh();announce("Filters reset");}
$("reset").addEventListener("click",resetFilters);$("reset2").addEventListener("click",resetFilters);
$("vBub").addEventListener("click",()=>{$("stage").scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"center"});});
$("vTbl").addEventListener("click",()=>{$("board").scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"start"});$("board").focus({preventScroll:true});});
function passes(n){if(S.solo&&n.sec!==S.solo)return false;if(n.cap<S.minCap)return false;if(S.show==="up"&&!(n.chg>0))return false;if(S.show==="down"&&!(n.chg<0))return false;return true;}

/* filters drawer on small screens */
const filtersEl=$("filters"),scrim=$("scrim");
function setDrawer(o){filtersEl.classList.toggle("open",o);scrim.hidden=!o;$("filtersBtn").setAttribute("aria-expanded",o);if(o)filtersEl.querySelector("button")?.focus();}
$("filtersBtn").addEventListener("click",()=>setDrawer(!filtersEl.classList.contains("open")));
scrim.addEventListener("click",()=>setDrawer(false));

/* ---------- rank pages ---------- */
const pagesEl=$("pages"),rankBtn=$("rankBtn");
function limitN(){return +S.limit;}
function pagePool(){return nodes.filter(n=>n.f).sort((a,b)=>b.cap-a.cap);}
function syncLimit(){$("limitSeg").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===String(S.limit)));}
function pageRows(){const pool=pagePool(),L=limitN()||pool.length||1,np=Math.max(1,Math.ceil(pool.length/L));if(S.page>=np)S.page=np-1;
  const rows=[];for(let i=0;i<np;i++){const sl=pool.slice(i*L,i*L+L),v=sl.filter(n=>n.chg!=null);rows.push({i,a:i*L+1,b:i*L+sl.length,av:v.length?v.reduce((a,n)=>a+n.chg,0)/v.length:null});}return rows;}
function renderPages(){const rows=pageRows(),cur=rows[S.page]||{a:1,b:0,av:null};
  $("plist").innerHTML=rows.map(r=>`<button class="prow" role="radio" data-p="${r.i}" aria-checked="${r.i===S.page}" tabindex="${r.i===S.page?0:-1}" aria-label="Stocks ${r.a} to ${r.b}, average ${fmtPct(r.av)}"><span class="d" aria-hidden="true"></span><span class="r">${r.a} – ${r.b}</span><span class="a ${cls(r.av)}">${fmtPct(r.av)}</span></button>`).join("");
  $("pgTf").textContent=`average move · ${TF()[1]}`;$("rankLabel").textContent=`${cur.a}–${cur.b}`;$("rankAvg").className=cls(cur.av);$("rankAvg").textContent=fmtPct(cur.av);
  $("rankNote").textContent=`${rows.length} page${rows.length>1?"s":""}`;$("pgPrev").disabled=S.page<=0;$("pgNext").disabled=S.page>=rows.length-1;syncLimit();}
function placePop(){const r=rankBtn.getBoundingClientRect();const w=Math.min(340,innerWidth-24);let left=Math.min(innerWidth-w-12,Math.max(12,r.left));let top=r.bottom+8;if(top+420>innerHeight)top=Math.max(12,innerHeight-440);pagesEl.style.left=left+"px";pagesEl.style.top=top+"px";}
function setPages(o){pagesEl.hidden=!o;rankBtn.setAttribute("aria-expanded",o);if(o){renderPages();placePop();const b=$("plist").querySelector('[aria-checked="true"]');b?.focus();b?.scrollIntoView({block:"nearest"});}}
rankBtn.addEventListener("click",()=>setPages(pagesEl.hidden));
addEventListener("resize",()=>{if(!pagesEl.hidden)placePop();});
document.addEventListener("pointerdown",e=>{if(!pagesEl.hidden&&!pagesEl.contains(e.target)&&!rankBtn.contains(e.target))setPages(false);});
function goPage(p){S.page=p;refresh();const b=$("plist").querySelector(`[data-p="${S.page}"]`);b?.focus({preventScroll:true});b?.scrollIntoView({block:"nearest"});const r=b?.querySelector(".r")?.textContent;if(r)announce(`Showing stocks ${r}`);}
$("plist").addEventListener("click",e=>{const b=e.target.closest(".prow");if(b)goPage(+b.dataset.p);});
$("plist").addEventListener("keydown",e=>{const n=$("plist").children.length;if(e.key==="ArrowDown"){e.preventDefault();goPage(Math.min(n-1,S.page+1));}else if(e.key==="ArrowUp"){e.preventDefault();goPage(Math.max(0,S.page-1));}});
$("pgPrev").addEventListener("click",()=>goPage(Math.max(0,S.page-1)));$("pgNext").addEventListener("click",()=>goPage(S.page+1));
$("limitSeg").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;S.limit=b.dataset.v;S.page=0;save();refresh();renderPages();});

/* ---------- sectors (filter list) ---------- */
function secRows(){return Object.entries(bySec).map(([s,a])=>{const v=a.filter(n=>n.chg!=null&&n.cap>=S.minCap),w=v.reduce((x,n)=>x+n.w,0);return{s,n:a.length,mv:w?v.reduce((x,n)=>x+n.w*n.chg,0)/w:0,w:a.reduce((x,n)=>x+n.w,0)};}).sort((a,b)=>b.mv-a.mv);}
function renderSecs(){
  $("secs").innerHTML=secRows().map(r=>`<button class="sec ${S.solo&&S.solo!==r.s?"off":""}" data-s="${r.s}" aria-pressed="${S.solo===r.s}" aria-label="${SECTOR[r.s]}, ${r.n} stocks, ${fmtPct(r.mv)}"><span class="nm"><i style="background:${hexOf(SECC[r.s])}"></i>${SECTOR[r.s]}</span><span class="pc ${cls(r.mv)}">${fmtPct(r.mv)}</span></button>`).join("");
}
$("secs").addEventListener("click",e=>{const b=e.target.closest(".sec");if(!b)return;S.solo=S.solo===b.dataset.s?null:b.dataset.s;S.page=0;refresh();announce(S.solo?`Showing ${SECTOR[S.solo]} only`:"Showing all sectors");});

/* ---------- search palette ---------- */
const palBack=$("palBack"),palIn=$("palIn"),palList=$("palList");let palItems=[],palIdx=0,palReturn=null;
function openPal(){palReturn=document.activeElement;palBack.hidden=false;palIn.value="";renderPal();palIn.focus();}
function closePal(){palBack.hidden=true;palReturn?.focus?.({preventScroll:true});}
function renderPal(){
  const q=palIn.value.trim().toLowerCase();
  const mk=MARKETS.filter(m=>!m.soon&&(!q||m.name.toLowerCase().includes(q)||m.etf.toLowerCase().includes(q))).map(m=>({type:"m",id:m.id,label:"Switch to "+m.name,sub:m.etf,right:fmtPctA(ETF[m.etf].c),c:ETF[m.etf].c}));
  let st=nodes.filter(n=>!q||n.sym.toLowerCase().startsWith(q)||(n.alt&&n.alt.toLowerCase().startsWith(q))||n.name.toLowerCase().includes(q));
  st.sort((a,b)=>(b.sym.toLowerCase()===q)-(a.sym.toLowerCase()===q)||(b.sym.toLowerCase().startsWith(q))-(a.sym.toLowerCase().startsWith(q))||b.cap-a.cap);
  st=st.slice(0,q?10:6).map(n=>({type:"s",sym:n.sym,label:n.sym,sub:n.alt?n.name+" · also "+n.alt:n.name,right:fmtPctA(n.chg),c:n.chg}));
  palItems=[...st,...(q?mk:mk.filter(m=>m.id!==S.market))];palIdx=0;let html="",i=0;
  if(st.length)html+=`<li class="grp" role="presentation">${q?"Stocks":"Biggest in "+esc(M.name)}</li>`+st.map(it=>pli(it,i++)).join("");
  const mm=palItems.filter(x=>x.type==="m");if(mm.length)html+=`<li class="grp" role="presentation">Markets</li>`+mm.map(it=>pli(it,i++)).join("");
  palList.innerHTML=html||`<li class="grp" role="presentation">No matches in ${esc(M.name)}</li>`;syncPal();}
function pli(it,i){return `<li role="option" id="po${i}" data-i="${i}" aria-selected="false"><span class="l"><b>${esc(it.label)}</b><span>${esc(it.sub)}</span></span><span class="r ${cls(it.c)}">${it.right}</span></li>`;}
function syncPal(){palList.querySelectorAll("[role=option]").forEach(li=>{const on=+li.dataset.i===palIdx;li.setAttribute("aria-selected",on);if(on)li.scrollIntoView({block:"nearest"});});palIn.setAttribute("aria-activedescendant",palItems.length?"po"+palIdx:"");}
function runPal(i){const it=palItems[i];if(!it)return;closePal();if(it.type==="m")goMarket(it.id);else pick(it.sym);}
palIn.addEventListener("input",renderPal);
palIn.addEventListener("keydown",e=>{if(e.key==="ArrowDown"){e.preventDefault();palIdx=Math.min(palItems.length-1,palIdx+1);syncPal();}else if(e.key==="ArrowUp"){e.preventDefault();palIdx=Math.max(0,palIdx-1);syncPal();}else if(e.key==="Enter"){e.preventDefault();runPal(palIdx);}else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();closePal();}});
palList.addEventListener("click",e=>{const li=e.target.closest("[role=option]");if(li)runPal(+li.dataset.i);});
palBack.addEventListener("pointerdown",e=>{if(e.target===palBack)closePal();});
$("searchBtn").addEventListener("click",openPal);
$("logo").addEventListener("click",e=>{e.preventDefault();scrollTo({top:0,behavior:reduceMotion?"auto":"smooth"});});

/* ---------- about ---------- */
const ABOUT=[
  {id:"story",t:"Our story",s:"why it exists",z:"l",c:"124,92,255",h:`<div class="story">
    <p class="kick">Before the bell</p>
    <h3>It started with a coffee and too many tabs.</h3>
    <p>For the last four to five years, every trading morning has looked the same for Waji Syed: coffee in one hand, a dozen browser tabs in the other. Futures, heatmaps, earnings, a watchlist that never quite told the whole story.</p>
    <p>The question at 8:30 AM was always simple: <b>what's moving, and why?</b> The answer never was. It was hidden in tables and spread across five different sites, and by the time the picture came together the opening bell had already rung.</p>
    <blockquote>"I just wanted one place where I could take a quick peek at the markets in the morning and know exactly where I stand."</blockquote>
    <p>So he built it. Glowtape takes the old ticker tape and makes it glow. Every stock is a bubble: <span class="up"><b>green</b></span> when it's rising, <span class="down"><b>red</b></span> when it's falling, brighter the harder it moves, and bigger the more it matters. One look shows you the whole market. No digging, no noise. Just a peek, and you're ready.</p>
    <div class="miles">
      <div><b>4–5 yrs</b><span>trading the markets</span></div>
      <div><b>1 glance</b><span>the whole market, every morning</span></div>
      <div><b>4 indexes</b><span>S&amp;P 500, Nasdaq-100, Dow, Russell</span></div>
    </div>
    <p class="sign">Made with care at <b>Zalin Studios</b>, for every trader who wants the picture before the bell.</p>
  </div>`},
  {id:"what",t:"What it does",s:"the app",z:"l",c:"16,201,129",h:`<h3>What Glowtape does</h3><ul><li>Shows the S&amp;P 500, Nasdaq-100, Dow 30 and Russell 2000 as glossy bubbles. Size is company size; green means up, red means down.</li><li>Switches between 5 minutes, 15 minutes, 1 hour, 1 day, 1 week and 1 month.</li><li>Ranks stocks by size in pages, with each page's average move.</li><li>Explains who is pushing the index up or dragging it down, sector by sector.</li><li>Comes in dark and light. Crypto bubbles are coming next.</li></ul>`},
  {id:"team",t:"The team",s:"the founder",z:"m",c:"59,130,246",h:`<h3>The team</h3><div class="founder"><span class="fav" aria-hidden="true">WS</span><div><b>Waji Syed</b><span>Founder · Trader · Builder</span></div></div><p>Glowtape is a one-person studio project. Waji designs it, builds it and uses it every morning before the open. If something feels off or could be better, he'd love to hear about it.</p>`},
  {id:"data",t:"Data & disclaimer",s:"read me",z:"m",c:"242,84,107",h:`<h3>Data &amp; disclaimer</h3><p>Prices and moves come from Alpaca (IEX exchange feed) and refresh about every 5 minutes while the U.S. market is open; the time at the top shows the last update. Index lists, weights and market caps come from StockAnalysis.com, scaled by the latest price.</p><p><b>Glowtape is for learning and screening only. It is not financial or trading advice.</b></p>`},
  {id:"contact",t:"Get in touch",s:"say hi",z:"m",c:"245,158,11",h:`<h3>Get in touch</h3><p>Questions, ideas or a bug? Send a note and it goes straight to Waji's inbox. His email address is never shown here.</p>
    <form class="cform" id="cForm" novalidate>
      <label>Your name<input id="cName" autocomplete="name" maxlength="80" required></label>
      <label>Your email, so we can reply<input id="cMail" type="email" autocomplete="email" maxlength="120" required></label>
      <label>Message<textarea id="cMsg" rows="5" maxlength="2000" required></textarea></label>
      <label class="sr" aria-hidden="true">Leave this empty<input type="checkbox" id="cBot" tabindex="-1"></label>
      <button type="submit" class="csend" id="cSend">Send message</button>
      <p class="cstat" id="cStat" role="status"></p>
    </form>
    `}
];
const aboutEl=$("about");let abSel="story",abReturn=null;
function renderAbout(){$("abStage").innerHTML=ABOUT.map((a,i)=>`<button class="aorb ${a.z}" data-a="${a.id}" aria-pressed="${a.id===abSel}" style="--c:${a.c};animation-delay:${i*70}ms">${a.t}<small>${a.s}</small></button>`).join("");$("abCard").innerHTML=ABOUT.find(a=>a.id===abSel).h;if(abSel==="contact")initContact();}
function openAbout(push){abReturn=document.activeElement;aboutEl.hidden=false;document.body.style.overflow="hidden";renderAbout();$("abClose").focus();if(push){try{history.replaceState(null,"","#about")}catch(e){}}}
function closeAbout(){aboutEl.hidden=true;document.body.style.overflow="";try{history.replaceState(null,"","#"+S.market)}catch(e){}abReturn?.focus?.({preventScroll:true});}
$("aboutBtn").addEventListener("click",()=>openAbout(true));$("abClose").addEventListener("click",closeAbout);
$("abStage").addEventListener("click",e=>{const b=e.target.closest(".aorb");if(!b)return;abSel=b.dataset.a;renderAbout();$("abStage").querySelector(`[data-a="${abSel}"]`).focus();});
aboutEl.addEventListener("keydown",e=>{if(e.key==="Escape"){e.stopPropagation();closeAbout();}if(e.key==="Tab"){const f=[...aboutEl.querySelectorAll("button,a[href]")];const a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus();}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus();}}});

/* ---------- contact: sent through Web3Forms, which forwards to the owner's inbox (address never in the page) ---------- */
async function initContact(){
  const f=$("cForm"),st=$("cStat");if(!f)return;
  const KEYW=(window.GT_CONFIG||{}).web3formsKey||"";
  if(!KEYW){f.querySelectorAll("input,textarea,button").forEach(x=>x.disabled=true);st.textContent="The contact form is almost ready. Please check back soon.";return;}
  f.onsubmit=async ev=>{ev.preventDefault();
    const name=$("cName").value.trim(),mail=$("cMail").value.trim(),msg=$("cMsg").value.trim();
    if(!name||!msg||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)){st.className="cstat bad";st.textContent="Please add your name, a valid email and a message.";return;}
    if($("cBot").checked)return;
    const btn=$("cSend");btn.disabled=true;btn.textContent="Sending…";st.className="cstat";st.textContent="";
    try{const r=await fetch("https://api.web3forms.com/submit",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},
        body:JSON.stringify({access_key:KEYW,subject:"New Glowtape message from "+name,from_name:"Glowtape",name,email:mail,replyto:mail,message:msg})});
      const j=await r.json().catch(()=>({}));if(!r.ok||!j.success)throw new Error(j.message||r.status);
      f.reset();st.className="cstat ok";st.textContent=`Thanks, ${name}! Your message was sent. Waji will reply to ${mail}.`;
    }catch(e){st.className="cstat bad";st.textContent="Sorry, that didn't send. Please try again in a moment.";}
    btn.disabled=false;btn.textContent="Send message";};
}
addEventListener("keydown",e=>{const tag=document.activeElement?.tagName;
  if((e.key==="k"||e.key==="K")&&(e.metaKey||e.ctrlKey)){e.preventDefault();palBack.hidden?openPal():closePal();return;}
  if(e.key==="/"&&palBack.hidden&&aboutEl.hidden&&tag!=="INPUT"&&tag!=="SELECT"){e.preventDefault();openPal();return;}
  if(e.key==="Escape"&&palBack.hidden&&aboutEl.hidden){if(!pagesEl.hidden){setPages(false);rankBtn.focus();}else if(filtersEl.classList.contains("open")){setDrawer(false);$("filtersBtn").focus();}else if(S.sel){select(null);}}});

/* ---------- canvas field ---------- */
const cv=$("cv"),ctx=cv.getContext("2d"),tip=$("tip");
let W=900,H=600,DPR=1,C={},awake=0,visible=true;
function readC(){const cs=getComputedStyle(document.documentElement);for(const k of["ink","muted","accent","up","down","line"])C[k]=cs.getPropertyValue("--"+k).trim();C.font=cs.getPropertyValue("--sans");C.dark=isDark();}
function wake(f=300){awake=Math.max(awake,f);}
function resize(){const r=cv.getBoundingClientRect();if(!r.width)return;DPR=Math.min(2,devicePixelRatio||1);W=r.width;H=r.height;cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);ctx.setTransform(DPR,0,0,DPR,0,0);sprites.clear();targets();wake();}
function sv(n){if(S.size==="cap")return Math.sqrt(n.cap);if(S.size==="move")return Math.abs(n.chg??0)+0.12*M.p95/2;return Math.abs(n.impact)+(M.id==="rut"?0.002:0.02);}
const PADT=12,PADB=34;
function targets(){
  const vis=nodes.filter(n=>n.on),N=vis.length||1,AH=Math.max(200,H-PADT-PADB);
  const sum=vis.reduce((a,n)=>a+sv(n),0)||1,k=Math.sqrt(0.52*W*AH/(Math.PI*sum));
  const minR=Math.max(7,Math.min(18,Math.sqrt(W*AH/N)*0.18)),maxR=Math.min(W,AH)*0.19;
  vis.forEach(n=>n.tr=Math.min(maxR,Math.max(minR,Math.sqrt(sv(n))*k)));nodes.forEach(n=>{if(!n.on)n.tr=0});
}
let drag=null,hover=null,down=null;
function step(){
  const cx=W/2,cy=PADT+(H-PADT-PADB)/2,yMax=H-PADB+18;
  const a=[];
  for(const n of nodes){n.px=n.x;n.py=n.y;n.r+=(n.tr-n.r)*0.16;if(n.r<0.4)continue;a.push(n);if(n===drag)continue;
    n.vx=(n.vx+(cx-n.x)*0.0045)*0.82;n.vy=(n.vy+(cy-n.y)*0.0062)*0.82;n.x+=n.vx;n.y+=n.vy;}
  for(let it=0;it<2;it++){
    for(let i=0;i<a.length;i++){const p=a[i];for(let j=i+1;j<a.length;j++){const q=a[j];
      const dx=q.x-p.x,dy=q.y-p.y,m=p.r+q.r+5;if(dx>m||dx<-m||dy>m||dy<-m)continue;const d2=dx*dx+dy*dy;
      if(d2<m*m){const d=Math.sqrt(d2)||0.01,o=(m-d)/2,nx=dx/d,ny=dy/d,mp=p===drag?0:1,mq=q===drag?0:1,t=(mp+mq)||1;p.x-=nx*o*2*mp/t;p.y-=ny*o*2*mp/t;q.x+=nx*o*2*mq/t;q.y+=ny*o*2*mq/t;}}}
    for(const n of a){if(n===drag)continue;n.x=Math.min(W-n.r-3,Math.max(n.r+3,n.x));n.y=Math.min(yMax-n.r,Math.max(n.r+PADT,n.y));}
  }
  let en=0;
  for(const n of a){if(n!==drag){n.vx=(n.x-n.px)*0.82;n.vy=(n.y-n.py)*0.82;}en+=Math.abs(n.x-n.px)+Math.abs(n.y-n.py)+Math.abs(n.tr-n.r);}
  return en/(a.length||1);
}
/* glossy sphere sprites */
const sprites=new Map();
const mix=(a,b,k)=>a.map((v,i)=>Math.round(v+(b[i]-v)*k));
function baseColor(n){
  if(S.color==="sector")return{c:SECC[n.sec]||[124,92,255],k:0.9};
  const g=n.chg??0,t=Math.min(1,Math.sqrt(Math.abs(g)/(M.p95||2)));
  const P=C.dark?{u0:[40,104,80],u1:[30,235,140],d0:[116,48,62],d1:[255,59,92]}:{u0:[150,222,182],u1:[4,158,96],d0:[246,170,182],d1:[222,30,64]};
  return{c:mix(g>=0?P.u0:P.d0,g>=0?P.u1:P.d1,t),k:0.35+0.65*t};
}
function sprite(n,r){
  const {c,k}=baseColor(n),rb=Math.max(3,Math.round(r)),kb=Math.round(k*10);
  const id=c.join(",")+"|"+rb+"|"+kb+"|"+(C.dark?1:0);let s=sprites.get(id);if(s)return s;
  if(sprites.size>1600)sprites.clear();
  const glow=Math.max(4,rb*0.38),size=Math.ceil((rb+glow)*2);
  const cvs=document.createElement("canvas");cvs.width=Math.ceil(size*DPR);cvs.height=Math.ceil(size*DPR);const g=cvs.getContext("2d");g.scale(DPR,DPR);const o=size/2;
  const lite=mix(c,[255,255,255],C.dark?0.32:0.42),deep=mix(c,[0,0,0],C.dark?0.48:0.22);
  g.save();g.shadowColor=`rgba(${c.join(",")},${((C.dark?0.55:0.38)*(0.35+0.65*k)).toFixed(3)})`;g.shadowBlur=glow;g.beginPath();g.arc(o,o,rb,0,Math.PI*2);g.fillStyle=`rgb(${c.join(",")})`;g.fill();g.restore();
  const body=g.createRadialGradient(o-rb*0.18,o-rb*0.22,rb*0.05,o,o+rb*0.08,rb*1.02);
  body.addColorStop(0,`rgb(${lite.join(",")})`);body.addColorStop(0.55,`rgb(${c.join(",")})`);body.addColorStop(1,`rgb(${deep.join(",")})`);
  g.beginPath();g.arc(o,o,rb,0,Math.PI*2);g.fillStyle=body;g.fill();
  const rim=g.createRadialGradient(o,o,rb*0.78,o,o,rb);rim.addColorStop(0,"rgba(255,255,255,0)");rim.addColorStop(1,`rgba(255,255,255,${C.dark?0.18:0.35})`);g.fillStyle=rim;g.fill();
  const hi=g.createRadialGradient(o-rb*0.34,o-rb*0.42,0,o-rb*0.34,o-rb*0.42,rb*0.6);hi.addColorStop(0,`rgba(255,255,255,${C.dark?0.55:0.75})`);hi.addColorStop(1,"rgba(255,255,255,0)");
  g.fillStyle=hi;g.beginPath();g.arc(o,o,rb,0,Math.PI*2);g.fill();
  const lum=0.299*c[0]+0.587*c[1]+0.114*c[2];
  s={c:cvs,size,ink:(S.color==="move"&&lum>178)?"#0E1526":"#FFFFFF"};sprites.set(id,s);return s;
}
function draw(){
  ctx.clearRect(0,0,W,H);
  const order=[...nodes].sort((a,b)=>(a===S.sel)-(b===S.sel)||(a===hover)-(b===hover));
  const meta=[];
  for(const n of order){if(n.r<1)continue;const s=sprite(n,n.r),sc=n.r/Math.max(3,Math.round(n.r)),sz=s.size*sc;
    ctx.drawImage(s.c,n.x-sz/2,n.y-sz/2,sz,sz);meta.push([n,s.ink]);
    if(n===S.sel||n===hover){ctx.beginPath();ctx.arc(n.x,n.y,n.r+5,0,Math.PI*2);ctx.lineWidth=n===S.sel?3:1.8;ctx.strokeStyle=n===S.sel?C.accent:(C.dark?"rgba(255,255,255,.6)":"rgba(14,21,38,.35)");ctx.stroke();}}
  ctx.textAlign="center";ctx.textBaseline="middle";
  for(const [n,ink] of meta){if(n.r<13)continue;
    let fs=Math.min(46,n.r*0.42);ctx.font=`800 ${fs}px ${C.font}`;const w=ctx.measureText(n.sym).width,mx=n.r*1.55;if(w>mx)fs*=mx/w;if(fs<8.5)continue;
    const light=ink==="#FFFFFF";ctx.shadowColor=light?"rgba(0,0,0,.35)":"transparent";ctx.shadowBlur=light?4:0;ctx.shadowOffsetY=light?1:0;
    ctx.font=`800 ${fs}px ${C.font}`;ctx.fillStyle=ink;
    if(n.r>=22&&fs>=10){ctx.fillText(n.sym,n.x,n.y-fs*0.34);const ps=Math.max(8,Math.min(fs*0.52,n.r*0.3));ctx.font=`700 ${ps}px ${C.font}`;
      ctx.fillStyle=S.color==="sector"?(n.chg==null?"rgba(255,255,255,.8)":n.chg>=0?"#B9FFD6":"#FFD0D7"):(light?"rgba(255,255,255,.95)":"#0E1526");ctx.fillText(fmtPct(n.chg),n.x,n.y+fs*0.52);}
    else ctx.fillText(n.sym,n.x,n.y);
    ctx.shadowColor="transparent";ctx.shadowBlur=0;ctx.shadowOffsetY=0;}
}
function loop(){if(visible&&(awake>0||drag)){let e=step();if(reduceMotion)for(let i=0;i<4;i++)e=step();draw();awake=e>0.04?Math.max(awake-1,30):awake-1;}requestAnimationFrame(loop);}
new IntersectionObserver(es=>{visible=es[0].isIntersecting&&!document.hidden;if(visible)wake(60);}).observe(cv);
document.addEventListener("visibilitychange",()=>{visible=!document.hidden;if(visible)wake(60);});
function hit(x,y){let b=null;for(const n of nodes){if(n.r<1)continue;if((x-n.x)**2+(y-n.y)**2<=n.r*n.r&&(!b||n.r<b.r))b=n;}return b;}
const pos=e=>{const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
cv.addEventListener("pointerdown",e=>{const p=pos(e),n=hit(p.x,p.y);down={p,n,moved:false};if(n&&e.pointerType!=="touch"){drag=n;cv.setPointerCapture(e.pointerId);cv.style.cursor="grabbing";wake();}});
cv.addEventListener("pointermove",e=>{const p=pos(e);
  if(down&&drag){if(Math.hypot(p.x-down.p.x,p.y-down.p.y)>4)down.moved=true;drag.x=p.x;drag.y=p.y;drag.vx=drag.vy=0;tip.hidden=true;wake();return;}
  if(down&&Math.hypot(p.x-down.p.x,p.y-down.p.y)>8)down.moved=true;if(e.pointerType!=="mouse")return;
  const h=hit(p.x,p.y);if(h!==hover){hover=h;wake(2);cv.style.cursor=h?"pointer":"grab";}
  if(hover&&hover!==S.sel){tip.hidden=false;tip.innerHTML=`<b>${esc(hover.sym)}</b> ${esc(hover.name)}<br><span class="${cls(hover.chg)}" style="font-weight:700">${fmtPctA(hover.chg)}</span> <span style="color:var(--muted)">· ${fmtPx(hover.price)} · ${fmtCap(hover.cap)} · ${SECTOR[hover.sec]}</span>`;
    const tw=tip.offsetWidth;tip.style.left=Math.min(W-tw-8,Math.max(8,p.x+16))+"px";tip.style.top=Math.max(8,p.y-56)+"px";}else tip.hidden=true;});
function endDrag(){if(down&&!down.moved){if(down.n)select(down.n);else if(S.sel)select(null);}drag=null;down=null;cv.style.cursor="grab";}
cv.addEventListener("pointerup",endDrag);cv.addEventListener("pointercancel",()=>{drag=null;down=null;});
cv.addEventListener("pointerleave",()=>{if(hover){hover=null;wake(2);}tip.hidden=true});
cv.addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))return;e.preventDefault();
  const list=nodes.filter(n=>n.on).sort((a,b)=>b.cap-a.cap);if(!list.length)return;let i=S.sel?list.indexOf(S.sel):-1;
  if(e.key==="Home")i=0;else if(e.key==="End")i=list.length-1;else i=(i+(e.key==="ArrowRight"||e.key==="ArrowDown"?1:-1)+list.length)%list.length;select(list[i],true);});

/* ---------- details ---------- */
const det=$("details");
function pick(sym){const n=nodes.find(x=>x.sym===sym||x.alt===sym);if(!n)return;if(!n.f)resetFilters();
  const L=limitN();if(L){const i=pagePool().indexOf(n);if(i>=0&&Math.floor(i/L)!==S.page){S.page=Math.floor(i/L);S.sel=null;refresh();}}
  select(n);if(!sheetMode.matches)$("stage").scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"center"});}
function select(n,fromKeys){const was=S.sel;S.sel=n;if(n?!n.on:(was&&limitN()))refresh();renderDetails();renderTable();wake(40);tip.hidden=true;
  if(n){announce(`${n.sym}, ${n.name}, ${fmtPct(n.chg)}, ${fmtPx(n.price)}`);if(!fromKeys&&sheetMode.matches)setTimeout(()=>det.querySelector(".x")?.focus({preventScroll:true}),40);}}
function renderDetails(){
  const n=S.sel;det.classList.toggle("idle",!n&&sheetMode.matches);
  if(!n){const v=nodes.filter(x=>x.f&&x.chg!=null);const mini=l=>`<div class="mini">${l.map(x=>`<button data-sym="${esc(x.sym)}"><b>${esc(x.sym)}</b><span class="${cls(x.chg)}" style="font-weight:700">${fmtPctA(x.chg)}</span></button>`).join("")}</div>`;
    det.innerHTML=`<div><div style="font-weight:800;font-size:18px">Stock details</div><p style="margin:2px 0 0;color:var(--muted);font-size:13px">Click any bubble to see its details here.</p></div>
      <div><div class="dsub">Top gainers · ${TF()[1]}</div>${mini([...v].sort((a,b)=>b.chg-a.chg).slice(0,5))}</div>
      <div><div class="dsub">Top losers · ${TF()[1]}</div>${mini([...v].sort((a,b)=>a.chg-b.chg).slice(0,5))}</div>
      <p class="note">Press <b>/</b> or <b>⌘K</b> to search. Use the arrow keys on the bubbles to step through stocks.</p>`;
    det.querySelectorAll("[data-sym]").forEach(b=>b.addEventListener("click",()=>pick(b.dataset.sym)));return;}
  const mx=Math.max(0.01,...n.chgs.map(v=>Math.abs(v??0)));
  const bars=TFS.map(([k,l],i)=>{const v=n.chgs[i];const col=v==null?"var(--flat)":v>=0?"var(--up)":"var(--down)";return `<button class="tfb" data-tf="${k}" aria-pressed="${S.tf===k}" aria-label="${l}: ${fmtPct(v)}"><span class="v" style="color:${col}">${v==null?"n/a":(v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(Math.abs(v)<1?2:1)}</span><i style="height:${Math.max(4,Math.abs(v??0)/mx*64).toFixed(0)}px;background:${col};opacity:${S.tf===k?1:.5}"></i><span class="k">${l}</span></button>`;}).join("");
  const tv=`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(n.sym.replace(".",""))}`,sa=`https://stockanalysis.com/stocks/${n.sym.toLowerCase().replace(".","-")}/`;
  const sameCo=nodes.filter(x=>x!==n&&x.name.split(" ")[0]===n.name.split(" ")[0]&&x.name.split(" ")[0].length>3);
  const rankImp=[...nodes].filter(x=>x.chg!=null).sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).indexOf(n)+1;
  let note=n.chg==null?"No move data for this timeframe.":`${esc(n.name.replace(/ \(Class [A-Z]\)| Inc\.| Corporation/g,""))} ${n.impact<0?"is pulling the "+esc(M.name)+" down":"is lifting the "+esc(M.name)} by about <b>${fmtBp(Math.abs(n.impact)).replace("+","")}</b> ${TF()[3]}${rankImp===1?", more than any other stock":rankImp<=5?`, the #${rankImp} mover by impact`:""}.`;
  det.innerHTML=`<div class="dh"><div class="nm"><b>${esc(n.name)}</b><span>${esc(n.sym)}${n.alt?" + "+esc(n.alt):""} · ${SECTOR[n.sec]}</span></div><button class="x" aria-label="Close details">×</button></div>
    <div><div class="price">${fmtPx(n.price)}</div><div class="chg ${cls(n.chg)}">${fmtPctA(n.chg)} ${TF()[3]}</div></div>
    <div><div class="dsub">Move by timeframe</div><div class="tfbars">${bars}</div></div>
    <dl class="kv"><dt>Market cap</dt><dd>${fmtCap(n.cap)}</dd><dt>Index weight</dt><dd>${n.w.toFixed(2)}%</dd><dt>Impact on ${esc(M.name)}</dt><dd class="${cls(n.impact)}">${n.chg==null?"n/a":fmtBp(n.impact)}</dd><dt>Size rank</dt><dd>${n.capRank} of ${nodes.length}</dd><dt>Rank in sector</dt><dd>${n.chg==null?"n/a":n.secRank+" of "+n.secN}</dd></dl>
    <p class="note">${note}${n.alt?` <br><br>Shown as one bubble: <b>${esc(n.alt)}</b> is another share class of the same company. Weight and impact combine both classes; the move is their weighted average; price is ${esc(n.sym)}.`:""}</p>
    <div class="acts"><a class="pri" href="${tv}" target="_blank" rel="noopener">Open chart</a><a class="sec2" href="${sa}" target="_blank" rel="noopener">Financials</a></div>`;
  det.querySelector(".x").addEventListener("click",()=>{select(null);cv.focus({preventScroll:true});});
  det.querySelectorAll(".tfb").forEach(b=>b.addEventListener("click",()=>setTF(b.dataset.tf)));
}

/* ---------- stats, brief, movers, heat, table ---------- */
function renderStats(){
  const v=nodes.filter(n=>n.f&&n.chg!=null),e=ETF[M.etf];
  const adv=v.filter(n=>n.chg>0).length,dec=v.filter(n=>n.chg<0).length;const drag=[...v].sort((a,b)=>a.impact-b.impact)[0],lift=[...v].sort((a,b)=>b.impact-a.impact)[0];
  const tot=nodes.filter(n=>n.f).reduce((a,n)=>a+n.cap,0);
  const st=(v,k,c,sym)=>`<div class="card stat">${sym?`<button class="v ${c}" data-sym="${esc(sym)}">${v}</button>`:`<div class="v ${c}">${v}</div>`}<div class="k">${k}</div></div>`;
  $("stats").innerHTML=st(nodes.filter(n=>n.f).length,"Companies","")+st(fmtCap(tot),"Total market cap","")+st(fmtPctA(e.c),`${M.etf} · ${TF()[1]}`,cls(e.c))+st(adv,"Gainers","up")+st(dec,"Decliners","down")+
    (drag&&drag.impact<0?st(esc(drag.sym),`Top drag · ${fmtBp(drag.impact)}`,"down",drag.sym):lift?st(esc(lift.sym),`Top lift · ${fmtBp(lift.impact)}`,"up",lift.sym):"");
  $("stats").querySelectorAll("button[data-sym]").forEach(b=>b.addEventListener("click",()=>pick(b.dataset.sym)));
}
function renderBrief(){
  const v=nodes.filter(n=>n.chg!=null),e=ETF[M.etf];if(!v.length)return;
  const adv=v.filter(n=>n.chg>0).length,dec=v.filter(n=>n.chg<0).length,unch=v.length-adv-dec;
  const sw=v.reduce((a,n)=>a+n.w,0),wm=v.reduce((a,n)=>a+n.w*n.chg,0)/sw,eq=v.reduce((a,n)=>a+n.chg,0)/v.length;
  const byImp=[...v].sort((a,b)=>a.impact-b.impact),drags=byImp.slice(0,2),lifts=byImp.slice(-2).reverse();
  const byChg=[...v].sort((a,b)=>b.chg-a.chg),best=byChg[0],worst=byChg[byChg.length-1];const secs=secRows();
  const nm=n=>`<b>${esc(n.sym)}</b>`;const T=TF()[3];const Tc=T.charAt(0).toUpperCase()+T.slice(1);
  const breadth=(wm<0&&adv>dec)?`More stocks rose (${adv}) than fell (${dec}), so the selling is concentrated in a few heavyweights.`:(wm>0&&dec>adv)?`More stocks fell (${dec}) than rose (${adv}), so the gain is carried by a few heavyweights.`:`Breadth agrees with the move: ${adv} up, ${dec} down.`;
  const items=[[wm<0?"▼":"▲",`${Tc}, the ${esc(M.name)} is <b class="${cls(wm)}">${fmtPct(wm)}</b> on a weighted basis and ${M.etf} is <b class="${cls(e.c)}">${fmtPct(e.c)}</b>. The average stock is ${fmtPct(eq)}.`],["≈",breadth],
    ["▼",`Biggest drags: ${nm(drags[0])} (${fmtPct(drags[0].chg)}, ${fmtBp(drags[0].impact)}) and ${nm(drags[1])} (${fmtPct(drags[1].chg)}, ${fmtBp(drags[1].impact)}).`],
    ["▲",`Biggest lifts: ${nm(lifts[0])} (${fmtPct(lifts[0].chg)}, ${fmtBp(lifts[0].impact)}) and ${nm(lifts[1])} (${fmtPct(lifts[1].chg)}, ${fmtBp(lifts[1].impact)}).`],
    ["★",`Best stock ${nm(best)} ${fmtPct(best.chg)}; worst ${nm(worst)} ${fmtPct(worst.chg)}.`],
    ["◧",`Strongest sector ${SECTOR[secs[0].s]} (${fmtPct(secs[0].mv)}); weakest ${SECTOR[secs[secs.length-1].s]} (${fmtPct(secs[secs.length-1].mv)}).`]];
  $("briefList").innerHTML=items.map(([i,t])=>`<li><i aria-hidden="true">${i}</i><span>${t}</span></li>`).join("");
  $("bSub").textContent=`${M.name}, change over ${TF()[2]}, written from the data.`;
  const tile=(k,v,s,c)=>`<div class="stat"><div class="k">${k}</div><div class="v ${c}">${v}</div><div class="k">${s}</div></div>`;
  $("bside").innerHTML=tile(`${M.etf} · ${TF()[1]}`,fmtPctA(e.c),fmtPx(e.p),cls(e.c))+tile("Weighted move",fmtPctA(wm),"average stock "+fmtPct(eq),cls(wm))+
    `<div class="stat" style="grid-column:1/-1"><div class="k">Breadth</div><div class="v"><span class="up">${adv} up</span> · <span class="down">${dec} down</span></div><div class="bread" role="img" aria-label="${adv} up, ${unch} unchanged, ${dec} down"><i style="width:${adv/v.length*100}%;background:var(--up)"></i><i style="width:${unch/v.length*100}%;background:var(--flat)"></i><i style="width:${dec/v.length*100}%;background:var(--down)"></i></div></div>`;
}
function renderMovers(){
  const v=nodes.filter(n=>n.f&&n.chg!=null);const up=v.filter(n=>n.impact>0).sort((a,b)=>b.impact-a.impact).slice(0,10),dn=v.filter(n=>n.impact<0).sort((a,b)=>a.impact-b.impact).slice(0,10);
  const mx=Math.max(0.01,...up.map(n=>n.impact),...dn.map(n=>-n.impact));
  const list=(a,c)=>a.map(n=>`<button class="mv" data-sym="${esc(n.sym)}" aria-label="${esc(n.sym)} ${fmtBp(n.impact)}"><span class="t">${esc(n.sym)}</span><span class="tr" aria-hidden="true"><i style="width:${Math.abs(n.impact)/mx*100}%;background:var(--${c})"></i></span><span class="v ${c}">${fmtBp(n.impact)}</span></button>`).join("")||'<p class="sub">None in view</p>';
  $("push").innerHTML=`<div class="mvh up"><span>▲ Pushing up</span><span>top 10 ${fmtBp(up.reduce((a,n)=>a+n.impact,0))}</span></div>`+list(up,"up");
  $("drag").innerHTML=`<div class="mvh down"><span>▼ Dragging down</span><span>top 10 ${fmtBp(dn.reduce((a,n)=>a+n.impact,0))}</span></div>`+list(dn,"down");
  $("mSub").textContent=`Impact over ${TF()[2]}: each stock's index weight times its move. 100 bp equals a 1% move in the ${M.name}.`;
  document.querySelectorAll(".mv[data-sym]").forEach(r=>r.addEventListener("click",()=>pick(r.dataset.sym)));
}
function renderHeat(){
  $("heat").innerHTML=secRows().map(r=>`<button class="ht ${S.solo&&S.solo!==r.s?"off":""}" data-s="${r.s}" aria-pressed="${S.solo===r.s}" style="--tint:${S.color==="sector"?hexOf(SECC[r.s]):r.mv>=0?"var(--up)":"var(--down)"}" aria-label="${SECTOR[r.s]}, ${r.n} stocks, ${fmtPct(r.mv)}"><span class="nm"><i></i>${SECTOR[r.s]}<em>${r.n} · ${r.w.toFixed(0)}%</em></span><span class="pc ${cls(r.mv)}">${fmtPctA(r.mv)}</span></button>`).join("");
}
$("heat").addEventListener("click",e=>{const b=e.target.closest(".ht");if(!b)return;S.solo=S.solo===b.dataset.s?null:b.dataset.s;S.page=0;refresh();if(S.solo)$("stage").scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"center"});});
const COLS=[["sym","Ticker"],["name","Company"],["sec","Sector"],["price","Price"],["chg","Change"],["cap","Market cap"],["w","Weight"],["impact","Impact"]];
function renderTable(){
  const t=$("tbl");
  t.tHead.innerHTML="<tr>"+COLS.map(([k,l])=>`<th scope="col" aria-sort="${S.sortKey===k?(S.sortDir>0?"ascending":"descending"):"none"}"><button data-k="${k}">${k==="chg"?"Change "+TF()[1]:k==="impact"?"Impact "+TF()[1]:l}${S.sortKey===k?(S.sortDir>0?" ▲":" ▼"):""}</button></th>`).join("")+"</tr>";
  const v=nodes.filter(n=>n.f).sort((a,b)=>{const k=S.sortKey;let x=a[k],y=b[k];if(x==null)x=-1e9;if(y==null)y=-1e9;return typeof x==="string"?x.localeCompare(y)*S.sortDir:(x-y)*S.sortDir;});
  t.tBodies[0].innerHTML=v.map(n=>`<tr data-sym="${esc(n.sym)}" tabindex="0" class="${S.sel===n?"sel":""}"><td>${esc(n.sym)}</td><td>${esc(n.name)}${n.alt?` <span style="color:var(--muted)">(incl. ${esc(n.alt)})</span>`:""}</td><td><span class="tdot" style="background:${hexOf(SECC[n.sec])}"></span>${SECTOR[n.sec]}</td><td>${fmtPx(n.price)}</td><td class="${cls(n.chg)}">${fmtPctA(n.chg)}</td><td>${fmtCap(n.cap)}</td><td>${n.w.toFixed(2)}%</td><td class="${cls(n.impact)}">${n.chg==null?"n/a":fmtBp(n.impact)}</td></tr>`).join("");
  $("tSub").textContent=`${v.length} stocks in ${M.name}, change over ${TF()[2]}. Sort with the column headers; press Enter on a row for details.`;
  $("tCap").textContent=`${M.name} stocks sorted by ${COLS.find(c=>c[0]===S.sortKey)[1]}`;
}
$("tbl").addEventListener("click",e=>{const b=e.target.closest("th button");
  if(b){const k=b.dataset.k;if(S.sortKey===k)S.sortDir*=-1;else{S.sortKey=k;S.sortDir=["sym","name","sec"].includes(k)?1:-1;}renderTable();$("tbl").querySelector(`th button[data-k="${k}"]`).focus();return;}
  const tr=e.target.closest("tr[data-sym]");if(tr)pick(tr.dataset.sym);});
$("tbl").addEventListener("keydown",e=>{const tr=e.target.closest("tr[data-sym]");if(!tr)return;if(e.key==="Enter"||e.key===" "){e.preventDefault();pick(tr.dataset.sym);}else if(e.key==="ArrowDown"){e.preventDefault();tr.nextElementSibling?.focus();}else if(e.key==="ArrowUp"){e.preventDefault();tr.previousElementSibling?.focus();}});

/* ---------- wiring ---------- */
function refresh(){
  nodes.forEach(n=>n.f=passes(n));if(S.sel&&!S.sel.f)S.sel=null;
  const pool=pagePool(),L=limitN(),np=L?Math.max(1,Math.ceil(pool.length/L)):1;if(S.page>=np)S.page=np-1;if(S.page<0)S.page=0;
  const keep=new Set(L?pool.slice(S.page*L,S.page*L+L):pool);if(S.sel)keep.add(S.sel);nodes.forEach(n=>n.on=keep.has(n));
  targets();renderStats();renderSecs();renderDetails();renderMovers();renderHeat();renderTable();renderPages();wake();
  const shown=nodes.filter(n=>n.on).length,passed=pool.length;
  $("cnt").textContent=L&&passed>L?`Stocks ${S.page*L+1}–${Math.min(passed,S.page*L+L)} of ${passed} by size`:`${shown} stocks`;
  $("empty").hidden=shown>0;
}
sheetMode.addEventListener("change",()=>renderDetails());
const syncHint=()=>{$("hint").textContent=matchMedia("(pointer:coarse)").matches?"Tap a bubble for details":"Click a bubble for details · drag to move it";};syncHint();
readC();applyTheme();renderStamp();setInterval(renderStamp,60000);
new ResizeObserver(()=>resize()).observe(cv);
resize();loadMarket(S.market);
for(let i=0;i<300;i++)step();
draw();loop();
if(START_HASH==="#about")openAbout(true);

/* ---------- live refresh: re-read data.json every 2 minutes, update in place when it changed ---------- */
function applyData(d){
  if(!d||!d.asOf||!d.spx||d.asOf===DATA.asOf)return false;
  for(const k of ["spx","ndx","dow","rut","etf"])if(Array.isArray(d[k]))DATA[k]=d[k];
  DATA.asOf=d.asOf;SNAP=new Date(d.asOf);ETF=mkETF(DATA);
  for(const m of MARKETS)if(!m.soon)m.rows=DATA[m.id];
  const map=Object.fromEntries(M.rows.map(r=>[r[0],r]));
  for(const n of nodes){const r=map[n.sym];if(!r)continue;n.price=r[2];n.chgs=r[3];n.cap=r[4];n.w=r[5];}
  [...nodes].sort((a,b)=>b.cap-a.cap).forEach((n,i)=>n.capRank=i+1);
  applyTF(true);refresh();renderMkts();renderStamp();sprites.clear();wake(60);
  announce("Prices updated");return true;
}
async function pollData(){
  if(document.hidden)return;
  const url=(window.GT_CONFIG||{}).dataUrl;if(!url)return;
  try{const r=await fetch(url+"?t="+Math.floor(Date.now()/60000),{cache:"no-store"});if(r.ok)applyData(await r.json());}catch(e){}
}
setInterval(pollData,120000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)pollData();});
