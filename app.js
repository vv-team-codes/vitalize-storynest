/* ekiddy.com — standalone, built-in engine. No API keys, no limits, localStorage only. */
const LS='vsn_state_v1';
let state=load();
let current=null; // current book being edited
let reader={book:null,idx:0};
let storyboard=[];
let storyStyle='Storybook Illustration';
function load(){try{const s=JSON.parse(localStorage.getItem(LS));if(s&&s.projects)return s}catch(e){}return{projects:[],characters:[],history:[],providers:{},theme:'indigo',library:[]};}
/* v15: generated pictures are BIG — each is a data URL of ~2MB, so a
   4-page book is ~8MB, but localStorage holds only about 5MB. The old
   save() threw at setItem and the save silently failed: the header
   counter never updated and the book vanished on reload (only the
   in-memory copy was ever visible). Pictures now live in IndexedDB
   (large quota); localStorage keeps only a small 'idb:<bookId>' marker
   per picture, and save() can never throw — the counter always updates. */
const IDB_NAME='vsn_images_v1', IDB_STORE='imgs';
let _idbP=null;
function idbOpen(){
  if(_idbP) return _idbP;
  _idbP=new Promise(function(res,rej){
    try{
      const rq=indexedDB.open(IDB_NAME,1);
      rq.onupgradeneeded=function(){ try{ rq.result.createObjectStore(IDB_STORE); }catch(e){} };
      rq.onsuccess=function(){ res(rq.result); };
      rq.onerror=function(){ rej(rq.error||new Error('idb open failed')); };
    }catch(e){ rej(e); }
  });
  _idbP.catch(function(){ _idbP=null; });
  return _idbP;
}
function idbPut(key,val){
  return idbOpen().then(function(db){
    return new Promise(function(res,rej){
      try{
        const tx=db.transaction(IDB_STORE,'readwrite');
        tx.objectStore(IDB_STORE).put(val,key);
        tx.oncomplete=function(){ res(); };
        tx.onerror=function(){ rej(tx.error||new Error('idb put failed')); };
      }catch(e){ rej(e); }
    });
  });
}
function idbGet(key){
  return idbOpen().then(function(db){
    return new Promise(function(res,rej){
      try{
        const tx=db.transaction(IDB_STORE,'readonly');
        const rq=tx.objectStore(IDB_STORE).get(key);
        rq.onsuccess=function(){ res(rq.result); };
        rq.onerror=function(){ rej(rq.error||new Error('idb get failed')); };
      }catch(e){ rej(e); }
    });
  });
}
function idbDel(key){
  return idbOpen().then(function(db){
    return new Promise(function(res){
      try{
        const tx=db.transaction(IDB_STORE,'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete=function(){ res(); };
        tx.onerror=function(){ res(); };
      }catch(e){ res(); }
    });
  }).catch(function(){});
}
function isGenImg(u){return typeof u==='string'&&u.indexOf('data:image/')===0&&u.indexOf('data:image/svg+xml')!==0;}
function isIdbMarker(u){return typeof u==='string'&&u.indexOf('idb:')===0;}
/* Split a book into a small localStorage copy (markers) + an IndexedDB
   record of its generated pictures. Never mutates the live book. */
const _imgQueue={};
function lightCopyBook(b){
  if(!b||(!b.pages&&!b.panels)) return b;
  const c={}; for(const k in b) c[k]=b[k];
  const imgs={};
  if(b.pages) c.pages=b.pages.map(function(p){
    if(!isGenImg(p.img)) return p;
    imgs['p'+p.n]=p.img;
    const q={}; for(const k in p) q[k]=p[k];
    q.img='idb:'+b.id;
    return q;
  });
  if(b.panels) c.panels=b.panels.map(function(p){
    if(!isGenImg(p.img)) return p;
    imgs['c'+p.n]=p.img;
    const q={}; for(const k in p) q[k]=p[k];
    q.img='idb:'+b.id;
    return q;
  });
  if(typeof b.qvCharImg==='string'&&b.qvCharImg.indexOf('data:image/')===0){ imgs['charImg']=b.qvCharImg; c.qvCharImg='idb:'+b.id; }
  if(Object.keys(imgs).length) _imgQueue[b.id]=Object.assign({},_imgQueue[b.id]||{},imgs);
  return c;
}
function stripBookImgs(b){
  if(!b) return;
  if(typeof b.qvCharImg==='string'&&b.qvCharImg.indexOf('idb:')===0) b.qvCharImg='';
  if(b.pages) b.pages.forEach(function(p){ if(isGenImg(p.img)||isIdbMarker(p.img)) p.img=''; });
  if(b.panels) b.panels.forEach(function(p){ if(isGenImg(p.img)||isIdbMarker(p.img)) p.img=''; });
}
function save(){
  let light=null;
  try{
    light={projects:state.projects.map(lightCopyBook),characters:state.characters,history:state.history,providers:state.providers,theme:state.theme,library:state.library.map(lightCopyBook)};
    Object.keys(_imgQueue).forEach(function(id){ const rec=_imgQueue[id]; delete _imgQueue[id]; idbPut(id,rec).catch(function(){}); });
    localStorage.setItem(LS,JSON.stringify(light));
  }catch(e){
    try{
      if(light){ light.projects.forEach(stripBookImgs); light.library.forEach(stripBookImgs); localStorage.setItem(LS,JSON.stringify(light)); }
    }catch(e2){}
  }
  renderCounts();
}
/* Restore a book's generated pictures from IndexedDB (markers become
   real pictures again; a missing picture falls back to the built-in
   illustration, never a broken image). */
async function hydrateBook(b){
  if(!b) return b;
  const lists=[];
  if(b.pages) lists.push(b.pages);
  if(b.panels) lists.push(b.panels);
  let need=false;
  lists.forEach(function(ps){ ps.forEach(function(p){ if(isIdbMarker(p.img)) need=true; }); });
  if(typeof b.qvCharImg==='string'&&b.qvCharImg.indexOf('idb:')===0) need=true;
  if(!need) return b;
  let rec=null;
  try{ rec=await idbGet(b.id); }catch(e){ rec=null; }
  lists.forEach(function(ps){
    ps.forEach(function(p){
      if(!isIdbMarker(p.img)) return;
      const kind=(ps===b.panels)?'c':'p';
      const v=rec&&rec[kind+p.n];
      if(typeof v==='string'&&v.indexOf('data:image/')===0){ p.img=v; }
      else { try{ p.img=makeSVG(p,b.style||'Storybook Illustration'); }catch(e){ p.img=''; } }
    });
  });
  if(typeof b.qvCharImg==='string'&&b.qvCharImg.indexOf('idb:')===0){
    var cv=rec&&rec['charImg'];
    if(typeof cv==='string'&&cv.indexOf('data:image/')===0) b.qvCharImg=cv; else b.qvCharImg='';
  }
  return b;
}
function hydrateAll(){
  const books=state.projects.concat(state.library);
  Promise.all(books.map(function(b){ return hydrateBook(b).catch(function(){ return b; }); })).then(function(){
    renderProjects(); renderLibrary(); renderSimpleHome(); renderDashboard();
    if(current){ renderBookOut(); renderEditor(); renderIllus(); }
  });
}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function uid(){return 'id'+Date.now().toString(36)+Math.floor(Math.random()*999);}
function go(p,push){try{if('speechSynthesis' in window)speechSynthesis.cancel();}catch(e){}document.body.classList.remove('reading-aloud');/* v10: defence in depth — while signed out, any navigation past the
  welcome hero goes to Google sign-in instead (auth.js capture handler is
  the first line of defence; this stops programmatic go() calls too). */
  if(p!=='home'&&!document.body.classList.contains('signed-in')){if(window.startGoogleSignIn)window.startGoogleSignIn();return;}
  document.body.classList.toggle('on-home',p==='home');var mm=document.getElementById('moreMenu');if(mm)mm.classList.remove('open');document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));document.querySelectorAll('#bottomnav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));document.querySelectorAll('.page').forEach(s=>s.classList.remove('active'));const el=document.getElementById('page-'+p);if(el)el.classList.add('active');const nav=document.getElementById('nav');if(nav)nav.classList.remove('open');const mb=document.getElementById('menuBtn');if(mb)mb.setAttribute('aria-expanded','false');if(p==='library')renderLibrary();if(p==='projects')renderProjects();if(p==='dashboard')renderDashboard();if(p==='admin')renderAdmin();if(p==='settings')renderProviders();if(p==='home'){renderHome();renderSimpleHome();}window.scrollTo({top:0,behavior:(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)?'auto':'smooth'});if(push!==false){try{history.pushState({page:p},'');}catch(e){}}}
/* v13: the browser Back button works too — every go() pushes a history
   entry, and Back pops to the previous section. The on-screen ← Back
   button is go('home'). Going back never loses work: go() only switches
   which section is visible; the generated storyboard / book / story
   stays in memory and is still there on re-entry. */
window.addEventListener('popstate',function(e){const p=(e.state&&e.state.page)||'home';go(p,false);});
try{history.replaceState({page:'home'},'');}catch(e){}
function toggleMenu(){const nav=document.getElementById('nav');const b=document.getElementById('menuBtn');if(nav)nav.classList.toggle('open');if(b&&nav)b.setAttribute('aria-expanded',String(nav.classList.contains('open')));}
function toggleMoreMenu(){const m=document.getElementById('moreMenu');if(m)m.classList.toggle('open');}
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;const b=document.getElementById('installBtn');if(b)b.style.display='inline-block';});
async function installApp(){
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();const r=await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;if(r&&r.outcome==='accepted')return;}
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  alert(isIOS?'To install on iPhone/iPad: tap Share (⬆) in Safari, then "Add to Home Screen".':'To install: open the browser menu (⋮) and tap "Install app" / "Add to Home screen". If that option is missing, make sure you opened the site in Chrome.');
}
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{});});}
document.querySelectorAll('#nav button').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
/* v12: button click animations — a ripple at the tap point on every button,
   plus clearing the hero cards' entrance animation once it has played so
   hover-lift / :active press work afterwards. 150–250ms, and skipped
   entirely under prefers-reduced-motion. */
(function(){
  const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduced){
    setTimeout(()=>{document.querySelectorAll('.hero-card').forEach(c=>c.classList.add('entrance-done'));},1000);
    document.addEventListener('click',function(e){
      const t=e.target.closest?e.target.closest('button, a.btn, .chip'):null;
      if(!t||t.disabled)return;
      const r=t.getBoundingClientRect(); const d=Math.max(r.width,r.height)*2.2;
      const s=document.createElement('span'); s.className='ripple'+(t.classList.contains('primary')||t.classList.contains('hero-cta')||t.classList.contains('getstarted-btn')?' light':'');
      s.style.width=s.style.height=d+'px';
      s.style.left=((e.clientX||r.left+r.width/2)-r.left-d/2)+'px';
      s.style.top=((e.clientY||r.top+r.height/2)-r.top-d/2)+'px';
      t.appendChild(s); setTimeout(()=>{s.remove();},300);
    });
  }
})();
function renderCounts(){const p=document.getElementById('countPill');if(p)p.textContent=state.projects.length+(state.projects.length===1?' project · ':' projects · ')+state.characters.length+(state.characters.length===1?' character':' characters');}
function logHistory(kind,detail){state.history.unshift({kind,detail,at:new Date().toISOString()});state.history=state.history.slice(0,100);save();}

/* ---------- Story engine ---------- */
const IDEAS=["Luna the Moon Rabbit finds a glowing lantern and learns to share its light","Milo the fox follows a friendly firefly across the meadow","Ellie the baby elephant plants a garden that sings","Pip the sparrow delivers a lost letter to the clouds","A brave little turtle teaches the river to slow down","Meena and the singing garden in a Tamil village","Bolt and Pip build a kite that flies to the clouds","A sleepy star falls into a teapot and learns to shine again"];
const TYPES={Adventure:['a brave journey','a hidden path','a kind helper','a safe return home'], 'Fairy Tale':['a magical gift','an enchanted forest','a gentle spell','a happy ending'], Bedtime:['a sleepy moon','a soft blanket of stars','a quiet lullaby','a peaceful sleep'], Educational:['a curious question','a careful experiment','a new discovery','a lesson to share'], Fantasy:['a floating island','a talking river','a door in a tree','a world of wonder'], Funny:['a silly mix-up','a laughing crowd','a wobbly plan','a joyful surprise'], 'Moral Story':['a selfish choice','a moment of kindness','a hard apology','a shared reward'], Friendship:['a lonely morning','a new friend','a promise kept','a celebration together'], Family:['a family recipe','a grandmother\'s story','a helping hand','a warm home'], Animals:['a forest meeting','a river crossing','a mountain climb','a nest full of friends']};
const MORALS={'Adventure':'Courage grows when we take one small brave step at a time.','Fairy Tale':'Kindness is the truest magic of all.','Bedtime':'Rest helps us grow, dream and wake up ready to play.','Educational':'Asking questions is how we learn.','Fantasy':'Imagination can turn an ordinary day into an adventure.','Funny':'Laughter makes hard days lighter.','Moral Story':'Sharing and honesty make everyone happier.','Friendship':'A true friend listens, helps and keeps promises.','Family':'Family love grows when we help each other.','Animals':'Every creature, big or small, matters.'};
const LANG_TA={title:'கதை',moral:'நீதி: அன்பும் பகிர்வும் எல்லோரையும் மகிழ்விக்கும்.',open:'ஒரு அழகான காலை, '};
function suggestIdeas(){const el=document.getElementById('ideaList');el.innerHTML=IDEAS.map(i=>'<button class="chip" onclick="pickIdea(this)">'+esc(i)+'</button>').join('');}
function pickIdea(b){document.getElementById('bkIdea').value=b.textContent;}
function randomIdea(){document.getElementById('bkIdea').value=IDEAS[Math.floor(Math.random()*IDEAS.length)];}
function uploadManuscript(e){const f=e.target.files&&e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{document.getElementById('bkManuscript').value=r.result;};r.readAsText(f);}
function useManuscript(){const m=document.getElementById('bkManuscript').value.trim();if(m)document.getElementById('bkIdea').value=m.slice(0,140);}
function bibleText(c){c=c||state.characters[0]||{name:document.getElementById('chName').value,kind:document.getElementById('chKind').value,face:document.getElementById('chFace').value,hair:document.getElementById('chHair').value,outfit:document.getElementById('chOutfit').value,colors:document.getElementById('chColors').value,acc:document.getElementById('chAcc').value,expr:document.getElementById('chExpr').value};return c.name+' — '+c.kind+'; face: '+c.face+'; hair/fur: '+c.hair+'; outfit: '+c.outfit+'; colours: '+c.colors+'; accessories: '+c.acc+'; expression: '+c.expr+'. SAME character in every scene — do not change face, hair, outfit or colours.';}
function generateBook(){
  const idea=document.getElementById('bkIdea').value.trim()||IDEAS[0];
  const manuscript=document.getElementById('bkManuscript').value.trim();
  const age=document.getElementById('bkAge').value, type=document.getElementById('bkType').value, lang=document.getElementById('bkLang').value;
  const n=Math.max(4,Math.min(12,parseInt(document.getElementById('bkPages').value)||6));
  const style=document.getElementById('bkStyle').value, hero=document.getElementById('bkHero').value.trim()||'Luna';
  const beats=TYPES[type]||TYPES.Adventure;
  const title=hero+' and the '+beats[1].replace(/^a /,'').replace(/^an /,'').split(' ').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
  const desc='A '+type.toLowerCase()+' picture book for ages '+age+' about '+hero+', who discovers '+beats[0]+' and learns that '+MORALS[type].toLowerCase();
  const pages=[];
  const openers=['One bright morning, ','In a quiet corner of the forest, ','Under a sky full of soft clouds, ','One day, when the wind was gentle, ','At the edge of a sparkling river, ','When the moon first peeked out, '];
  for(let i=0;i<n;i++){
    const beat=beats[i%beats.length];
    let text;
    if(i===0) text=openers[0]+hero+' woke up with a big idea. Today would be the day to try '+beats[0]+'.';
    else if(i===n-1) text='At last, '+hero+' smiled. Everything had worked out, and the lesson stayed warm in '+hero+'\'s heart: '+MORALS[type];
    else text=hero+' met '+beats[1]+' and faced '+beats[2]+'. With a brave heart and a kind friend, '+hero+' kept going, step by step.';
    if(lang==='ta') text=(i===0?LANG_TA.open:'')+hero+' '+beats[0]+' கற்றுக்கொண்டார். '+MORALS[type]+' — '+text;
    pages.push({n:i+1,text,scene:hero+' in a '+(type==='Bedtime'?'moonlit meadow':'sunny meadow')+', '+beats[i%beats.length]+', soft light, gentle colours',prompt:'',img:''});
  }
  if(manuscript){pages[0].text=manuscript.slice(0,280);}
  current={id:uid(),kind:'book',title,desc,moral:MORALS[type],age,type,lang,pages,style,hero,characters:[bibleText()],created:new Date().toISOString(),shared:false};
  logHistory('story','Generated "'+title+'" ('+n+' pages, '+type+', '+lang+')');
  save();
  /* v13: pictures appear WITH the book, instantly — every page gets
     its built-in illustration right here, so the book never looks
     picture-less. illustrateAll() below then UPGRADes each page to
     the site's own image service in the
     background, one at a time with progress. Step 5 buttons still
     work for re-doing them. */
  current.pages.forEach(function(p){p.img=makeSVG(p,current.style);p.prompt=p.scene+' — '+bibleText()+' — style: '+current.style;});
  save(); bookPageIdx=0; bookShowAll=false; renderBookOut(); renderEditor(); applyBible();
  illustrateAll();
  document.querySelectorAll('.step').forEach(s=>s.classList.toggle('on',+s.dataset.s<=3));
}
/* v30: Step 3 shows ONE page at a time with Previous / Next buttons, so
   the page always fits the device screen — the old stacked list made
   every illustration ~800px tall and the first screen showed only sky.
   "Show all pages" restores the full list (used by PDF export too). */
let bookPageIdx=0, bookShowAll=false;
function bookPrev(){if(!current)return;if(bookPageIdx>0){bookPageIdx--;renderBookOut();}}
function bookNext(){if(!current)return;if(bookPageIdx<current.pages.length-1){bookPageIdx++;renderBookOut();}}
function bookToggleAll(){bookShowAll=!bookShowAll;renderBookOut();}
function bookPageHTML(p,i,font,bg){
  return '<div class="book-page" style="font-family:'+esc(font)+';background:'+esc(bg)+'"><strong>Page '+p.n+'</strong>'+(p.img?'<img src="'+p.img+'" alt="Page illustration">':'')+'<p class="book-caption">Scene: '+esc(p.scene)+'</p><p>'+esc(p.text)+'</p><div class="row"><button class="btn" onclick="regenPage('+i+')">↻ Regenerate this page</button><button class="btn" onclick="editPageText('+i+')">✏ Edit text</button></div></div>';
}
function renderBookOut(all){
  const out=document.getElementById('bookOut'); if(!current){out.innerHTML='<p class="muted">No book generated yet.</p>';return;}
  const font=document.getElementById('edFont')?document.getElementById('edFont').value:'Georgia, serif';
  const bg=document.getElementById('edBg')?document.getElementById('edBg').value:'#fff8ec';
  const showAll=all===true||bookShowAll;
  if(bookPageIdx>=current.pages.length)bookPageIdx=0;
  if(bookPageIdx<0)bookPageIdx=0;
  out.innerHTML='<h3>'+esc(current.title)+'</h3><p>'+esc(current.desc)+'</p><p><strong>Moral:</strong> '+esc(current.moral)+'</p><p><strong>Characters:</strong> '+esc(current.characters.join(' | '))+'</p>'+
  (showAll
    ? current.pages.map((p,i)=>bookPageHTML(p,i,font,bg)).join('')
    : bookPageHTML(current.pages[bookPageIdx],bookPageIdx,font,bg)
      +'<div class="book-pager"><button class="btn" onclick="bookPrev()"'+(bookPageIdx===0?' disabled':'')+'>← Previous</button><span class="muted"><strong>Page '+(bookPageIdx+1)+' of '+current.pages.length+'</strong></span><button class="btn primary" onclick="bookNext()"'+(bookPageIdx>=current.pages.length-1?' disabled':'')+'>Next →</button></div>')
  +'<div class="row"><button class="btn" onclick="bookToggleAll()">'+(showAll?'Show one page at a time':'Show all pages')+'</button></div>';
}
function regenPage(i){if(!current)return;const beats=TYPES[current.type]||TYPES.Adventure;const b=beats[(i+2)%beats.length];current.pages[i].text=current.pages[i].n===current.pages.length?current.pages[i].text:current.hero+' discovered '+b+' and smiled — a small brave step, and then another.';current.pages[i].scene=current.hero+', '+b+', soft light';current.pages[i].img=makeSVG(current.pages[i],current.style);current.pages[i].prompt=current.pages[i].scene+' — '+bibleText()+' — style: '+current.style;save();renderBookOut();renderEditor();}
function editPageText(i){const t=prompt('Edit page text:',current.pages[i].text);if(t!=null){current.pages[i].text=t;save();renderBookOut();renderEditor();}}
function renderEditor(){const out=document.getElementById('editorOut');if(!current){out.innerHTML='';return;}out.innerHTML=current.pages.map((p,i)=>'<div class="book-page"><strong>Page '+p.n+'</strong>'+(p.img?'<img src="'+p.img+'" alt="Page illustration">':'<p class="muted small">No illustration yet — use Step 5.</p>')+'<textarea rows="2" onchange="current.pages['+i+'].text=this.value;save()">'+esc(p.text)+'</textarea><div class="row"><button class="btn" onclick="illustratePage('+i+')">🎨 Illustrate</button><button class="btn" onclick="deletePage('+i+')">Delete page</button></div></div>').join('');}
function addPage(){if(!current)return alert('Generate a book first.');current.pages.push({n:current.pages.length+1,text:current.hero+' continued the journey, and something wonderful happened.',scene:current.hero+' on a sunny path',prompt:'',img:''});save();renderBookOut();renderEditor();}
function deletePage(i){if(!current||current.pages.length<=1)return;current.pages.splice(i,1);current.pages.forEach((p,j)=>p.n=j+1);save();renderBookOut();renderEditor();}
function saveCurrentBook(){if(!current)return alert('Generate a book first.');const ex=state.projects.findIndex(p=>p.id===current.id);if(ex>=0)state.projects[ex]=current;else state.projects.unshift(current);logHistory('save','Saved "'+current.title+'"');save();renderProjects();alert('Saved to My Projects.');}

/* ---------- Story (text-only tale — its own flow, NOT the Picture Book) ----------
   Chapters of prose, no illustrations, no pages. A Story project has
   kind:'story' and chapters:[{n, heading, text}]; the Picture Book flow
   (kind:'book', pages with illustrations) is a different object. */
let currentStory=null;
function suggestStoryIdeas(){const el=document.getElementById('stIdeaList');el.innerHTML=IDEAS.map(i=>'<button class="chip" onclick="pickStoryIdea(this)">'+esc(i)+'</button>').join('');}
function pickStoryIdea(b){document.getElementById('stIdea').value=b.textContent;}
function randomStoryIdea(){document.getElementById('stIdea').value=IDEAS[Math.floor(Math.random()*IDEAS.length)];}
function generateStory(){
  const idea=document.getElementById('stIdea').value.trim()||IDEAS[0];
  const age=document.getElementById('stAge').value, type=document.getElementById('stType').value, lang=document.getElementById('stLang').value;
  const n=Math.max(3,Math.min(6,parseInt(document.getElementById('stChapters').value)||5));
  const hero=document.getElementById('stHero').value.trim()||'Luna';
  const beats=TYPES[type]||TYPES.Adventure;
  const title=hero+' and the '+beats[1].replace(/^a /,'').replace(/^an /,'').split(' ').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
  const desc='A '+type.toLowerCase()+' text story for ages '+age+' about '+hero+', who discovers '+beats[0]+' and learns that '+MORALS[type].toLowerCase();
  const headings=['The Beginning','A Surprise on the Way','A Brave Choice','The Kindest Moment','The Way Home','A Story to Remember'];
  const chapters=[];
  for(let i=0;i<n;i++){
    const beat=beats[i%beats.length];
    let text;
    if(i===0) text='One bright morning, '+hero+' woke up with a big idea. Today would be the day to try '+beats[0]+'. The sun was warm, the birds were singing, and the whole world felt full of promise. '+hero+' packed a little bag, waved goodbye, and set off down the path with a brave, happy heart.';
    else if(i===n-1) text='At last, '+hero+' came home as the stars began to twinkle. Everything had worked out, and the lesson stayed warm in '+hero+'\'s heart: '+MORALS[type]+' From that day on, whenever someone asked about the journey, '+hero+' smiled and told the story all over again.';
    else text=hero+' came to '+beats[1]+' and faced '+beats[2]+'. It was not easy, and for a moment '+hero+' wanted to turn back. But with a brave heart and a kind friend beside them, '+hero+' kept going, step by step, until the way forward was clear again.';
    if(lang==='ta') text=hero+' '+beats[0]+' கற்றுக்கொண்டார். '+text;
    chapters.push({n:i+1,heading:headings[i]||('Chapter '+(i+1)),text});
  }
  currentStory={id:uid(),kind:'story',title,desc,moral:MORALS[type],age,type,lang,hero,chapters,created:new Date().toISOString(),shared:false};
  logHistory('story','Generated text story "'+title+'" ('+n+' chapters, '+type+', '+lang+')');
  save(); renderStoryOut();
}
function renderStoryOut(){
  const out=document.getElementById('storyOut'); if(!out)return;
  if(!currentStory){out.innerHTML='<p class="muted">No story generated yet.</p>';return;}
  out.innerHTML='<h3>'+esc(currentStory.title)+'</h3><p>'+esc(currentStory.desc)+'</p><p><strong>Moral:</strong> '+esc(currentStory.moral)+'</p>'+
    currentStory.chapters.map(c=>'<div class="book-page"><strong>Chapter '+c.n+' — '+esc(c.heading)+'</strong><p style="font-size:17px;line-height:1.7">'+esc(c.text)+'</p></div>').join('');
}
function openStory(id){const b=state.projects.find(p=>p.id===id);if(!b||b.kind!=='story')return;currentStory=b;renderStoryOut();go('story');}
function saveCurrentStory(){if(!currentStory)return alert('Generate a story first.');const ex=state.projects.findIndex(p=>p.id===currentStory.id);if(ex>=0)state.projects[ex]=currentStory;else state.projects.unshift(currentStory);logHistory('save','Saved story "'+currentStory.title+'"');save();renderProjects();renderSimpleHome();alert('Saved to My Projects.');}
function syncReadButtons(){var playing=document.body.classList.contains('reading-aloud');document.querySelectorAll('.readaloud-btn').forEach(function(b){b.textContent=playing?'\u23f9 Stop':'\uD83D\uDD0A Read aloud';});}
function stopReadingAloud(){try{if('speechSynthesis' in window)speechSynthesis.cancel();}catch(e){}document.body.classList.remove('reading-aloud');syncReadButtons();}
function readStoryAloud(){if(document.body.classList.contains('reading-aloud')){stopReadingAloud();return;}if(!currentStory)return alert('Generate a story first.');const u=new SpeechSynthesisUtterance(currentStory.title+'. '+currentStory.chapters.map(c=>'Chapter '+c.n+'. '+c.text).join(' '));u.rate=1;u.onend=function(){document.body.classList.remove('reading-aloud');syncReadButtons();};u.onerror=function(){document.body.classList.remove('reading-aloud');syncReadButtons();};speechSynthesis.cancel();speechSynthesis.speak(u);document.body.classList.add('reading-aloud');syncReadButtons();}
function downloadStoryFile(){if(!currentStory)return alert('Generate a story first.');const txt=currentStory.title+'\n'+currentStory.desc+'\nMoral: '+currentStory.moral+'\n\n'+currentStory.chapters.map(c=>'Chapter '+c.n+' — '+c.heading+'\n'+c.text).join('\n\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));a.download=currentStory.title.replace(/\W+/g,'-')+'.txt';a.click();}

/* ---------- Characters ---------- */
function saveCharacter(){const c={id:uid(),name:document.getElementById('chName').value,kind:document.getElementById('chKind').value,face:document.getElementById('chFace').value,hair:document.getElementById('chHair').value,outfit:document.getElementById('chOutfit').value,colors:document.getElementById('chColors').value,acc:document.getElementById('chAcc').value,expr:document.getElementById('chExpr').value};const ex=state.characters.findIndex(x=>x.name===c.name);if(ex>=0)state.characters[ex]=c;else state.characters.unshift(c);logHistory('character','Saved character '+c.name);save();renderChars();applyBible();}
function renderChars(){const el=document.getElementById('charList');if(el)el.innerHTML=state.characters.map(c=>'<span class="chip">'+esc(c.name)+' · '+esc(c.kind)+'</span>').join('')||'<span class="muted small">No saved characters yet.</span>';}
function applyBible(){const el=document.getElementById('bibleOut');if(el)el.textContent='CHARACTER BIBLE (locked, used in every prompt):\n'+bibleText();const bn=document.getElementById('bibleNote');if(bn)bn.textContent='CHARACTER BIBLE: '+bibleText();if(current)current.characters=[bibleText()];}

/* ---------- Illustrations (procedural SVG, generated from scene + Bible + style) ---------- */
function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
function makeSVG(page,style){
  /* v31: native 16:9 canvas (1200x675) so the picture fills the full width of
     a book-page card with no letterbox gutters. The old 800x600 (4:3) scene
     inside a width:100% + max-height box with object-fit:contain shrank to a
     narrow centred strip (~60% of the card). The scene caption that used to
     be drawn INSIDE the SVG is gone too — it was hard-truncated at 60 chars
     ("...gentle co") and could never wrap. The caption now lives in HTML
     (bookPageHTML / renderReader, .book-caption) where it wraps fully. */
  const h=hash(page.scene+page.text+style);
  const palettes={'Watercolor':['#fde68a','#fbcfe8','#bae6fd','#d1fae5'],'3D Cartoon':['#f59e0b','#fb7185','#60a5fa','#a78bfa'],'Pixar-inspired 3D':['#fbbf24','#f472b6','#38bdf8','#c084fc'],'Storybook Illustration':['#fde68a','#fca5a5','#93c5fd','#86efac'],'Disney-inspired Fairy Tale':['#f9a8d4','#fde68a','#a5b4fc','#fda4af'],'Anime':['#fda4af','#93c5fd','#fde68a','#c4b5fd'],'Clay Animation':['#fdba74','#fca5a5','#93c5fd','#fde68a'],'Paper Cut':['#f87171','#60a5fa','#fbbf24','#34d399'],'Hand Drawn':['#fef3c7','#fecdd3','#dbeafe','#e9d5ff'],'Digital Painting':['#c7d2fe','#fbcfe8','#fde68a','#bae6fd']};
  const pal=palettes[style]||palettes['Storybook Illustration'];
  const c1=pal[h%4],c2=pal[(h+1)%4],c3=pal[(h+2)%4],c4=pal[(h+3)%4];
  const night=h%3===0;
  const skyTop=night?'#3730a3':'#bae6fd', skyBot=night?'#1e1b4b':'#fff7d6';
  const sunX=990+(h%50), sunY=72+((h>>2)%24);
  const cl1x=130+(h%170), cl2x=620+((h>>3)%190);
  const flX=[140,260,430,770,950,1080], flC=[c1,c4,'#f472b6','#fbbf24',c3,'#fb7185'];
  const stars=night?'<circle cx="180" cy="70" r="4" fill="#fff"/><circle cx="360" cy="120" r="3" fill="#fef9c3"/><circle cx="780" cy="60" r="4" fill="#fff"/><circle cx="620" cy="130" r="3" fill="#fef9c3"/><circle cx="1090" cy="170" r="3" fill="#fff"/>':'';
  const sunMoon=night?'<circle cx="'+sunX+'" cy="'+sunY+'" r="44" fill="#fef9c3"/><circle cx="'+(sunX+18)+'" cy="'+(sunY-11)+'" r="7" fill="#eab308" opacity="0.5"/><circle cx="'+(sunX-13)+'" cy="'+(sunY+13)+'" r="5" fill="#eab308" opacity="0.5"/>':'<circle cx="'+sunX+'" cy="'+sunY+'" r="46" fill="#ffd52e"/><circle cx="'+sunX+'" cy="'+sunY+'" r="64" fill="#ffd52e" opacity="0.25"/>';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">'
  +'<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+skyTop+'"/><stop offset="1" stop-color="'+skyBot+'"/></linearGradient></defs>'
  +'<rect width="1200" height="675" fill="url(#sky)"/>'+stars+sunMoon
  +'<g fill="#ffffff" opacity="0.9"><ellipse cx="'+cl1x+'" cy="120" rx="78" ry="26"/><ellipse cx="'+(cl1x+52)+'" cy="104" rx="52" ry="22"/><ellipse cx="'+cl2x+'" cy="80" rx="68" ry="22"/><ellipse cx="'+(cl2x+46)+'" cy="66" rx="44" ry="18"/></g>'
  +'<g stroke="#334155" stroke-width="4" fill="none" stroke-linecap="round"><path d="M270 165 q10 -10 20 0 q10 -10 20 0"/><path d="M860 145 q10 -10 20 0 q10 -10 20 0"/></g>'
  +'<ellipse cx="600" cy="600" rx="700" ry="110" fill="#86efac"/><ellipse cx="230" cy="565" rx="320" ry="75" fill="#4ade80"/><ellipse cx="980" cy="570" rx="330" ry="75" fill="#22c55e"/>'
  +'<path d="M600 675 L556 520 Q600 488 644 520 L600 675 Z" fill="#fde68a"/>'
  +'<g><rect x="168" y="430" width="18" height="100" rx="8" fill="#92400e"/><circle cx="177" cy="400" r="58" fill="#16a34a"/><circle cx="140" cy="432" r="38" fill="#22c55e"/><circle cx="216" cy="434" r="36" fill="#4ade80"/></g>'
  +'<g><rect x="1010" y="442" width="18" height="90" rx="8" fill="#92400e"/><circle cx="1019" cy="412" r="50" fill="#16a34a"/><circle cx="988" cy="440" r="34" fill="#22c55e"/><circle cx="1050" cy="442" r="32" fill="#4ade80"/></g>'
  +'<g>'+flX.map(function(x,i){return '<g><circle cx="'+x+'" cy="592" r="7" fill="'+flC[i%flC.length]+'"/><circle cx="'+x+'" cy="585" r="3" fill="#fff"/></g>';}).join('')+'</g>'
  +'<ellipse cx="600" cy="522" rx="130" ry="18" fill="#15803d" opacity="0.25"/>'
  +'<g>'
  +'<path d="M552 340 Q536 235 572 220 Q600 210 628 220 Q664 235 648 340 Q600 358 552 340 Z" fill="'+c3+'"/>'
  +'<path d="M552 268 Q538 170 566 156 Q582 148 584 188 Q586 235 572 268 Z" fill="#ffffff" stroke="'+c3+'" stroke-width="4"/>'
  +'<path d="M648 268 Q662 170 634 156 Q618 148 616 188 Q614 235 628 268 Z" fill="#ffffff" stroke="'+c3+'" stroke-width="4"/>'
  +'<path d="M560 228 Q556 182 570 172 Q580 168 580 212 Z" fill="#fda4af"/>'
  +'<path d="M640 228 Q644 182 630 172 Q620 168 620 212 Z" fill="#fda4af"/>'
  +'<circle cx="600" cy="335" r="88" fill="#ffffff" stroke="'+c3+'" stroke-width="6"/>'
  +'<circle cx="568" cy="326" r="13" fill="#1e1b2e"/><circle cx="632" cy="326" r="13" fill="#1e1b2e"/>'
  +'<circle cx="572" cy="322" r="4" fill="#fff"/><circle cx="636" cy="322" r="4" fill="#fff"/>'
  +'<circle cx="542" cy="358" r="13" fill="#fda4af" opacity="0.8"/><circle cx="658" cy="358" r="13" fill="#fda4af" opacity="0.8"/>'
  +'<path d="M568 366 Q600 390 632 366" stroke="#1e1b2e" stroke-width="5" fill="none" stroke-linecap="round"/>'
  +'<path d="M528 420 Q600 368 672 420 L664 496 Q600 516 536 496 Z" fill="'+c1+'"/>'
  +'<path d="M600 432 l7 14 15 2 -11 11 3 15 -14 -8 -14 8 3 -15 -11 -11 15 -2z" fill="#ffd52e"/>'
  +'<circle cx="674" cy="462" r="17" fill="#fde68a" stroke="#b45309" stroke-width="3"/>'
  +'<circle cx="674" cy="462" r="28" fill="#ffd52e" opacity="0.3"/>'
  +'</g></svg>';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
/* ---- v13: PICTURE GENERATION — through the site's own image service ----
   Every picture on this site (book pages, storyboard scenes, comic
   panels) is generated through ONE path: a POST from this browser to
   the site's own image endpoint (IMAGE_PROXY_URL below), which
   returns a finished picture. The browser NEVER talks to any image
   provider directly, and NO provider name, model name, API key or
   account appears anywhere in this file, in the UI, or in any network
   call the browser can see — the pictures simply come back from the
   site's own endpoint. Server side lives in api/generate-image.js;
   see PROXY-SETUP.md for deployment (the service holds its own
   credentials as server-side environment variables — nothing secret
   is ever in this repo's client code).
   Behaviour, everywhere pictures generate:
   - Pictures appear instantly as built-in illustrations, then each
     one is UPGRADED to a generated picture in the background, one at
     a time with visible progress ("Generating picture 2 of 6…").
     Requests are paced through one shared slot so parallel flows
     (book + storyboard + comic) never burst.
   - If the image service cannot be reached, is busy, or says the
     daily limit is hit, that page/scene/panel KEEPS its built-in
     illustration — never a picture-less page, and the note never
     names a provider ("Picture couldn't be generated right now —
     used the built-in picture.").
   - Each picture is generated separately, so the same character may
     look a little different on different pages — the UI note says
     so; the built-in illustration keeps the Character Bible
     identical on every page.
   Generated pictures are stored as data URLs so they survive
   reloads (blob: URLs would not). */
let illustrating=false, upgradingStoryboard=false, upgradingComic=false;
let nextImageAt=0;
/* The site's own image endpoint. The image service runs on Vercel
   (it holds its credentials as server-side environment variables),
   so this site calls it by its absolute URL — that works from
   GitHub Pages (ekiddy.com) AND from the Vercel site itself, and
   the browser still never sees any provider name, model or key. */ 
const IMAGE_PROXY_URL='https://vitalize-storynest.vercel.app/api/generate-image';
async function waitImageSlot(){
  const now=Date.now();
  if(nextImageAt>now) await new Promise(function(res){setTimeout(res,nextImageAt-now);});
  nextImageAt=Date.now()+4000;
}
function fetchWithTimeout(url,ms,opts){const c=new AbortController();const t=setTimeout(function(){c.abort();},ms);const o=Object.assign({},opts||{},{signal:c.signal});return fetch(url,o).finally(function(){clearTimeout(t);});}
function isSVGImg(u){return typeof u==='string'&&u.indexOf('data:image/svg+xml')===0;}
async function fetchGeneratedImage(prompt,seed){
  await waitImageSlot();
  const r=await fetchWithTimeout(IMAGE_PROXY_URL,90000,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:prompt,seed:seed,width:1024,height:576})});
  if(!r.ok){const e=new Error('Image service HTTP '+r.status);e.status=r.status;throw e;}
  const j=await r.json();
  if(!j||typeof j.image!=='string'||j.image.indexOf('data:image/')!==0) throw new Error('Image service: no image in response');
  return j.image;
}
function realisticPrompt(p,style){return p.scene+' — '+bibleText()+' — style: '+(style||'Storybook Illustration')+', children\'s picture book illustration, soft light, gentle colours';}
function svgFallback(p,style){p.img=makeSVG(p,style);p.prompt=p.scene+' — '+bibleText()+' — style: '+style;}
async function illustratePage(i){
  if(!current)return;
  const p=current.pages[i], statusEl=document.getElementById('illusStatus');
  if(illustrating){alert('Already generating a picture — please wait a moment.');return;}
  illustrating=true;
  if(statusEl) statusEl.textContent='Generating picture for page '+p.n+'… please wait.';
  try{
    p.img=await fetchGeneratedImage(realisticPrompt(p,current.style),Date.now()%1000000);
    p.prompt=realisticPrompt(p,current.style)+' (generated picture)';
    if(statusEl) statusEl.textContent='Done — picture for page '+p.n+'.';
  }catch(e){
    svgFallback(p,current.style);
    if(statusEl) statusEl.textContent='Picture couldn\'t be generated right now — used the built-in picture for page '+p.n+'. Try Illustrate again in a little while.';
  }
  illustrating=false; save();renderEditor();renderIllus();
}
async function illustrateAll(force){
  if(!current)return alert('Generate a book first.');
  if(illustrating)return;
  const book=current, statusEl=document.getElementById('illusStatus');
  const todo=[];
  book.pages.forEach(function(p,i){
    if(force) todo.push(i);
    else if(!p.img||isSVGImg(p.img)) todo.push(i);
  });
  if(!todo.length){ if(statusEl) statusEl.textContent='All pages already have generated pictures. Tap “Regenerate all” for new ones.'; return; }
  illustrating=true;
  let done=0;
  for(const i of todo){
    const p=book.pages[i];
    if(statusEl) statusEl.textContent='Generating picture '+(done+1)+' of '+todo.length+'… please wait.';
    const seed=force?(Date.now()%1000000):(hash(p.scene+p.text+i)%1000000);
    try{
      p.img=await fetchGeneratedImage(realisticPrompt(p,book.style),seed);
      p.prompt=realisticPrompt(p,book.style)+' (generated picture)';
      done++;
    }catch(e){
      svgFallback(p,book.style);
      if(statusEl) statusEl.textContent='Picture couldn\'t be generated right now — used the built-in picture for page '+p.n+'.';
    }
    save(); if(current===book){renderIllus();renderEditor();}
  }
  illustrating=false;
  logHistory('image','Generated pictures: '+done+' of '+todo.length+' pages');
  if(statusEl&&done===todo.length) statusEl.textContent='Done — '+done+' picture(s) generated.';
}
/* Storyboard scenes: the storyboard appears instantly with built-in
   pictures, then each scene is UPGRADED to a generated picture in
   the background (same pacing, same silent fallback — a scene never
   loses its picture). The video render uses whatever picture is
   current. */
async function upgradeStoryboardImages(){
  if(!storyboard.length||upgradingStoryboard) return;
  const statusEl=document.getElementById('animImgStatus');
  upgradingStoryboard=true;
  let done=0;
  for(let i=0;i<storyboard.length;i++){
    const s=storyboard[i];
    if(!s.img||isSVGImg(s.img)){
      if(statusEl) statusEl.textContent='Generating scene picture '+(done+1)+' of '+storyboard.length+'… please wait.';
      try{
        s.img=await fetchGeneratedImage(s.prompt+' — style: '+storyStyle+', children\'s picture book illustration',hash(s.prompt+i)%1000000);
        done++;
        const thumbs=document.querySelectorAll('#animOut .scene-thumb-img');
        if(thumbs[i]) thumbs[i].src=s.img;
      }catch(e){
        if(statusEl) statusEl.textContent='A scene picture couldn\'t be generated right now — kept the built-in picture for scene '+s.n+'.';
      }
    } else done++;
  }
  upgradingStoryboard=false;
  if(statusEl&&done===storyboard.length) statusEl.textContent='Done — '+done+' scene picture(s) generated.';
  save();
}
/* Comic panels: same pattern — panels appear instantly with built-in
   pictures, then upgrade to generated pictures in the background. */
async function upgradeComicImages(panels){
  if(!panels||!panels.length||upgradingComic) return;
  const statusEl=document.getElementById('comicImgStatus');
  upgradingComic=true;
  let done=0;
  for(let i=0;i<panels.length;i++){
    const p=panels[i];
    if(!p.img||isSVGImg(p.img)){
      if(statusEl) statusEl.textContent='Generating comic picture '+(done+1)+' of '+panels.length+'… please wait.';
      try{
        p.img=await fetchGeneratedImage(p.text+' — '+bibleText()+' — Comic style, children\'s comic panel',hash(p.text+i)%1000000);
        done++;
        const el=document.getElementById('comic-panel-img-'+i);
        if(el) el.src=p.img;
      }catch(e){
        if(statusEl) statusEl.textContent='A comic picture couldn\'t be generated right now — kept the built-in picture for panel '+p.n+'.';
      }
    } else done++;
  }
  upgradingComic=false;
  if(statusEl&&done===panels.length) statusEl.textContent='Done — '+done+' comic picture(s) generated.';
  save();
}
function renderIllus(){const el=document.getElementById('illusOut');if(!el||!current)return;el.innerHTML=current.pages.map((p,i)=>'<div class="page-card">'+(p.img?'<img src="'+p.img+'" alt="Illustration page '+p.n+'">':'<div class="pad muted">No image yet</div>')+'<div class="pad"><strong>Page '+p.n+'</strong><p class="small">'+esc(p.text.slice(0,120))+'</p><div class="row"><button class="btn" onclick="illustratePage('+i+')">↻ Regenerate</button><button class="btn" onclick="editPrompt('+i+')">✏ Edit prompt</button></div>'+(p.prompt?'<p class="small muted">'+esc(p.prompt.slice(0,160))+'</p>':'')+'</div></div>').join('');}
async function editPrompt(i){const t=prompt('Edit image prompt:',current.pages[i].prompt||current.pages[i].scene);if(t!=null){current.pages[i].prompt=t;try{current.pages[i].img=await fetchGeneratedImage(t+' — '+bibleText(),Date.now()%1000000);}catch(e){current.pages[i].img=makeSVG({scene:t,text:current.pages[i].text},current.style);}save();renderIllus();renderEditor();}}

/* ---------- Export / Reader ---------- */
function exportPDF(kind){if(kind==='comic'){window.print();return;}if(!current){const b=reader.book;if(b){current=b;}else return alert('Open or generate a book first.');}renderBookOut(true);setTimeout(function(){window.print();setTimeout(renderBookOut,800);},100);}
function downloadPageImages(){if(!current)return alert('Generate a book first.');current.pages.forEach((p,i)=>{if(!p.img)return;const a=document.createElement('a');a.href=p.img;a.download=(current.title.replace(/\W+/g,'-')+'-page-'+p.n+'.svg');a.click();});}
function downloadStoryText(){if(!current)return alert('Generate a book first.');const txt=current.title+'\n'+current.desc+'\nMoral: '+current.moral+'\n\n'+current.pages.map(p=>'Page '+p.n+': '+p.text).join('\n\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));a.download=current.title.replace(/\W+/g,'-')+'.txt';a.click();}
function shareToLibrary(){if(!current)return;current.shared=true;if(!state.library.find(b=>b.id===current.id))state.library.unshift(current);saveCurrentBook();save();renderLibrary();alert('Shared to Library.');}
function renderLibrary(){const el=document.getElementById('libraryOut');if(!el)return;const books=state.library.length?state.library:state.projects.filter(p=>p.kind==='book');el.innerHTML=books.length?books.map(b=>'<div class="card"><h3>'+esc(b.title)+'</h3><p>'+esc(b.desc||'')+'</p><p class="muted small">'+(b.pages?b.pages.length:0)+' pages · '+esc(b.type||'')+' · '+esc(b.lang||'en')+'</p><button class="btn primary" onclick="openReader(\''+b.id+'\')">📖 Read</button></div>').join(''):'<p class="muted">Library is empty — share a book from the Picture Book Generator.</p>';}
async function openReader(id){const b=state.projects.find(p=>p.id===id)||state.library.find(p=>p.id===id);if(!b)return;await hydrateBook(b);reader={book:b,idx:0};current=b;document.getElementById('readerCard').style.display='block';document.getElementById('readerTitle').textContent=b.title;renderReader();go('library');}
function renderReader(){const el=document.getElementById('readerOut');if(!reader.book)return;const p=reader.book.pages[reader.idx];el.innerHTML='<div class="book-page">'+(p.img?'<img src="'+p.img+'" alt="Page illustration">':'')+'<p class="book-caption">Scene: '+esc(p.scene)+'</p><h3>Page '+p.n+' of '+reader.book.pages.length+'</h3><p style="font-size:19px">'+esc(p.text)+'</p></div>';}
function readerPrev(){if(reader.idx>0){reader.idx--;renderReader();}}
function readerNext(){if(reader.book&&reader.idx<reader.book.pages.length-1){reader.idx++;renderReader();}}
function readAloud(){if(document.body.classList.contains('reading-aloud')){stopReadingAloud();return;}if(!reader.book)return;const p=reader.book.pages[reader.idx];const u=new SpeechSynthesisUtterance(p.text);u.rate=1;u.onend=function(){document.body.classList.remove('reading-aloud');syncReadButtons();};u.onerror=function(){document.body.classList.remove('reading-aloud');syncReadButtons();};speechSynthesis.cancel();speechSynthesis.speak(u);document.body.classList.add('reading-aloud');syncReadButtons();}

/* ---------- Home / Projects / Dashboard / Admin ---------- */
/* v11: NO auto-seed. A fresh user starts EMPTY (0 projects, 0 characters)
   until they create something themselves. Luna / Ellie / Milo live on only
   as idea suggestions (IDEAS) and placeholder text in the idea fields —
   they are never created as projects or characters here. Existing users
   keep whatever is already saved in their browser (load() restores it). */
function seed(){}
function renderHome(){const el=document.getElementById('homeStats');if(el)el.innerHTML='<div class="card"><h3>'+state.projects.length+'</h3><p>Projects in this browser</p></div><div class="card"><h3>'+state.characters.length+'</h3><p>Saved characters</p></div><div class="card"><h3>Unlimited</h3><p>Generation — no daily limits</p></div>';
  const h=document.getElementById('heroArt');if(h&&current)h.innerHTML='';if(h)h.innerHTML='<img src="'+makeSVG({scene:'Luna the Moon Rabbit with a glowing lantern',text:'ekiddy'},'Storybook Illustration')+'" alt="ekiddy illustration">';
  const s=document.getElementById('homeSamples');if(s)s.innerHTML=state.projects.slice(0,3).map(b=>'<div class="card"><h3>'+esc(b.title)+'</h3><p>'+esc(b.desc||'')+'</p><button class="btn" onclick="openReader(\''+b.id+'\')">📖 Read</button></div>').join('')||'<p class="muted">No samples yet.</p>';
}
function renderSimpleHome(){const el=document.getElementById('simpleProjects');if(!el)return;el.innerHTML=state.projects.length?state.projects.map(b=>'<div class="simple-row"><div><strong>'+esc(b.title)+'</strong><br><span class="muted small">'+esc(b.desc||b.kind||'')+'</span></div><button class="btn" onclick="openProject(\''+b.id+'\')">Open</button></div>').join(''):'<p class="muted">No stories yet — tap \u201cCreate a story\u201d above to make your first one.</p>';}
function renderProjects(){const el=document.getElementById('projectsOut');if(!el)return;el.innerHTML=state.projects.length?state.projects.map(b=>'<div class="card"><h3>'+esc(b.title)+'</h3><p>'+esc(b.desc||b.kind||'')+'</p><p class="muted small">'+(b.pages?b.pages.length+' pages · ':(b.chapters?b.chapters.length+' chapters · ':''))+esc(b.type||b.kind||'')+'</p><div class="row"><button class="btn" onclick="openProject(\''+b.id+'\')">Open</button><button class="btn" onclick="duplicateProject(\''+b.id+'\')">Duplicate</button><button class="btn danger" onclick="deleteProject(\''+b.id+'\')">Delete</button></div></div>').join(''):'<p class="muted">No projects yet — create one.</p>';}
async function openProject(id){const b=state.projects.find(p=>p.id===id);if(!b)return;if(b.kind==='story'){openStory(id);}else if(b.kind==='video'){await hydrateBook(b);openQuickVideoProject(b);}else if(b.kind==='book'||b.pages){await hydrateBook(b);current=b;renderBookOut();renderEditor();go('book');}else if(b.kind==='comic'){hydrateBook(b);go('comic');}else{go('projects');}}
function duplicateProject(id){const b=state.projects.find(p=>p.id===id);if(!b)return;const c=JSON.parse(JSON.stringify(b));c.id=uid();c.title=b.title+' (copy)';
  /* v15: pictures live in IndexedDB under the original's id — copy that
     record to the new id and re-point the copy's markers, so deleting the
     original never orphans the copy's pictures. */
  const rewrite=function(list){ if(!list) return; list.forEach(function(p){ if(isIdbMarker(p.img)) p.img='idb:'+c.id; }); };
  rewrite(c.pages); rewrite(c.panels);
  if(c.pages||c.panels){ idbGet(id).then(function(rec){ if(rec) idbPut(c.id,rec).catch(function(){}); }).catch(function(){}); }
  state.projects.unshift(c);save();renderProjects();}
function deleteProject(id){if(!confirm('Delete this project?'))return;state.projects=state.projects.filter(p=>p.id!==id);state.library=state.library.filter(p=>p.id!==id);idbDel(id);save();renderProjects();renderLibrary();renderSimpleHome();}
function renderDashboard(){const el=document.getElementById('dashStats');if(el)el.innerHTML='<div class="card"><h3>'+state.projects.length+'</h3><p>Total projects</p></div><div class="card"><h3>'+state.projects.filter(p=>p.pages&&p.pages.every(x=>x.img)).length+'</h3><p>Completed / fully illustrated</p></div><div class="card"><h3>'+state.characters.length+'</h3><p>Saved characters</p></div><div class="card"><h3>Unlimited</h3><p>Daily limit: none</p></div>';
  const r=document.getElementById('dashRecent');if(r)r.innerHTML=state.projects.slice(0,3).map(b=>'<div class="card"><h3>'+esc(b.title)+'</h3><button class="btn" onclick="openProject(\''+b.id+'\')">Open</button></div>').join('')||'';
  const h=document.getElementById('dashHistory');if(h)h.innerHTML=state.history.length?state.history.map(x=>'<p class="small">'+esc(x.at.slice(0,19).replace('T',' '))+' — <strong>'+esc(x.kind)+'</strong>: '+esc(x.detail)+'</p>').join(''):'<p class="muted">No generation history yet.</p>';
}
function renderAdmin(){const el=document.getElementById('adminStats');if(el)el.innerHTML='<div class="card"><h3>1</h3><p>Local creator profile</p></div><div class="card"><h3>'+state.history.length+'</h3><p>Generation jobs logged</p></div><div class="card"><h3>None</h3><p>Failed jobs</p></div>';
  const j=document.getElementById('adminJobs');if(j)j.innerHTML=state.history.map(x=>'<p class="small">'+esc(x.kind)+' — '+esc(x.detail)+'</p>').join('')||'<p class="muted">No jobs yet.</p>';
  const t=document.getElementById('adminTemplates');if(t)t.innerHTML=Object.keys(TYPES).map(k=>'<span class="chip">'+esc(k)+'</span>').join('');
}

/* ---------- Animation ---------- */
const CAMERA='Camera: wide shot, slow push-in or gentle follow only. No jump cuts, no sudden zooms. If the location changes, add a 1-second fade/transition note.';
const NEGATIVE='Negative: no extra characters, no extra limbs, no changed face/hair/outfit/colours, no mirrored text, no on-screen text, no teleporting.';
/* v12: Animation Studio was missing the Random button the Picture Book
   and Story flows have — one tap fills the idea field with a random
   topic from the same IDEAS list. Default fallback topic unchanged. */
function randomAnimationIdea(){document.getElementById('anIdea').value=IDEAS[Math.floor(Math.random()*IDEAS.length)];}
function renderAnimOut(){
  const out=document.getElementById('animOut');
  if(!out) return;
  out.innerHTML=storyboard.map((s,i)=>'<div class="scene-thumb" onclick="toggleSceneDetail('+i+')">'+(s.img?'<img class="scene-thumb-img" src="'+s.img+'" alt="Scene '+s.n+' illustration">':'')+'<div class="scene-thumb-body"><strong>Scene '+s.n+'</strong><p>'+esc(s.narration.slice(0,90))+(s.narration.length>90?'…':'')+'</p></div><div class="scene-detail" id="scene-detail-'+i+'" style="display:none"><p class="small">Entry: <strong>'+esc(s.entry)+'</strong> · Start: '+esc(s.start)+' → End: '+esc(s.end)+' · Exit: '+esc(s.exit)+'</p><p class="small muted">Continuity: '+(i===0?'starts centre':('starts at '+storyboard[i-1].end+' (previous scene end)'))+'</p><p class="mono small">'+esc(s.prompt)+'</p><div class="row"><button class="btn" onclick="event.stopPropagation();copyPrompt('+i+')">📋 Copy prompt</button></div></div></div>').join('');
}
function generateStoryboard(ideaArg,bibleArg,styleArg,skipUpgrade){
  const idea=ideaArg||document.getElementById('anIdea').value.trim()||'Milo the fox follows a glowing lantern';
  const bible=bibleArg||bibleText();
  storyStyle=styleArg||'Storybook Illustration';
  const n=Math.max(3,Math.min(8,parseInt(document.getElementById('anScenes').value)||4));
  const sides=['left','right','centre'];
  storyboard=[];let pos='centre';
  for(let i=0;i<n;i++){
    const entry=sides[i%3], exit=sides[(i+1)%3];
    const scene={n:i+1,narration:(i===0?idea+' begins. ':i===n-1?'At last, the journey ends happily. ':'The journey continues, step by step. ')+'Scene '+(i+1)+' of '+n+'.',
      entry, start:pos, end:exit, exit,
      camera:CAMERA, negative:NEGATIVE,
      prompt:''};
    scene.prompt='SCENE '+(i+1)+'/'+n+': '+idea+'. '+bible+' Entry: from the '+entry+', start position '+pos+'. End position: '+exit+', exit to the '+exit+'. Next scene starts at '+exit+'. '+CAMERA+' '+NEGATIVE;
    /* v12: every scene gets its REAL illustration — the same makeSVG()
       picture-book illustration, built from this scene's narration +
       the Character Bible + Storybook style — so the storyboard preview
       and the rendered video show the user's character and setting,
       not a flat colour. */
    scene.img=makeSVG({scene:idea+' — scene '+(i+1)+': '+scene.narration,text:scene.narration},storyStyle);
    storyboard.push(scene); pos=exit;
  }
  renderAnimOut();
  logHistory('animation','Storyboard: '+n+' scenes — '+idea);save();
  /* v13: upgrade the scene pictures to the picked image model in the
     background (built-in pictures stay until each realistic one
     arrives). Quick Video passes skipUpgrade and upgrades them fast
     itself instead. */
  if(!skipUpgrade) upgradeStoryboardImages();
  prefillRvLines();
  /* v17: a new storyboard replaces the old real-video clips. */
  if(!rvBusy){
    rvClips=[];
    var rv=document.getElementById('rvVideo'); if(rv){rv.style.display='none';rv.removeAttribute('src');}
    var jd=document.getElementById('rvJoinDownload'); if(jd) jd.style.display='none';
    var jn=document.getElementById('rvJoinNote'); if(jn) jn.textContent='';
    var rs=document.getElementById('rvStatus'); if(rs) rs.textContent='';
    var rb=document.getElementById('rvProgress'); if(rb) rb.style.width='0%';
  }
}
function toggleSceneDetail(i){const d=document.getElementById('scene-detail-'+i);if(!d)return;d.style.display=d.style.display==='none'?'block':'none';}
function copyText(t){if(navigator.clipboard)navigator.clipboard.writeText(t);else{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}}
function copyPrompt(i){copyText(storyboard[i].prompt);alert('Prompt copied.');}
function copyAllPrompts(){if(!storyboard.length)return alert('Generate a storyboard first.');copyText(storyboard.map(s=>s.prompt).join('\n\n'));alert('All '+storyboard.length+' prompts copied.');}
/* ---------- Built-in video renderer (v13) ----------
   v13 fixes — user report: "Videos Generate ஆகமாட்டேங்குது.
   ஏதாவது ஒரு basic image வச்சு generate ஆகுற video நா generate
   ஆகணும் இல்ல?" (videos will not generate at all; with at least a
   basic image a video should generate).
   1. CANCEL USED TO LEAVE THE RENDERER STUCK. cancelVideoRender()
      only cleared the interval timer — and the interval was the only
      code that ever called rec.stop() — so after a Cancel the
      MediaRecorder kept recording forever, onstop never fired,
      `rendering` stayed true, and every later Render click silently
      returned at the `if(rendering) return;` guard until the page was
      reloaded. Cancel now really stops the recorder (rec.stop() ->
      onstop resets everything), startRecording() aborts if Cancel was
      pressed while pictures were loading, rec.onerror resets the
      state too, and renderVideo() recovers a stuck state instead of
      silently returning.
   2. EVERY SCENE ALWAYS HAS A PICTURE. ensureSceneImages()
      regenerates a makeSVG illustration for any scene missing one,
      before the storyboard preview, before a render and before the
      preview fallback — a render can never be a blank/black frame.
   3. BROWSERS THAT CANNOT RECORD (e.g. Safari on iPhone, no
      MediaRecorder) no longer hit a dead end: they get a moving
      in-page preview (canvas loop with zoom/pan + captions + Play/
      Pause) and a Download-scene-pictures button, with a plain
      explanation of what happened and what still works.
   4. The auto-download after a successful render is only a bonus:
      the finished video stays in the #animVideo player with a working
      Download button even when the automatic download is blocked
      (common on mobile). */
let rendering=false, cancelRender=false, lastVideoUrl=null, renderTimer=null, activeRec=null;
let previewRAF=null, previewPlaying=false, previewT0=0, previewBaseT=0, previewCtx=null, previewCanvas=null, previewImgs=[], previewPer=0, previewDur=15, previewW=720, previewH=1280, previewFallback=false;
function ensureSceneImages(){
  if(!storyboard.length) return;
  storyboard.forEach(function(s){
    if(!s.img) s.img=makeSVG({scene:(s.narration||s.prompt||'A story scene'),text:(s.narration||'')},'Storybook Illustration');
  });
}
function loadSceneImages(){
  return storyboard.map(function(s){
    const im=new Image();
    im.src=s.img||makeSVG({scene:(s.narration||''),text:(s.narration||'')},'Storybook Illustration');
    return im;
  });
}
function wrapCaptionText(ctx,text,maxW){
  const words=String(text).split(/\s+/);const lines=[];let line='';
  words.forEach(function(w){const t=line?line+' '+w:w;if(ctx.measureText(t).width>maxW&&line){lines.push(line);line=w;}else line=t;});
  if(line)lines.push(line);return lines;
}
/* One scene drawn on a canvas: real illustration with slow Ken Burns
   zoom/pan, scene badge, full wrapped narration. Shared by the video
   recorder AND the no-recorder moving preview, so both always show
   the same pictures. If the picture failed to load, a coloured
   backdrop + the same caption is drawn — never a blank/black frame. */
function drawSceneFrame(ctx,img,s,idx,t,per,W,H,prevImg){
  ctx.save();
  ctx.fillStyle='#081a43'; ctx.fillRect(0,0,W,H);
  if(img&&img.complete&&img.naturalWidth){
    const local=Math.min(1,Math.max(0,(t-idx*per)/per));
    const zoom=1.06+local*0.14; /* slow zoom-in across the scene */
    const drift=(idx%2===0?-1:1)*local*0.05*W; /* gentle pan, alternating direction */
    const scale=Math.max(W/img.naturalWidth,H/img.naturalHeight)*zoom;
    const dw=img.naturalWidth*scale, dh=img.naturalHeight*scale;
    ctx.drawImage(img,(W-dw)/2+drift,(H-dh)/2,dw,dh);
  }else{
    ctx.fillStyle=['#fde68a','#bae6fd','#fbcfe8','#d1fae5'][idx%4]; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(W/2,H*0.4,Math.min(W,H)*0.18,0,7); ctx.fill();
    ctx.fillStyle='#1e1b2e'; ctx.beginPath(); ctx.arc(W/2-30,H*0.38,8,0,7); ctx.arc(W/2+30,H*0.38,8,0,7); ctx.fill();
    ctx.strokeStyle='#1e1b2e'; ctx.lineWidth=5; ctx.beginPath(); ctx.arc(W/2,H*0.42,40,0.2,Math.PI-0.2); ctx.stroke();
  }
  ctx.restore();
  /* v24: crossfade from the previous scene across the first 12% of
     this scene, so cuts never jump — then the moving character
     walks/talks/dances on top of the picture. */
  if(prevImg&&prevImg.complete&&prevImg.naturalWidth){
    var localF=Math.min(1,Math.max(0,(t-idx*per)/per));
    if(localF<0.12){
      ctx.save(); ctx.globalAlpha=1-localF/0.12;
      var psc=Math.max(W/prevImg.naturalWidth,H/prevImg.naturalHeight);
      var pdw=prevImg.naturalWidth*psc, pdh=prevImg.naturalHeight*psc;
      ctx.drawImage(prevImg,(W-pdw)/2,(H-pdh)/2,pdw,pdh);
      ctx.restore();
    }
  }
  drawQVCharacter(ctx,s,idx,t,per,W,H);
  /* Scene badge, top-left */
  const badge='SCENE '+(idx+1)+' / '+storyboard.length;
  ctx.font='bold '+Math.max(20,Math.round(W*0.022))+'px sans-serif';
  const bw=ctx.measureText(badge).width+28;
  const bh=Math.max(34,Math.round(W*0.032));
  ctx.fillStyle='rgba(8,26,67,0.72)';
  if(ctx.roundRect){ctx.beginPath(); ctx.roundRect(18,18,bw,bh,16); ctx.fill();}else{ctx.fillRect(18,18,bw,bh);}
  ctx.fillStyle='#ffd52e'; ctx.fillText(badge,32,18+bh-Math.max(10,Math.round(W*0.009)));
  /* Full narration as caption, wrapped — never truncated.
     v28: the scene's spoken line goes first, in gold italic, so
     the dialogue is readable on screen — the free video has no
     voice track (the browser cannot record its own speech
     synthesis), and the character's mouth moves on these beats. */
  const fs=Math.max(20,Math.round(W*0.026));
  const lh=Math.round(fs*1.45);
  var capLines=[];
  if(s&&s.dialogue){
    ctx.font='italic bold '+fs+'px sans-serif';
    wrapCaptionText(ctx,'\u201C'+s.dialogue+'\u201D',W-56).forEach(function(ln){capLines.push({t:ln,d:true});});
  }
  ctx.font=fs+'px sans-serif';
  wrapCaptionText(ctx,s.narration,W-56).forEach(function(ln){capLines.push({t:ln,d:false});});
  const bandH=capLines.length*lh+28;
  ctx.fillStyle='rgba(0,0,0,0.68)'; ctx.fillRect(0,H-bandH,W,bandH);
  capLines.forEach(function(ln,i){
    ctx.font=ln.d?('italic bold '+fs+'px sans-serif'):(fs+'px sans-serif');
    ctx.fillStyle=ln.d?'#ffd52e':'#fff';
    ctx.fillText(ln.t,28,H-bandH+18+(i+1)*lh-Math.round(fs*0.35));
  });
  return idx;
}
/* Reset the renderer to idle: button back, cancel hidden, bar at 0. */
function resetRenderUI(msg){
  rendering=false; cancelRender=false; activeRec=null; stopMusicBed(); /* v28: music stops on cancel/error too */
  if(renderTimer){clearInterval(renderTimer);renderTimer=null;}
  const btn=document.getElementById('renderBtn'), cancelBtn=document.getElementById('renderCancel'),
    bar=document.getElementById('renderProgress'), status=document.getElementById('renderStatus');
  if(btn){btn.disabled=false;btn.textContent='▶ Render video in browser';}
  if(cancelBtn) cancelBtn.style.display='none';
  if(bar) bar.style.width='0%';
  if(status&&msg) status.textContent=msg;
}
function stopPreview(){
  previewPlaying=false;
  if(previewRAF){cancelAnimationFrame(previewRAF);previewRAF=null;}
  const pb=document.getElementById('previewPlayBtn');
  if(pb) pb.textContent='▶ Play preview';
}
function downloadSceneImages(){
  ensureSceneImages();
  if(!storyboard.length)return alert('Generate a storyboard first.');
  storyboard.forEach(function(s,i){
    const a=document.createElement('a');a.href=s.img;
    a.download='vitalize-storynest-scene-'+(i+1)+'.svg';document.body.appendChild(a);a.click();a.remove();
  });
}
function previewLoop(){
  if(!previewPlaying||!previewCtx) return;
  const t=previewBaseT+(performance.now()-previewT0)/1000;
  const loopT=t%previewDur;
  const idx=Math.min(storyboard.length-1,Math.floor(loopT/previewPer));
  drawSceneFrame(previewCtx,previewImgs[idx],storyboard[idx],idx,loopT,previewPer,previewW,previewH,idx>0?previewImgs[idx-1]:null);
  previewRAF=requestAnimationFrame(previewLoop);
}
function togglePreview(){
  if(!previewCtx) return;
  if(!previewPlaying){
    previewPlaying=true; previewT0=performance.now();
    const pb=document.getElementById('previewPlayBtn'); if(pb) pb.textContent='⏸ Pause preview';
    previewLoop(); return;
  }
  previewPlaying=false; previewBaseT=previewBaseT+(performance.now()-previewT0)/1000;
  if(previewRAF){cancelAnimationFrame(previewRAF);previewRAF=null;}
  const pb=document.getElementById('previewPlayBtn'); if(pb) pb.textContent='▶ Play preview';
}
/* Moving-preview fallback for browsers that cannot record video
   (notably Safari on iPhone: no MediaRecorder). The user still gets
   a moving video — scene pictures with zoom/pan + captions, looping,
   with Play/Pause and Download-scene-pictures — plus a plain
   explanation, never a dead end with no video at all. */
function startPreviewFallback(reason){
  stopPreview();
  previewFallback=true;
  if(!storyboard.length) generateStoryboard();
  if(!storyboard.length){alert('Generate a storyboard first.');return;}
  ensureSceneImages();
  const status=document.getElementById('renderStatus'), err=document.getElementById('renderError'),
    btn=document.getElementById('renderBtn'), cancelBtn=document.getElementById('renderCancel'),
    bar=document.getElementById('renderProgress'), pb=document.getElementById('previewPlayBtn'),
    db=document.getElementById('previewDownloadBtn'), note=document.getElementById('renderNote');
  resetRenderUI('');
  const ratio=document.getElementById('anRatio').value, dur=parseInt(document.getElementById('anDur').value)||15;
  const q=document.getElementById('anQuality').value;
  previewW=ratio==='9:16'?(q==='1080p'?1080:720):ratio==='16:9'?(q==='1080p'?1920:1280):(q==='1080p'?1080:720);
  previewH=ratio==='9:16'?(q==='1080p'?1920:1280):ratio==='16:9'?(q==='1080p'?1080:720):(q==='1080p'?1080:720);
  previewDur=dur; previewPer=dur/storyboard.length; previewBaseT=0;
  const canvas=document.createElement('canvas');canvas.width=previewW;canvas.height=previewH;canvas.style.width='100%';canvas.style.maxWidth='480px';canvas.style.borderRadius='16px';canvas.style.display='block';
  const preview=document.getElementById('renderPreview'); if(preview){preview.innerHTML='';preview.appendChild(canvas);}
  previewCanvas=canvas; previewCtx=canvas.getContext('2d');
  previewImgs=loadSceneImages();
  if(pb) pb.style.display='inline-block';
  if(db) db.style.display='inline-block';
  if(status) status.textContent='Moving preview playing below — your scene pictures with zoom/pan and captions.';
  if(err) err.textContent=reason+' This browser cannot record a video file in the page, so there is no .webm download here. What still works: the moving preview below and Download scene pictures.';
  if(note) note.textContent='Preview mode: this browser cannot record video in-page (Safari on iPhone does not support MediaRecorder). Try Chrome or Edge on a desktop for a downloadable .webm file.';
  const imgsReady=Promise.all(previewImgs.map(function(im){return im.complete?Promise.resolve():new Promise(function(res){im.onload=res;im.onerror=res;});}));
  Promise.race([imgsReady,new Promise(function(res){setTimeout(res,1500);})]).then(function(){
    if(!previewCtx) return;
    drawSceneFrame(previewCtx,previewImgs[0],storyboard[0],0,0,previewPer,previewW,previewH);
    previewPlaying=true; previewT0=performance.now();
    if(pb) pb.textContent='⏸ Pause preview';
    previewLoop();
  });
  logHistory('video','Moving preview started ('+reason.slice(0,80)+')'); save();
}
/* ---------- Music bed for recorded video (v28) ----------
   The built-in renderer recorded VIDEO ONLY — the finished file
   had no audio track at all. A gentle music bed is now mixed in,
   free, with no download and no key: Web Audio oscillators play a
   soft melody + pad chords into a MediaStreamDestination, whose
   audio track is combined with the canvas video track for the SAME
   MediaRecorder. The context is created inside the user's tap
   (Make my video / Render run on a click), so it is running before
   any async work. If audio setup fails for any reason the render
   still works, video-only, exactly as before — audio never breaks
   a video.
   Spoken dialogue is NOT in the file, honestly: the browser's
   speechSynthesis cannot be captured into a MediaStream — it plays
   straight to the speakers and exposes no audio stream — so no code
   can record it. Dialogue is shown as captions and the character's
   mouth moves on the dialogue beats. A real voice track needs a
   paid video/TTS service; the one free in-browser voice (Kokoro,
   ~90MB model download, slow on CPU) is not bundled here. */
var musicCtx=null, musicDest=null, musicNodes=[];
function ensureMusicCtx(){
  try{
    if(typeof AudioContext==='undefined'&&typeof window.webkitAudioContext==='undefined') return null;
    if(!musicCtx){ var AC=window.AudioContext||window.webkitAudioContext; musicCtx=new AC(); }
    if(musicCtx.state==='suspended'){ musicCtx.resume().catch(function(){}); }
    if(!musicDest) musicDest=musicCtx.createMediaStreamDestination();
    return musicCtx;
  }catch(e){ return null; }
}
function clearMusicNodes(){
  musicNodes.forEach(function(n){ try{ if(n.stop) n.stop(); }catch(e){} try{ if(n.disconnect) n.disconnect(); }catch(e){} });
  musicNodes=[];
}
function stopMusicBed(){
  clearMusicNodes();
  if(musicCtx&&musicCtx.state==='running'){ musicCtx.suspend().catch(function(){}); }
}
function startMusicBed(dur){
  var ctx=ensureMusicCtx();
  if(!ctx||!musicDest) return false;
  clearMusicNodes();
  if(ctx.state==='suspended'){ ctx.resume().catch(function(){}); }
  var t0=ctx.currentTime+0.08;
  var master=ctx.createGain(); master.gain.value=0.22;
  master.connect(musicDest); master.connect(ctx.destination);
  musicNodes.push(master);
  function note(freq,start,len,type,vol){
    var o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type||'triangle'; o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,start);
    g.gain.linearRampToValueAtTime(vol,start+0.06);
    g.gain.exponentialRampToValueAtTime(0.0001,start+len);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start+len+0.05);
    musicNodes.push(o);
  }
  /* Gentle pad chords: C – Am – F – G, one chord every 4 seconds. */
  var chords=[[261.63,329.63,392.00],[220.00,261.63,329.63],[174.61,220.00,261.63],[196.00,246.94,293.66]];
  for(var c=0;c<Math.ceil(dur/4);c++){
    var ch=chords[c%chords.length], cs=t0+c*4;
    ch.forEach(function(f){ note(f,cs,4.4,'sine',0.08); });
  }
  /* Cheerful pentatonic melody, 0.5s steps, 8s loop. */
  var mel=[659.25,783.99,880.00,783.99,659.25,523.25,587.33,659.25,783.99,880.00,783.99,659.25,587.33,659.25,523.25,0];
  var step=0.5, nSteps=Math.ceil(dur/step);
  for(var i=0;i<nSteps;i++){
    var f=mel[i%mel.length]; if(!f) continue;
    note(f,t0+i*step,0.55,'triangle',0.30);
    if(i%8===0) note(f*2,t0+i*step,0.4,'sine',0.06);
  }
  return true;
}
function renderVideo(){
  stopPreview();
  previewFallback=false;
  ensureMusicCtx(); /* v28: audio context must start inside this tap — the render starts after async picture work, when the gesture is long gone */
  /* v13: recover a stuck renderer instead of silently doing nothing.
     After a Cancel the old code left `rendering` true forever; if the
     recorder is gone/inactive there is no render in progress, so
     reset and carry on. */
  if(rendering){
    if(!activeRec||activeRec.state==='inactive'){ resetRenderUI('Ready — tap Render to try again.'); }
    else return;
  }
  if(!storyboard.length) generateStoryboard();
  if(!storyboard.length){alert('Generate a storyboard first.');return;}
  ensureSceneImages();
  const status=document.getElementById('renderStatus'), err=document.getElementById('renderError'),
    bar=document.getElementById('renderProgress'), btn=document.getElementById('renderBtn'),
    cancelBtn=document.getElementById('renderCancel'), dl=document.getElementById('downloadVideoBtn'),
    pb=document.getElementById('previewPlayBtn'), db=document.getElementById('previewDownloadBtn');
  if(err) err.textContent=''; if(dl) dl.style.display='none';
  if(pb) pb.style.display='none'; if(db) db.style.display='none';
  if(typeof MediaRecorder==='undefined'){
    startPreviewFallback('This browser cannot record video (MediaRecorder is not supported here — Safari on iPhone does not support in-browser video recording).');
    return;
  }
  const ratio=document.getElementById('anRatio').value, dur=parseInt(document.getElementById('anDur').value)||60;
  const q=document.getElementById('anQuality').value;
  const W=ratio==='9:16'?(q==='1080p'?1080:720):ratio==='16:9'?(q==='1080p'?1920:1280):(q==='1080p'?1080:720);
  const H=ratio==='9:16'?(q==='1080p'?1920:1280):ratio==='16:9'?(q==='1080p'?1080:720):(q==='1080p'?1080:720);
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;canvas.style.width='100%';canvas.style.maxWidth='480px';canvas.style.borderRadius='16px';canvas.style.display='block';
  const preview=document.getElementById('renderPreview'); if(preview){preview.innerHTML='';preview.appendChild(canvas);}
  const ctx=canvas.getContext('2d');
  if(!canvas.captureStream){
    startPreviewFallback('This browser cannot capture the canvas as video.');
    return;
  }
  /* v13: download format — MP4 / WebM, honestly. The user picks a
     format; the recorder tries that format's mime types first
     (Safari records MP4, Chrome records WebM). If the picked format
     is not supported here, the other format is used instead and the
     note next to Download says so plainly — a WebM file is NEVER
     renamed to .mp4. The filename always matches the real format. */
  const fmt=((document.getElementById('dlFormat')||{}).value)||'webm';
  const dlNote=document.getElementById('dlFormatNote'); if(dlNote) dlNote.textContent='';
  const mp4Mimes=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1.42E01E','video/mp4'];
  const webmMimes=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  const supported=function(list){return list.find(function(m){try{return MediaRecorder.isTypeSupported(m);}catch(e){return false;}})||'';};
  let mime=supported(fmt==='mp4'?mp4Mimes:webmMimes), mimeNote='';
  if(!mime){ mime=supported(fmt==='mp4'?webmMimes:mp4Mimes); if(mime) mimeNote='You picked '+fmt.toUpperCase()+', but this browser records '+(mime.indexOf('mp4')>=0?'MP4':'WebM')+' only.'; }
  if(!mime){ startPreviewFallback('This browser cannot record video in MP4 or WebM format.'); return; }
  const actualExt=mime.indexOf('mp4')>=0?'mp4':'webm';
  let rec;
  try{
    const stream=canvas.captureStream(30);
    /* v28: mix the free music bed in as a real audio track. The
       destination stream exists as soon as the context does, so the
       track is combined here; the notes themselves are scheduled
       in startRecording(), when recording actually starts. If the
       music cannot start, the render still works, video-only. */
    var recStream=stream;
    try{
      if(musicCtx&&musicDest){
        var aTracks=musicDest.stream.getAudioTracks();
        if(aTracks.length) recStream=new MediaStream(stream.getVideoTracks().concat(aTracks));
      }
    }catch(e2){}
    rec=new MediaRecorder(recStream, {mimeType:mime,videoBitsPerSecond:5000000});
  }catch(e){
    startPreviewFallback('Video recorder could not start in this browser ('+(e&&e.message?e.message:e)+').');
    return;
  }
  activeRec=rec; rendering=true; cancelRender=false;
  if(btn){btn.disabled=true;btn.textContent='⏳ Rendering…';}
  if(cancelBtn) cancelBtn.style.display='inline-block';
  if(status) status.textContent='Rendering 0s / '+dur+'s · Scene 1/'+storyboard.length+' … keep this tab open';
  if(bar) bar.style.width='0%';
  const chunks=[];rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
  rec.onerror=e=>{
    /* v13: a recorder error used to leave `rendering` true forever too. */
    const msg='Recorder error: '+((e&&e.error&&e.error.name)||'unknown')+'.';
    resetRenderUI('');
    if(status)status.textContent='Recording failed — showing the moving preview instead.';
    if(err)err.textContent=msg+' Try a shorter video (15s) in Chrome on a desktop.';
    startPreviewFallback(msg+' The recorder stopped, so here is the moving preview instead.');
  };
  rec.onstop=()=>{
    const wasPreview=previewFallback;
    rendering=false; activeRec=null; stopMusicBed(); /* v28: music stops with the recording */
    if(btn){btn.disabled=false;btn.textContent='▶ Render video in browser';}
    if(cancelBtn) cancelBtn.style.display='none';
    if(wasPreview) return; /* a preview fallback already took over the status text */
    if(!chunks.length||cancelRender){ if(status)status.textContent=cancelRender?'Render cancelled — tap Render again to try again.':'No video data was recorded — tap Render again, or try Chrome on a desktop.'; if(bar)bar.style.width='0%'; if(typeof qvRenderDone==='function'){var qf=qvRenderDone;qvRenderDone=null;try{qf(false);}catch(e){}} return; }
    const blob=new Blob(chunks,{type:mime||'video/webm'}); const url=URL.createObjectURL(blob); lastVideoUrl=url;
    /* v13: the live preview canvas is replaced by the finished video
       player, so the Animation page keeps fitting one screen. */
    const pv=document.getElementById('renderPreview'); if(pv) pv.innerHTML='';
    const v=document.getElementById('animVideo'); if(v){v.src=url; v.style.display='block'; v.controls=true; v.load();}
    if(dl){dl.href=url; dl.download='vitalize-storynest-video-'+dur+'s.'+actualExt; dl.textContent='⬇ Download video (.'+actualExt+')'; dl.style.display='inline-block';}
    if(dlNote) dlNote.textContent=mimeNote?mimeNote+' The file is .'+actualExt+' — convert it to '+fmt.toUpperCase()+' with VLC, CloudConvert or ffmpeg.':('Recorded as a real '+actualExt.toUpperCase()+' file in this browser.');
    if(status) status.textContent='Done — '+dur+'s · '+ratio+' · '+q+' · '+actualExt.toUpperCase()+'.';
    const note=document.getElementById('renderNote'); if(note) note.textContent='Video saved in the player — tap Download if it did not download automatically.';
    /* v13: auto-download is a bonus, not the only copy — on mobile it
       is often blocked, so the player + Download button above are the
       reliable copy. Never let a blocked auto-download look like a
       failure. */
    try{const a=document.createElement('a');a.href=url;a.download='vitalize-storynest-video-'+dur+'s.'+actualExt;document.body.appendChild(a);a.click();a.remove();}catch(e){}
    logHistory('video','Rendered '+dur+'s video '+ratio+' '+q); save();
    if(typeof qvRenderDone==='function'){var qf2=qvRenderDone;qvRenderDone=null;try{qf2(true);}catch(e){}}
  };
  const per=dur/storyboard.length; let start=performance.now();
  const sceneImgs=loadSceneImages();
  function startRecording(){
    /* v13: Cancel pressed while pictures were still loading used to be
       ignored — the render started anyway. Abort instead. */
    if(cancelRender){ resetRenderUI('Render cancelled — tap Render again to try again.'); return; }
    start=performance.now(); /* clock starts when recording starts, not while pictures were loading */
    drawSceneFrame(ctx,sceneImgs[0],storyboard[0],0,0,per,W,H);
    startMusicBed(dur); /* v28: music and video start together */
    try{ rec.start(250); }catch(e){ rendering=false; activeRec=null; stopMusicBed(); if(btn){btn.disabled=false;btn.textContent='▶ Render video in browser';} if(err)err.textContent='Recorder could not start: '+(e&&e.message?e.message:e); return; }
    renderTimer=setInterval(()=>{
      const t=(performance.now()-start)/1000;
      if(cancelRender||t>=dur){ clearInterval(renderTimer); renderTimer=null; try{ if(rec.state!=='inactive') rec.stop(); }catch(e){} return; }
      const idx=Math.min(storyboard.length-1,Math.floor(t/per));
      drawSceneFrame(ctx,sceneImgs[idx],storyboard[idx],idx,t,per,W,H,idx>0?sceneImgs[idx-1]:null);
      const done=Math.floor(t);
      if(status) status.textContent='Rendering… '+done+'s / '+dur+'s · Scene '+(idx+1)+'/'+storyboard.length+' — keep this tab open';
      if(bar) bar.style.width=Math.round(t/dur*100)+'%';
    },100);
  }
  /* Wait for the scene pictures to load (max ~1.5s) before recording,
     so frame 1 already shows the illustration, not a blank backdrop. */
  const imgsReady=Promise.all(sceneImgs.map(im=>im.complete?Promise.resolve():new Promise(res=>{im.onload=res;im.onerror=res;})));
  Promise.race([imgsReady,new Promise(res=>setTimeout(res,1500))]).then(startRecording);
}
function cancelVideoRender(){
  /* v13: Cancel must REALLY stop the recorder. The old code only
     cleared the interval — and the interval was the only place that
     called rec.stop() — so the recorder kept running, onstop never
     fired and the renderer stayed stuck on `rendering=true` forever.
     Now: stop a playing preview, or stop the recorder (onstop resets
     the UI), or — if pictures are still loading and there is no
     recorder yet — reset now and keep the cancel flag so
     startRecording() aborts when the preload finishes. */
  if(previewPlaying){ stopPreview(); const st=document.getElementById('renderStatus'); if(st) st.textContent='Preview stopped.'; return; }
  if(!rendering) return;
  cancelRender=true;
  if(renderTimer){clearInterval(renderTimer);renderTimer=null;}
  if(activeRec && activeRec.state!=='inactive'){ try{activeRec.stop();}catch(e){ resetRenderUI('Render cancelled — tap Render again to try again.'); } }
  else{
    resetRenderUI('Render cancelled — tap Render again to try again.');
    cancelRender=true; /* keep the flag: startRecording() must abort */
  }
}

/* ---------- Real video (v17) ----------
   Real moving clips with spoken dialogue, made through the site's
   OWN video endpoint (VIDEO_PROXY_URL below) — the browser never
   talks to any video provider directly, and NO provider name, model
   name, API key or account appears anywhere in this file, in the
   UI, or in any network call the browser can see. Server side lives
   in api/generate-video.js (same pattern as api/generate-image.js).
   Flow — ONE finished video, never separate files for the user to
   stitch:
   1. Each storyboard scene (up to 8) becomes one 8s clip. Scene 1
      starts from its picture; every later scene starts from the
      PREVIOUS clip's last frame (extracted in this browser), so the
      joins are invisible.
   2. The clips play one after another in the player below.
   3. They are joined into ONE file automatically: the joined
      playback is recorded (canvas + the clips' sound) into a single
      .mp4/.webm, shown in the same player with ONE download button.
      Joining plays through once in real time (~1 min for 1 min).
      If this browser blocks sound autoplay, the join waits for one
      tap on the Download button instead — a tap is a fresh gesture,
      so the sound records. A joined file is never faked: if the
      join cannot run, the clips still play in order and the note
      says so plainly.
   If the video service is busy, limited or unconfigured, the
   built-in renderer above still works — a clip simply falls back
   to the built-in video, never to a dead end. */
const VIDEO_PROXY_URL='https://vitalize-storynest.vercel.app/api/generate-video';
let rvBusy=false, rvCancel=false, rvClips=[], rvAutoplayBlocked=false, lastComicPanels=[];
function rvAspect(){ var r=(document.getElementById('anRatio')||{}).value||'9:16'; return r==='16:9'?'16:9':'9:16'; }
/* First frame for a clip: the scene picture, rasterised to a JPEG
   (max 1024px) so the upload stays small and the format is one the
   video service accepts (built-in pictures are SVG, which it is
   not). Returns a data URL, or null if the picture cannot be read. */
function rasterizeFirstFrame(img){
  return new Promise(function(resolve){
    if(!img||typeof img!=='string'){ resolve(null); return; }
    var im=new Image();
    im.onload=function(){
      try{
        var w=im.naturalWidth||800, h=im.naturalHeight||600;
        if(img.indexOf('data:image/svg+xml')!==0 && w<=1024){ resolve(img); return; }
        var sc=Math.min(1,1024/w);
        var c=document.createElement('canvas');
        c.width=Math.max(2,Math.round(w*sc)); c.height=Math.max(2,Math.round(h*sc));
        var ctx=c.getContext('2d');
        ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,c.width,c.height);
        ctx.drawImage(im,0,0,c.width,c.height);
        resolve(c.toDataURL('image/jpeg',0.85));
      }catch(e){ resolve(null); }
    };
    im.onerror=function(){ resolve(null); };
    im.src=img;
  });
}
async function submitRealVideo(opts){
  const r=await fetchWithTimeout(VIDEO_PROXY_URL,60000,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(opts)});
  if(!r.ok){const e=new Error('Video service HTTP '+r.status);e.status=r.status;throw e;}
  const j=await r.json();
  if(!j||typeof j.job_id!=='string') throw new Error('Video service: no job id');
  return j.job_id;
}
async function pollRealVideo(jobId,onProgress,cancelledFn){
  const isCancelled=cancelledFn||function(){return rvCancel;};
  const started=Date.now();
  for(;;){
    if(isCancelled()) throw new Error('cancelled');
    if(Date.now()-started>12*60*1000) throw new Error('Video took too long — try again.');
    await new Promise(function(res){setTimeout(res,10000);});
    if(isCancelled()) throw new Error('cancelled');
    const r=await fetchWithTimeout(VIDEO_PROXY_URL+'?action=status&id='+encodeURIComponent(jobId),30000);
    if(!r.ok){const e=new Error('Video service HTTP '+r.status);e.status=r.status;throw e;}
    const j=await r.json();
    if(j&&j.status==='completed'){
      if(!j.video_url) throw new Error('The finished clip expired before download.');
      return j;
    }
    if(j&&j.status==='failed') throw new Error('The video service could not make this clip.');
    if(onProgress) onProgress(j&&typeof j.progress==='number'?j.progress:null);
  }
}
/* Fetch a finished clip as a same-origin blob URL when the host
   allows it — same-origin blobs make the join reliable (canvas and
   sound both work). Falls back to the signed URL for plain
   playback when the fetch is blocked. */
async function fetchClipBlob(url){
  try{
    const r=await fetch(url,{mode:'cors'});
    if(!r.ok) return null;
    const b=await r.blob();
    if(!b||!b.size) return null;
    return URL.createObjectURL(b);
  }catch(e){ return null; }
}
/* Last frame of a finished clip, as a JPEG data URL — the next
   clip's first frame. Returns null when the frame cannot be read
   (the next clip then starts from its own scene picture). */
function extractLastFrame(url){
  return new Promise(function(resolve){
    var done=false;
    function fin(v){ if(!done){done=true; resolve(v);} }
    var v=document.createElement('video');
    v.crossOrigin='anonymous'; v.muted=true; v.preload='auto';
    var to=setTimeout(function(){ v.src=''; fin(null); },20000);
    v.addEventListener('error',function(){ clearTimeout(to); fin(null); });
    v.addEventListener('loadedmetadata',function(){
      try{ v.currentTime=Math.max(0,(v.duration||8)-0.15); }catch(e){ clearTimeout(to); fin(null); }
    });
    v.addEventListener('seeked',function(){
      clearTimeout(to);
      try{
        var c=document.createElement('canvas');
        c.width=v.videoWidth||1280; c.height=v.videoHeight||720;
        c.getContext('2d').drawImage(v,0,0,c.width,c.height);
        fin(c.toDataURL('image/jpeg',0.85));
      }catch(e){ fin(null); }
      v.src='';
    });
    v.src=url;
  });
}
function rvVideoPrompt(scene,line){
  var p=scene.prompt||((scene.narration||'')+' — '+bibleText());
  p+=' Motion: gentle, smooth and continuous from the first frame; the characters stay the same throughout.';
  if(line){
    var clean=String(line).replace(/"/g,'').trim();
    if(clean) p+=' Spoken dialogue — the character says: "'+clean+'". The speaking character\'s mouth moves in sync with the words, natural lip-sync.';
  }
  return p.slice(0,1100);
}
function prefillRvLines(){
  var el=document.getElementById('rvLines'); if(!el||!storyboard.length) return;
  el.value=storyboard.map(function(s){
    var t=(s.narration||'').split('.')[0].trim();
    return t?t+'.':'';
  }).join('\n');
}
function playRvClips(){
  var v=document.getElementById('rvVideo'); if(!v||!rvClips.length) return;
  var idx=0, pre=null;
  function playIdx(i){
    idx=i; var c=rvClips[i]; if(!c) return;
    v.src=c.blobUrl||c.url; v.style.display='block';
    var p=v.play(); if(p&&p.catch) p.catch(function(){});
    if(pre){ pre.src=''; pre=null; }
    if(rvClips[i+1]){ pre=document.createElement('video'); pre.preload='auto'; pre.src=rvClips[i+1].blobUrl||rvClips[i+1].url; }
  }
  v.onended=function(){ if(idx+1<rvClips.length) playIdx(idx+1); };
  playIdx(0);
}
function cancelRealVideo(){
  rvCancel=true;
  var st=document.getElementById('rvStatus');
  if(st) st.textContent='Cancelling…';
}
async function generateJoinedRealVideo(){
  if(rvBusy) return;
  if(!storyboard.length) generateStoryboard();
  if(!storyboard.length){ alert('Generate a storyboard first.'); return; }
  ensureSceneImages();
  var status=document.getElementById('rvStatus'), bar=document.getElementById('rvProgress'),
      btn=document.getElementById('rvBtn'), cancelBtn=document.getElementById('rvCancel'),
      note=document.getElementById('rvNote'), vid=document.getElementById('rvVideo'),
      joinDl=document.getElementById('rvJoinDownload'), joinNote=document.getElementById('rvJoinNote');
  var lines=(document.getElementById('rvLines').value||'').split('\n');
  var scenes=storyboard.slice(0,8);
  var totalSecs=scenes.length*8;
  rvBusy=true; rvCancel=false; rvAutoplayBlocked=false; rvClips=[];
  if(btn){btn.disabled=true;btn.textContent='⏳ Making your video…';}
  if(cancelBtn) cancelBtn.style.display='inline-block';
  if(joinDl) joinDl.style.display='none';
  if(joinNote) joinNote.textContent='';
  if(vid){vid.style.display='none';vid.removeAttribute('src');vid.load();}
  function setBar(p){ if(bar) bar.style.width=Math.max(0,Math.min(100,p))+'%'; }
  try{
    for(var i=0;i<scenes.length;i++){
      if(rvCancel) throw new Error('cancelled');
      var s=scenes[i];
      if(status) status.textContent='Clip '+(i+1)+' of '+scenes.length+' — making the moving scene… (a few minutes in total)';
      setBar(Math.round(i/scenes.length*70));
      var first;
      if(i===0){
        first=await rasterizeFirstFrame(s.img);
      }else{
        var prev=rvClips[i-1];
        var last=await extractLastFrame(prev.blobUrl||prev.url);
        first=last||await rasterizeFirstFrame(s.img);
      }
      var jobId=await submitRealVideo({prompt:rvVideoPrompt(s,lines[i]||''),image:first,duration:8,aspect_ratio:rvAspect(),with_audio:true});
      var done=await pollRealVideo(jobId,function(p){
        if(status) status.textContent='Clip '+(i+1)+' of '+scenes.length+' — rendering…'+(p!=null?' '+Math.round(p)+'%':'');
        setBar(Math.round((i+(p||0)/100)/scenes.length*70));
      });
      var blobUrl=await fetchClipBlob(done.video_url);
      rvClips.push({url:done.video_url,blobUrl:blobUrl,scene:s.n});
      if(status) status.textContent='Clip '+(i+1)+' of '+scenes.length+' done — playing it below while the next one is made.';
      setBar(Math.round((i+1)/scenes.length*70));
      playRvClips();
    }
    if(rvClips.length===1){
      /* One clip IS the finished video — no join needed. */
      if(vid){vid.src=rvClips[0].blobUrl||rvClips[0].url;vid.style.display='block';vid.load();}
      if(joinDl){joinDl.href=rvClips[0].blobUrl||rvClips[0].url;joinDl.download='ekiddy-real-video-8s.mp4';joinDl.textContent='⬇ Download video (.mp4)';joinDl.style.display='inline-block';}
      if(status) status.textContent='Done — one 8s real video with sound.';
      setBar(100);
      logHistory('video','Real video ready: 1 clip, 8s'); save();
      return;
    }
    /* Join all clips into ONE finished video, automatically. */
    if(status) status.textContent='All '+rvClips.length+' clips ready — joining them into one '+totalSecs+'s video now. Keep this tab open and the sound on.';
    setBar(75);
    var joined=await joinRvClips(function(done,total){
      setBar(75+Math.round(done/total*25));
      if(status) status.textContent='Joining… '+Math.round(done)+'s / '+total+'s — keep this tab open';
    });
    if(joined){
      if(vid){vid.src=joined.url;vid.style.display='block';vid.load();}
      if(joinDl){joinDl.href=joined.url;joinDl.download='ekiddy-video-'+totalSecs+'s.'+joined.ext;joinDl.textContent='⬇ Download 1-minute video (.'+joined.ext+')';joinDl.style.display='inline-block';}
      if(joinNote) joinNote.textContent=joined.withAudio?'One finished video — picture and spoken dialogue together.':'One finished video — the picture joined, but this browser could not capture the sound into the file. The clips above still play with sound.';
      if(status) status.textContent='Done — one '+totalSecs+'s video, ready to watch and download.';
      setBar(100);
      logHistory('video','Real video joined: '+rvClips.length+' clips, '+totalSecs+'s'); save();
    }else if(rvAutoplayBlocked){
      /* Sound autoplay was blocked, so the automatic join stopped
         rather than making a silent file. One tap on Download is a
         fresh gesture, so the join records with sound then. */
      if(joinDl){joinDl.href='#';joinDl.textContent='⬇ Download 1-minute video';joinDl.style.display='inline-block';joinDl.onclick=function(e){e.preventDefault();downloadJoinedVideo();return false;};}
      if(joinNote) joinNote.textContent='Tap Download to join the clips into one file — it plays through once (about a minute) so the spoken dialogue is in the file too.';
      if(status) status.textContent='Clips ready — playing in order above. Tap Download for the single joined file.';
      setBar(100);
      playRvClips();
    }else{
      playRvClips();
      if(joinNote) joinNote.textContent='The clips play one after another above. This browser could not join them into a single file — try Chrome on a desktop for the joined download.';
      if(status) status.textContent='Clips ready — playing in order above.';
      setBar(100);
    }
  }catch(e){
    if(e&&e.message==='cancelled'){ if(status) status.textContent='Cancelled — tap Generate to try again.'; }
    else if(e&&e.status===429){ if(status) status.textContent='The video service is busy today (daily limit) — try again tomorrow, or use the built-in renderer above.'; }
    else if(e&&e.status===503){ if(status) status.textContent='The video service is not set up yet — use the built-in renderer above.'; }
    else { if(status) status.textContent='Real video isn\'t available right now — the built-in renderer above still works.'; }
    setBar(0);
    if(rvClips.length) playRvClips();
  }finally{
    rvBusy=false;
    if(btn){btn.disabled=false;btn.textContent='▶ Generate 1-minute real video';}
    if(cancelBtn) cancelBtn.style.display='none';
  }
}
async function downloadJoinedVideo(){
  /* Tap = fresh user gesture, so clip playback with sound is
     allowed and the joined file records with dialogue. */
  var joinDl=document.getElementById('rvJoinDownload'), joinNote=document.getElementById('rvJoinNote'),
      status=document.getElementById('rvStatus'), bar=document.getElementById('rvProgress'),
      vid=document.getElementById('rvVideo');
  if(!rvClips.length||rvClips.length<2) return;
  rvCancel=false; rvAutoplayBlocked=false;
  if(joinDl){joinDl.textContent='⏳ Joining…';}
  if(status) status.textContent='Joining the clips into one video — keep this tab open and the sound on.';
  var totalSecs=rvClips.length*8;
  var joined=await joinRvClips(function(done,total){
    if(bar) bar.style.width=Math.round(75+done/total*25)+'%';
    if(status) status.textContent='Joining… '+Math.round(done)+'s / '+total+'s — keep this tab open';
  });
  if(joined){
    if(vid){vid.src=joined.url;vid.style.display='block';vid.load();}
    if(joinDl){joinDl.href=joined.url;joinDl.download='ekiddy-video-'+totalSecs+'s.'+joined.ext;joinDl.textContent='⬇ Download 1-minute video (.'+joined.ext+')';joinDl.onclick=null;}
    if(joinNote) joinNote.textContent=joined.withAudio?'One finished video — picture and spoken dialogue together.':'One finished video — the picture joined, but this browser could not capture the sound into the file. The clips above still play with sound.';
    if(status) status.textContent='Done — one '+totalSecs+'s video, ready to watch and download.';
    if(bar) bar.style.width='100%';
    logHistory('video','Real video joined on download: '+rvClips.length+' clips, '+totalSecs+'s'); save();
  }else{
    if(joinDl){joinDl.textContent='⬇ Download 1-minute video';}
    if(joinNote) joinNote.textContent='This browser could not join the clips — the clips above still play in order. Try Chrome on a desktop for the joined download.';
    if(status) status.textContent='Joining failed — clips still play in order above.';
  }
}
async function joinRvClips(onTick){
  /* Record the joined playback into ONE file: draw each clip, in
     order, onto one canvas and record that canvas with
     MediaRecorder — the same proven path as the built-in renderer.
     Sound comes from the clips through an AudioContext so the
     spoken dialogue is in the file too. Returns {url, ext,
     withAudio} or null. Sets rvAutoplayBlocked when sound playback
     was refused, so the caller can offer a tap-to-join instead of
     silently making a soundless file. */
  if(!rvClips.length) return null;
  if(typeof MediaRecorder==='undefined') return null;
  rvAutoplayBlocked=false;
  var first=document.createElement('video');
  first.preload='auto'; first.src=rvClips[0].blobUrl||rvClips[0].url;
  var meta=await new Promise(function(res){
    var to=setTimeout(function(){res(null);},15000);
    first.addEventListener('loadedmetadata',function(){clearTimeout(to);res({w:first.videoWidth||1280,h:first.videoHeight||720});});
    first.addEventListener('error',function(){clearTimeout(to);res(null);});
  });
  if(!meta) return null;
  var W=meta.w,H=meta.h;
  var canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
  var ctx=canvas.getContext('2d');
  var fmt=((document.getElementById('dlFormat')||{}).value)||'webm';
  var mp4Mimes=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1.42E01E','video/mp4'];
  var webmMimes=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  var supported=function(list){return list.find(function(m){try{return MediaRecorder.isTypeSupported(m);}catch(e){return false;}})||'';};
  var mime=supported(fmt==='mp4'?mp4Mimes:webmMimes);
  if(!mime) mime=supported(fmt==='mp4'?webmMimes:mp4Mimes);
  if(!mime) return null;
  var ext=mime.indexOf('mp4')>=0?'mp4':'webm';
  var stream=canvas.captureStream(30);
  var withAudio=false, actx=null, dest=null;
  try{
    actx=new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==='suspended'){ await actx.resume(); }
    dest=actx.createMediaStreamDestination();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }catch(e){ actx=null; dest=null; }
  var rec;
  try{ rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5000000}); }
  catch(e){ if(actx){try{actx.close();}catch(e2){}} return null; }
  var chunks=[];
  rec.ondataavailable=function(e){ if(e.data&&e.data.size) chunks.push(e.data); };
  var stopped=new Promise(function(res){ rec.onstop=function(){res();}; });
  try{ rec.start(250); }catch(e){ if(actx){try{actx.close();}catch(e2){}} return null; }
  var totalDur=0, cancelled=false;
  for(var i=0;i<rvClips.length;i++){
    if(rvCancel){ cancelled=true; break; }
    var clip=rvClips[i];
    var el=document.createElement('video');
    el.preload='auto'; el.playsInline=true; el.volume=1; el.muted=false;
    el.src=clip.blobUrl||clip.url;
    var audioOk=false;
    if(actx&&dest){
      try{
        var srcNode=actx.createMediaElementSource(el);
        srcNode.connect(dest); srcNode.connect(actx.destination);
        audioOk=true;
      }catch(e){ audioOk=false; }
    }
    var loaded=await new Promise(function(res){
      var to=setTimeout(function(){res(false);},20000);
      el.addEventListener('loadedmetadata',function(){clearTimeout(to);res(true);});
      el.addEventListener('error',function(){clearTimeout(to);res(false);});
    });
    if(!loaded||rvCancel){ if(rvCancel) cancelled=true; el.src=''; continue; }
    var dur=el.duration||8;
    var played=false, blocked=false;
    try{
      await el.play();
      played=true;
    }catch(e){
      if(e&&e.name==='NotAllowedError'){ blocked=true; }
    }
    if(blocked){ rvAutoplayBlocked=true; el.src=''; break; }
    if(!played){ el.src=''; continue; }
    if(audioOk) withAudio=true;
    await new Promise(function(res){
      var startT=performance.now(), raf=null, done=false;
      function frame(){
        if(done) return;
        if(rvCancel){ done=true; if(raf) cancelAnimationFrame(raf); res(false); return; }
        try{
          var iw=el.videoWidth||W, ih=el.videoHeight||H;
          var sc=Math.max(W/iw,H/ih), dw=iw*sc, dh=ih*sc;
          ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
          ctx.drawImage(el,(W-dw)/2,(H-dh)/2,dw,dh);
        }catch(e){ /* a blocked frame: keep the last good frame */ }
        if(onTick) onTick((performance.now()-startT)/1000+totalDur, rvClips.length*8);
        if(el.ended||el.currentTime>=dur-0.05){ done=true; res(true); return; }
        raf=requestAnimationFrame(frame);
      }
      el.addEventListener('ended',function(){ if(!done){done=true; if(raf) cancelAnimationFrame(raf); res(true);} });
      setTimeout(function(){ if(!done){done=true; if(raf) cancelAnimationFrame(raf); res(true);} },(dur+5)*1000);
      raf=requestAnimationFrame(frame);
    });
    totalDur+=dur;
    el.src='';
    if(rvCancel){ cancelled=true; break; }
  }
  try{ if(rec.state!=='inactive') rec.stop(); }catch(e){}
  await stopped;
  if(actx){ try{ actx.close(); }catch(e){} }
  if(cancelled||rvAutoplayBlocked||!chunks.length) return null;
  var blob=new Blob(chunks,{type:mime});
  return {url:URL.createObjectURL(blob),ext:ext,withAudio:withAudio};
}
async function generateComicPanelVideo(i){
  /* One comic panel becomes one 8s moving clip with its dialogue
     spoken — same video service, same first-frame picture. */
  var p=lastComicPanels&&lastComicPanels[i];
  var box=document.getElementById('comic-panel-video-'+i);
  if(!p||!box) return;
  box.innerHTML='<p class="muted small">Making the moving panel… (a minute or so — keep this tab open)</p>';
  try{
    var first=await rasterizeFirstFrame(p.img);
    var line=String(p.dialogue||'').replace(/"/g,'').trim();
    var prompt=(p.text||'')+' — '+bibleText()+' Motion: gentle, smooth and continuous from the first frame; the characters stay the same throughout.'
      +(line?' Spoken dialogue — the character says: "'+line+'". The speaking character\'s mouth moves in sync with the words, natural lip-sync.':'');
    var jobId=await submitRealVideo({prompt:prompt.slice(0,1100),image:first,duration:8,aspect_ratio:'16:9',with_audio:true});
    var done=await pollRealVideo(jobId,null,function(){return false;});
    var blobUrl=await fetchClipBlob(done.video_url);
    var src=blobUrl||done.video_url;
    box.innerHTML='<video controls playsinline src="'+src+'" style="width:100%;border-radius:12px"></video><div class="row"><a class="btn primary" href="'+src+'" download="ekiddy-comic-panel-'+(i+1)+'-8s.mp4">⬇ Download panel video (.mp4)</a></div>';
    logHistory('video','Comic panel '+(i+1)+' real video ready'); save();
  }catch(e){
    if(e&&e.status===429) box.innerHTML='<p class="muted small">The video service is busy today (daily limit) — the picture above stays.</p>';
    else if(e&&e.status===503) box.innerHTML='<p class="muted small">The video service is not set up yet — the picture above stays.</p>';
    else box.innerHTML='<p class="muted small">Real video isn\'t available right now — the picture above stays.</p>';
  }
}

/* ---------- Quick Video — in-site video (v24) ----------
   The site makes its own videos now — no other app, no video
   service, no key, no cost. How it works:
   1. The user gives only a title, a topic and a wish-list, picks a
      character (upload or a sample) and a style picture. The
      storyboard is built in this page from those inputs, with one
      spoken line per scene and the Character Bible for continuity.
   2. Scene pictures come from the site's own image endpoint, fired
      all at once — the shared slot paces each start ~4s apart, so
      they overlap and finish fast. A scene that cannot be generated
      keeps its built-in picture; a video never fails for a picture.
      For Quick Video the pictures are BACKGROUNDS (no character in
      them) — the character below is the actor, so it can really move.
   3. The built-in renderer (canvas + MediaRecorder, 30fps) draws
      each scene, crossfades between scenes, and draws the character
      on top as moving parts: arms and legs swing, the mouth opens
      and closes on the dialogue beats. The finished video previews
      and downloads from the Animation Studio, and the project is
      saved to My Projects and the Library (pictures in IndexedDB,
      same as books).
   The old external-video mode is hidden from the UI; its code stays
   in this file and api/generate-video.js stays in the repo, dormant. */
var QV_STYLES=['3D Cartoon','Anime','Pixar-inspired 3D','Watercolor','Storybook Illustration','Disney-inspired Fairy Tale','Clay Animation','Paper Cut','Hand Drawn','Digital Painting'];
var QV_ANIMS=[{id:'talk',label:'Talk & smile'},{id:'wave',label:'Wave hello'},{id:'walk',label:'Walk'},{id:'run',label:'Run'},{id:'dance',label:'Dance'},{id:'jump',label:'Jump for joy'}];
var qvStyle='3D Cartoon', qvAnim='talk', qvCharId='boy', qvCharImg=null, qvCharOn=false, qvTitle='', qvBusy=false, qvCancel=false, qvRenderDone=null;
var qvPartCache={}, qvCharImgEl=null;
/* Sample characters — multi-part SVGs on a 200x300 stage, so the
   renderer can swing each limb and the mouth separately. Every part
   is drawn in the same 200x300 space, so the parts always line up. */
var QV_CHARS={
boy:{name:'Max',kind:'Boy hero',face:'big brown eyes, blush cheeks',hair:'messy black hair',outfit:'yellow top and navy shorts',colors:'yellow, navy, purple',
 parts:{
  legL:'<rect x="79" y="206" width="20" height="70" rx="10" fill="#1e3a5f"/><ellipse cx="89" cy="282" rx="15" ry="8" fill="#6d28d9"/>',
  legR:'<rect x="101" y="206" width="20" height="70" rx="10" fill="#1e3a5f"/><ellipse cx="111" cy="282" rx="15" ry="8" fill="#6d28d9"/>',
  body:'<path d="M66 128 Q100 116 134 128 L140 204 Q100 216 60 204 Z" fill="#f59e0b"/><circle cx="100" cy="128" r="7" fill="#fbbf24"/>',
  armL:'<rect x="56" y="130" width="17" height="58" rx="8" fill="#f59e0b"/><circle cx="64" cy="192" r="10" fill="#fcd9b8"/>',
  armR:'<rect x="127" y="130" width="17" height="58" rx="8" fill="#f59e0b"/><circle cx="136" cy="192" r="10" fill="#fcd9b8"/>',
  head:'<circle cx="100" cy="80" r="42" fill="#fcd9b8"/><path d="M58 78 Q54 30 100 28 Q146 30 142 78 Q136 52 122 56 Q126 40 100 42 Q74 40 78 56 Q64 52 58 78 Z" fill="#1e1b2e"/><path d="M72 40 L78 24 L86 40 Z M96 34 L102 18 L110 36 Z M118 40 L126 26 L132 44 Z" fill="#1e1b2e"/><circle cx="84" cy="80" r="7" fill="#5b3a1a"/><circle cx="116" cy="80" r="7" fill="#5b3a1a"/><circle cx="86" cy="78" r="2.5" fill="#fff"/><circle cx="118" cy="78" r="2.5" fill="#fff"/><circle cx="72" cy="96" r="7" fill="#fda4af" opacity="0.8"/><circle cx="128" cy="96" r="7" fill="#fda4af" opacity="0.8"/>',
  mouthClosed:'<path d="M88 104 Q100 113 112 104" stroke="#7f1d1d" stroke-width="4" fill="none" stroke-linecap="round"/>',
  mouthOpen:'<ellipse cx="100" cy="107" rx="9" ry="11" fill="#7f1d1d"/><ellipse cx="100" cy="111" rx="5" ry="4" fill="#f87171"/>'
 },
 pivots:{armL:[64,134],armR:[136,134],legL:[89,210],legR:[111,210],head:[100,80]}},
girl:{name:'Lily',kind:'Girl hero',face:'big brown eyes, round black glasses, blush cheeks',hair:'long dark wavy hair, purple beanie with a pom-pom',outfit:'pink dress',colors:'pink, purple, gold',
 parts:{
  legL:'<rect x="82" y="206" width="15" height="62" rx="7" fill="#fcd9b8"/><ellipse cx="89" cy="274" rx="12" ry="7" fill="#db2777"/>',
  legR:'<rect x="103" y="206" width="15" height="62" rx="7" fill="#fcd9b8"/><ellipse cx="111" cy="274" rx="12" ry="7" fill="#db2777"/>',
  body:'<path d="M70 126 L130 126 L144 206 Q100 218 56 206 Z" fill="#ec4899"/><circle cx="100" cy="140" r="6" fill="#fbcfe8"/>',
  armL:'<rect x="58" y="130" width="16" height="56" rx="8" fill="#ec4899"/><circle cx="66" cy="190" r="10" fill="#fcd9b8"/>',
  armR:'<rect x="126" y="130" width="16" height="56" rx="8" fill="#ec4899"/><circle cx="134" cy="190" r="10" fill="#fcd9b8"/>',
  head:'<path d="M56 66 Q50 140 62 158 L138 158 Q150 140 144 66 Q142 28 100 28 Q58 28 56 66 Z" fill="#312e81"/><circle cx="100" cy="80" r="42" fill="#fcd9b8"/><path d="M60 64 Q58 24 100 22 Q142 24 140 64 Q132 44 100 44 Q68 44 60 64 Z" fill="#6d28d9"/><circle cx="100" cy="20" r="10" fill="#fbbf24"/><circle cx="84" cy="80" r="14" fill="none" stroke="#111827" stroke-width="3"/><circle cx="116" cy="80" r="14" fill="none" stroke="#111827" stroke-width="3"/><path d="M98 80 L102 80" stroke="#111827" stroke-width="3"/><circle cx="84" cy="80" r="6" fill="#5b3a1a"/><circle cx="116" cy="80" r="6" fill="#5b3a1a"/><circle cx="72" cy="96" r="7" fill="#fda4af" opacity="0.8"/><circle cx="128" cy="96" r="7" fill="#fda4af" opacity="0.8"/>',
  mouthClosed:'<path d="M88 104 Q100 113 112 104" stroke="#7f1d1d" stroke-width="4" fill="none" stroke-linecap="round"/>',
  mouthOpen:'<ellipse cx="100" cy="107" rx="9" ry="11" fill="#7f1d1d"/><ellipse cx="100" cy="111" rx="5" ry="4" fill="#f87171"/>'
 },
 pivots:{armL:[66,134],armR:[134,134],legL:[89,210],legR:[111,210],head:[100,80]}},
puppy:{name:'Pip',kind:'Puppy friend',face:'big dark eyes, brown nose, floppy ears',hair:'tan fur with a cream belly',outfit:'a red collar',colors:'tan, cream, red',
 parts:{
  tail:'<path d="M142 190 Q168 172 162 140" stroke="#b45309" stroke-width="14" fill="none" stroke-linecap="round"/>',
  legL:'<ellipse cx="66" cy="266" rx="15" ry="9" fill="#b45309"/>',
  legR:'<ellipse cx="134" cy="266" rx="15" ry="9" fill="#b45309"/>',
  body:'<ellipse cx="100" cy="200" rx="46" ry="62" fill="#d97706"/><ellipse cx="100" cy="212" rx="26" ry="34" fill="#fde68a"/><circle cx="100" cy="152" r="7" fill="#dc2626"/>',
  armL:'<rect x="76" y="208" width="16" height="62" rx="8" fill="#d97706"/><ellipse cx="84" cy="274" rx="11" ry="7" fill="#92400e"/>',
  armR:'<rect x="108" y="208" width="16" height="62" rx="8" fill="#d97706"/><ellipse cx="116" cy="274" rx="11" ry="7" fill="#92400e"/>',
  head:'<ellipse cx="58" cy="88" rx="14" ry="30" fill="#92400e" transform="rotate(15 58 88)"/><ellipse cx="142" cy="88" rx="14" ry="30" fill="#92400e" transform="rotate(-15 142 88)"/><circle cx="100" cy="82" r="44" fill="#d97706"/><ellipse cx="100" cy="98" rx="20" ry="13" fill="#fde68a"/><ellipse cx="100" cy="92" rx="7" ry="5" fill="#1e1b2e"/><circle cx="82" cy="74" r="6" fill="#1e1b2e"/><circle cx="118" cy="74" r="6" fill="#1e1b2e"/><circle cx="84" cy="72" r="2" fill="#fff"/><circle cx="120" cy="72" r="2" fill="#fff"/>',
  mouthClosed:'<path d="M92 106 Q100 112 108 106" stroke="#1e1b2e" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  mouthOpen:'<ellipse cx="100" cy="110" rx="8" ry="9" fill="#7f1d1d"/><ellipse cx="100" cy="113" rx="4.5" ry="3.5" fill="#f87171"/>'
 },
 pivots:{armL:[84,214],armR:[116,214],legL:[66,268],legR:[134,268],head:[100,82],tail:[142,190]}}
};
var QV_PART_ORDER=['tail','legL','legR','body','armL','armR','head'];
function qvPartImg(charId,part){
  var key=charId+':'+part;
  if(qvPartCache[key]) return qvPartCache[key];
  var c=QV_CHARS[charId];
  if(!c||!c.parts[part]) return null;
  var im=new Image();
  im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">'+c.parts[part]+'</svg>');
  qvPartCache[key]=im;
  return im;
}
function qvCharSVG(id){
  var c=QV_CHARS[id]; if(!c) return '';
  var inner=QV_PART_ORDER.map(function(p){return c.parts[p]||'';}).join('')+(c.parts.mouthClosed||'');
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="#f8fafc"/>'+inner+'</svg>');
}
function renderQVPickers(){
  var cs=document.getElementById('qvChars');
  if(cs) cs.innerHTML=Object.keys(QV_CHARS).map(function(id){
    var c=QV_CHARS[id];
    return '<button type="button" class="qv-char'+(qvCharId===id&&qvCharOn?' sel':'')+'" onclick="qvSetChar(\''+id+'\')"><img src="'+qvCharSVG(id)+'" alt="'+esc(c.name)+'"><span>'+esc(c.name)+'</span><small>'+esc(c.kind)+'</small></button>';
  }).join('');
  var ss=document.getElementById('qvStyles');
  if(ss) ss.innerHTML=QV_STYLES.map(function(st){
    return '<button type="button" class="qv-style'+(qvStyle===st?' sel':'')+'" onclick="qvSetStyle(\''+esc(st)+'\')"><img src="'+makeSVG({scene:'A brave little hero in a magical forest',text:''},st)+'" alt="'+esc(st)+'"><span>'+esc(st)+'</span></button>';
  }).join('');
}
function qvSetStyle(st){ qvStyle=st; renderQVPickers(); }
function qvSetChar(id){
  qvCharId=id; qvCharOn=true; qvCharImg=null; qvCharImgEl=null;
  var fi=document.getElementById('qvCharFile'); if(fi) fi.value='';
  var pv=document.getElementById('qvCharPreview'); if(pv) pv.style.display='none';
  var nm=document.getElementById('qvCharName'); if(nm) nm.textContent='Using sample: '+((QV_CHARS[id]||{}).name||id)+'. Upload a picture above to use your own character instead.';
  renderQVPickers();
}
function qvCharFileChanged(input){
  var f=input&&input.files&&input.files[0]; if(!f) return;
  if(f.size>5*1024*1024){ alert('That picture is over 5MB — pick a smaller one.'); input.value=''; return; }
  var r=new FileReader();
  r.onload=function(){
    qvCharImg=String(r.result||''); qvCharId='upload'; qvCharOn=true; qvCharImgEl=null;
    var pv=document.getElementById('qvCharPreview'); if(pv){ pv.src=qvCharImg; pv.style.display='block'; }
    var nm=document.getElementById('qvCharName'); if(nm) nm.textContent='Using your upload: '+f.name;
    renderQVPickers();
  };
  r.readAsDataURL(f);
}
function qvBibleText(){
  if(qvCharId==='upload') return {name:'the uploaded hero',kind:'the character in the uploaded picture',face:'the same face as in the uploaded picture',hair:'the same hair as in the uploaded picture',outfit:'the same outfit as in the uploaded picture',colors:'the same colours as in the uploaded picture',acc:'',expr:'happy and brave'};
  var c=QV_CHARS[qvCharId]||QV_CHARS.boy;
  return {name:c.name,kind:c.kind,face:c.face,hair:c.hair,outfit:c.outfit,colors:c.colors,acc:'',expr:'happy and brave'};
}
function drawQVPart(ctx,img,ox,oy,cw,ch,piv,ang){
  if(!img||!img.complete||!img.naturalWidth) return;
  var px=ox+piv[0]/200*cw, py=oy+piv[1]/300*ch;
  ctx.save(); ctx.translate(px,py); ctx.rotate(ang||0);
  ctx.drawImage(img,ox-px,oy-py,cw,ch); ctx.restore();
}
function drawQVCharacter(ctx,s,idx,t,per,W,H){
  if(!qvCharOn) return;
  /* The actor only plays on background scenes (Quick Video) or
     built-in pictures — a generated scene picture already has its
     own character in it, and two characters would overlap. */
  var bgOnly=(s&&s.qvBg===true)||isSVGImg(s&&s.img);
  if(!bgOnly) return;
  var lt=Math.max(0,t-idx*per), frac=per?Math.min(1,lt/per):0;
  var posX={left:0.24,centre:0.5,right:0.76};
  var x0=posX[s.start]||0.5, x1=posX[s.end]||0.5;
  var fx=x0+(x1-x0)*frac;
  var chH=H*0.52, chW=chH*200/300;
  var cx=fx*W, feetY=H*0.80;
  var w1=2*Math.PI, ph=t;
  var legA=0,armLA=0,armRA=0,headA=0,bob=0,lean=0,jumpY=0,tailA=0,sw=0;
  if(qvAnim==='walk'){ sw=Math.sin(ph*w1*1.4); legA=sw*0.45; armLA=-sw*0.4; armRA=sw*0.4; bob=Math.abs(sw)*6; }
  else if(qvAnim==='run'){ sw=Math.sin(ph*w1*2.6); legA=sw*0.7; armLA=-sw*0.6; armRA=sw*0.6; bob=Math.abs(sw)*8; lean=0.1; }
  else if(qvAnim==='wave'){ armRA=-2.1+Math.sin(ph*w1*2.2)*0.35; armLA=0.08; headA=0.06; }
  else if(qvAnim==='dance'){ sw=Math.sin(ph*w1*2); bob=Math.abs(sw)*10; armLA=-1.1+sw*0.35; armRA=-1.1-sw*0.35; lean=sw*0.07; }
  else if(qvAnim==='jump'){ jumpY=-Math.abs(Math.sin(frac*Math.PI*2))*H*0.07; armLA=-2.4; armRA=-2.4; }
  else { armLA=Math.sin(ph*w1*0.8)*0.08; armRA=-Math.sin(ph*w1*0.8)*0.08; bob=Math.sin(ph*w1*0.9)*3; headA=Math.sin(ph*w1*0.6)*0.05; }
  tailA=Math.sin(ph*w1*3)*0.3;
  if(qvCharImg){
    if(!qvCharImgEl){ qvCharImgEl=new Image(); qvCharImgEl.src=qvCharImg; }
    var im=qvCharImgEl;
    if(im.complete&&im.naturalWidth){
      var iw=im.naturalWidth, ih=im.naturalHeight, sc=Math.min(chW/iw,chH/ih), dw=iw*sc, dh=ih*sc;
      ctx.save(); ctx.translate(cx,feetY-dh/2-bob-jumpY); ctx.rotate(lean+Math.sin(ph*w1*0.8)*0.03);
      ctx.drawImage(im,-dw/2,-dh/2,dw,dh); ctx.restore();
    }
    return;
  }
  var c=QV_CHARS[qvCharId]||QV_CHARS.boy;
  var ox=cx-chW/2, oy=feetY-chH-bob-jumpY;
  ctx.save();
  ctx.translate(cx,feetY); ctx.rotate(lean); ctx.translate(-cx,-feetY);
  drawQVPart(ctx,qvPartImg(qvCharId,'tail'),ox,oy,chW,chH,c.pivots.tail||[142,190],tailA);
  drawQVPart(ctx,qvPartImg(qvCharId,'legL'),ox,oy,chW,chH,c.pivots.legL,legA);
  drawQVPart(ctx,qvPartImg(qvCharId,'legR'),ox,oy,chW,chH,c.pivots.legR,-legA);
  drawQVPart(ctx,qvPartImg(qvCharId,'body'),ox,oy,chW,chH,[100,165],0);
  drawQVPart(ctx,qvPartImg(qvCharId,'armL'),ox,oy,chW,chH,c.pivots.armL,armLA);
  drawQVPart(ctx,qvPartImg(qvCharId,'armR'),ox,oy,chW,chH,c.pivots.armR,armRA);
  drawQVPart(ctx,qvPartImg(qvCharId,'head'),ox,oy,chW,chH,c.pivots.head,headA);
  /* Mouth: opens and closes on the dialogue beats while the scene's
     line is being spoken (first 80% of the scene). */
  var speaking=!!(s&&s.dialogue)&&lt<per*0.8;
  var openAmt=speaking?(Math.sin(ph*w1*3.2)>0.1?0.75+0.25*Math.sin(ph*w1*3.2):0.15):0;
  var mouthImg=openAmt>0.3?qvPartImg(qvCharId,'mouthOpen'):qvPartImg(qvCharId,'mouthClosed');
  if(mouthImg&&mouthImg.complete&&mouthImg.naturalWidth){
    var mx=ox+100/200*chW, my=oy+107/300*chH;
    ctx.save(); ctx.translate(mx,my); ctx.scale(1,openAmt>0.3?0.6+0.4*openAmt:1);
    ctx.drawImage(mouthImg,ox-mx,oy-my,chW,chH); ctx.restore();
  }
  ctx.restore();
}
/* Scene pictures, FAST: all requests fire at once. The shared slot
   paces each start ~4s apart (the image endpoint needs a gap), so
   the generations overlap instead of queueing one by one — 4 scenes
   finish in roughly the time of one slow picture plus the pacing,
   not four in a row. A failed scene keeps its built-in picture. */
async function upgradeStoryboardImagesFast(onProg){
  var jobs=storyboard.map(function(s,i){
    if(s.img&&!isSVGImg(s.img)) return Promise.resolve('kept');
    var prompt;
    if(s.qvBg){
      /* Background only — the character is the actor on top, so the
         picture must not draw its own character. */
      prompt=(s.narration||'')+' — empty storybook background scene, no characters, no people, no animals — style: '+storyStyle+', children\'s picture book illustration, soft light, gentle colours';
    }else{
      prompt=s.prompt+' — style: '+storyStyle+', children\'s picture book illustration';
    }
    return fetchGeneratedImage(prompt,hash(s.prompt+i)%1000000).then(function(img){
      s.img=img;
      var th=document.querySelectorAll('#animOut .scene-thumb-img');
      if(th[i]) th[i].src=img;
      return 'done';
    }).catch(function(){ return 'kept'; });
  });
  var done=0;
  await Promise.all(jobs.map(function(p){ return p.then(function(){ done++; if(onProg) onProg(done,jobs.length); }); }));
  save();
}
function qvFinish(ok,msg){
  qvBusy=false;
  var btn=document.getElementById('qvBtn'); if(btn){btn.disabled=false;btn.textContent='▶ Make my video';}
  var cb=document.getElementById('qvCancel'); if(cb) cb.style.display='none';
  var st=document.getElementById('qvStatus');
  if(st) st.textContent=msg||(ok?'Done — watch the video below and tap Download. It is saved in My Projects and the Library.':'');
  var bar=document.getElementById('qvProgress'); if(bar) bar.style.width=ok?'100%':'0%';
}
function cancelQuickVideo(){
  qvCancel=true;
  var st=document.getElementById('qvStatus'); if(st) st.textContent='Cancelling…';
  cancelVideoRender();
  if(!rendering) qvFinish(false,'Cancelled — tap Make my video to try again.');
}
async function buildQuickVideo(){
  if(qvBusy) return;
  if(rendering){ alert('A video is already rendering — wait for it to finish, or tap Cancel on it first.'); return; }
  var title=(document.getElementById('qvTitle').value||'').trim();
  var topic=(document.getElementById('qvTopic').value||'').trim()||'A brave little hero finds a magical surprise';
  var wishes=(document.getElementById('qvWishes').value||'').trim();
  /* v28: 1-Minute Film — 6 scenes × 10s = exactly 60s. On by
     default: the scenes box and the duration are forced to match,
     so a film is always six 10-second clips, never six scenes
     squeezed into 15s. Uncheck it for a custom scene count. */
  var oneMin=!document.getElementById('qvOneMin')||document.getElementById('qvOneMin').checked;
  var n=oneMin?6:Math.max(3,Math.min(6,parseInt(document.getElementById('qvScenes').value)||4));
  if(oneMin){ var qs0=document.getElementById('qvScenes'); if(qs0) qs0.value='6'; var ad0=document.getElementById('anDur'); if(ad0) ad0.value='60'; }
  qvTitle=title||topic;
  qvAnim=(document.getElementById('qvAnimSel').value)||'talk';
  qvCharOn=true;
  if(qvCharId!=='upload'&&!QV_CHARS[qvCharId]) qvCharId='boy';
  qvBusy=true; qvCancel=false; ensureMusicCtx(); /* v28: audio context must start inside this tap — the render starts after async picture work, when the gesture is long gone */
  var btn=document.getElementById('qvBtn'), st=document.getElementById('qvStatus'),
      bar=document.getElementById('qvProgress'), cb=document.getElementById('qvCancel');
  if(btn){btn.disabled=true;btn.textContent='⏳ Making your video…';}
  if(cb) cb.style.display='inline-block';
  if(bar) bar.style.width='5%';
  try{
    var idea=topic+(wishes?' — '+wishes.split('\n').join('; '):'');
    document.getElementById('anIdea').value=idea;
    document.getElementById('anScenes').value=n;
    /* Build the storyboard in this page — no prompt to approve, the
       video goes direct. Pictures upgrade fast below, in parallel. */
    generateStoryboard(idea,qvBibleText(),qvStyle,true);
    var wishLines=wishes.split('\n').map(function(x){return x.trim();}).filter(Boolean);
    storyboard.forEach(function(s,i){
      s.qvBg=true;
      var line=wishLines[i]||'';
      if(!line){
        var first=(s.narration||'').split('.')[0].trim();
        line=first?first+'.':'Let\'s go!';
      }
      s.dialogue=line.slice(0,80);
    });
    if(st) st.textContent='Making the scene pictures… (fast — they generate together)';
    await upgradeStoryboardImagesFast(function(done,total){
      if(st) st.textContent='Scene picture '+done+' of '+total+' ready…';
      if(bar) bar.style.width=Math.round(5+done/total*45)+'%';
    });
    if(qvCancel) throw new Error('cancelled');
    saveQuickVideoProject(title,topic,wishes);
    if(st) st.textContent=oneMin?'Pictures ready — rendering your 1-minute film (6 scenes × 10s) below… (takes a full minute — keep this tab open)':'Pictures ready — rendering your video below… (1 minute takes a full minute — keep this tab open)';
    if(bar) bar.style.width='55%';
    /* Direct to video — no approval step. */
    qvRenderDone=function(ok){ qvFinish(ok); };
    renderVideo();
    if(previewFallback){
      qvRenderDone=null;
      qvFinish(true,'Moving preview playing below — this browser cannot record a video file, so there is no download here. The project is saved in My Projects and the Library.');
    }
  }catch(e){
    if(e&&e.message==='cancelled'){ qvFinish(false,'Cancelled — tap Make my video to try again.'); }
    else { qvFinish(false,'Something went wrong — the storyboard below is still there; tap Make my video again.'); }
  }
}
function saveQuickVideoProject(title,topic,wishes){
  if(!storyboard.length) return;
  var proj={id:uid(),kind:'video',title:qvTitle||title,topic:topic,wishes:wishes,desc:topic+' · Quick Video · '+qvStyle+' · '+qvAnim,created:new Date().toISOString(),type:'video',lang:'en',style:qvStyle,anim:qvAnim,charChoice:qvCharId,qvCharImg:qvCharImg||'',pages:storyboard.map(function(s){return {n:s.n,text:s.narration,dialogue:s.dialogue||'',img:s.img,qvBg:true};})};
  state.projects.unshift(proj);
  if(!state.library.find(function(b){return b.id===proj.id;})) state.library.unshift(proj);
  logHistory('video','Quick Video saved: '+proj.title+' ('+storyboard.length+' scenes)');
  save();
  renderProjects(); renderSimpleHome(); renderLibrary();
}
function openQuickVideoProject(b){
  storyboard=(b.pages||[]).map(function(p){
    return {n:p.n,narration:p.text||'',dialogue:p.dialogue||'',img:p.img||'',qvBg:!!p.qvBg,entry:'centre',start:'centre',end:'centre',exit:'centre',camera:CAMERA,negative:NEGATIVE,prompt:''};
  });
  qvTitle=b.title||''; qvStyle=b.style||'3D Cartoon'; qvAnim=b.anim||'talk';
  qvCharId=b.charChoice||'boy'; qvCharImg=b.qvCharImg||null; qvCharOn=true;
  var t=document.getElementById('qvTitle'); if(t) t.value=b.title||'';
  var tp=document.getElementById('qvTopic'); if(tp) tp.value=b.topic||'';
  var w=document.getElementById('qvWishes'); if(w) w.value=b.wishes||'';
  var as=document.getElementById('qvAnimSel'); if(as) as.value=qvAnim;
  var nm=document.getElementById('qvCharName');
  if(nm) nm.textContent=qvCharId==='upload'?'Using your uploaded character.':'No upload yet — a sample below is used.';
  var pv=document.getElementById('qvCharPreview');
  if(pv){ if(qvCharImg){pv.src=qvCharImg;pv.style.display='block';} else pv.style.display='none'; }
  renderQVPickers(); renderAnimOut(); go('animation');
}
renderQVPickers();

/* ---------- Music / Comic ---------- */
function generateSong(){
  const topic=document.getElementById('muTopic').value, lang=document.getElementById('muLang').value, genre=document.getElementById('muGenre').value;
  const verses=['Verse 1: '+topic+' — we sing, we smile, we learn each day.','Chorus: Sing along, clap along, happy hearts are here to stay!','Verse 2: Little hands, little feet, dancing to the happy beat.','Chorus: Sing along, clap along, happy hearts are here to stay!'];
  const song={id:uid(),kind:'song',title:topic,desc:genre+' · '+lang,created:new Date().toISOString()};
  state.projects.unshift(song);
  document.getElementById('songOut').innerHTML='<div class="book-page"><h3>'+esc(topic)+'</h3><p class="muted small">'+esc(genre)+' · '+esc(lang)+' · original lyrics</p>'+verses.map(v=>'<p>'+esc(v)+'</p>').join('')+'</div>';
  document.getElementById('musicScenes').innerHTML='<h3>Scene briefs</h3>'+verses.map((v,i)=>'<p class="small">Scene '+(i+1)+': '+esc(v.slice(0,80))+' — bright colours, friendly characters, same Character Bible.</p>').join('');
  logHistory('music','Generated song lyrics: '+topic);save();
}
function generateComic(){
  const idea=document.getElementById('coIdea').value;const n=Math.max(4,Math.min(8,parseInt(document.getElementById('coPanels').value)||6));
  const layout=document.getElementById('coLayout').value;
  const panels=[];for(let i=0;i<n;i++)panels.push({n:i+1,dialogue:i===0?'"Let\'s build it!" said Bolt.':i===n-1?'"We did it!" cheered Pip.':'"Look! Up there!" laughed Pip.',text:'Panel '+(i+1)+': '+idea+' — moment '+(i+1)+' of '+n+'.',img:makeSVG({scene:'Panel '+(i+1)+': '+idea+' — moment '+(i+1)+' of '+n+'.',text:'"Let\'s build it!"'},'Comic')});
  const comic={id:uid(),kind:'comic',title:idea,desc:layout+' · '+n+' panels',created:new Date().toISOString(),panels};
  lastComicPanels=panels;
  state.projects.unshift(comic);
  document.getElementById('comicOut').innerHTML='<div class="page-grid">'+panels.map((p,i)=>'<div class="page-card"><img id="comic-panel-img-'+i+'" src="'+p.img+'" alt="Comic panel"><div class="pad"><strong>Panel '+p.n+'</strong><p>'+esc(p.text)+'</p><p><strong>'+esc(p.dialogue)+'</strong></p><div id="comic-panel-video-'+i+'"></div></div></div>').join('')+'</div>';
  logHistory('comic','Generated comic: '+idea+' ('+n+' panels)');save();
  /* v13: upgrade the panels to the picked image model in the
     background (built-in pictures stay until each realistic one
     arrives). */
  upgradeComicImages(panels);
}

/* ---------- Providers / Settings ---------- */
/* v30: external video/LLM providers are GONE — video is made in-site by
   the built-in renderer (v24/v28) and pictures come from the site's own
   image service, so there is nothing to connect and no key to paste.
   The old provider list (Runway / Pika / Luma / Kling / Veo / OpenAI)
   and its Save-key / Test-Connection code are removed; any key a user
   saved earlier stays untouched in their own browser storage but is
   never read or sent anywhere now. */
function renderProviders(){const el=document.getElementById('providerList');if(!el)return;el.innerHTML='<div class="card"><h3>✅ Built-in engine only — nothing to connect</h3><p>Stories, pictures, music and video are all made by the built-in engine, right here in your browser. There are no external providers to connect, no API keys to paste, and no extra billing — everything is free and unlimited.</p><p class="muted small">Pictures are generated through the site\'s own image service (its key lives server-side); the video renderer runs entirely in this browser.</p></div>';}
function setTheme(t){state.theme=t;document.body.className=t==='dark'?'dark':'';save();}
function exportAllData(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.download='vitalize-storynest-data.json';a.click();}
function clearAllData(){if(!confirm('Delete ALL local ekiddy.com data in this browser?'))return;localStorage.removeItem(LS);location.reload();}

/* ---------- Init ---------- */
renderCounts();renderChars();renderHome();renderSimpleHome();renderLibrary();renderProjects();renderDashboard();renderAdmin();renderProviders();hydrateAll();
/* v29: keep the Scenes box in sync with the 1-Minute Film checkbox
   from the moment the page loads — it used to show 4 until generation
   started, even though the film is always 6 scenes while checked. */
function syncQvScenes(){var c=document.getElementById('qvOneMin'),s=document.getElementById('qvScenes');if(c&&s&&c.checked)s.value='6';}
(function(){var c=document.getElementById('qvOneMin');if(c)c.addEventListener('change',syncQvScenes);syncQvScenes();})();
if(state.theme==='dark')document.body.className='dark';
