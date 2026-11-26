/* ekiddy.com — standalone, built-in engine. No API keys, no limits, localStorage only. */
const LS='vsn_state_v1';
let state=load();
let current=null; // current book being edited
let reader={book:null,idx:0};
let storyboard=[];
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
  if(Object.keys(imgs).length) _imgQueue[b.id]=Object.assign({},_imgQueue[b.id]||{},imgs);
  return c;
}
function stripBookImgs(b){
  if(!b) return;
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
  document.body.classList.toggle('on-home',p==='home');var mm=document.getElementById('moreMenu');if(mm)mm.classList.remove('open');document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));document.querySelectorAll('#bottomnav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));document.querySelectorAll('.page').forEach(s=>s.classList.remove('active'));const el=document.getElementById('page-'+p);if(el)el.classList.add('active');const nav=document.getElementById('nav');if(nav)nav.classList.remove('open');if(p==='library')renderLibrary();if(p==='projects')renderProjects();if(p==='dashboard')renderDashboard();if(p==='admin')renderAdmin();if(p==='settings')renderProviders();if(p==='home'){renderHome();renderSimpleHome();}window.scrollTo({top:0,behavior:(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)?'auto':'smooth'});if(push!==false){try{history.pushState({page:p},'');}catch(e){}}}
/* v13: the browser Back button works too — every go() pushes a history
   entry, and Back pops to the previous section. The on-screen ← Back
   button is go('home'). Going back never loses work: go() only switches
   which section is visible; the generated storyboard / book / story
   stays in memory and is still there on re-entry. */
window.addEventListener('popstate',function(e){const p=(e.state&&e.state.page)||'home';go(p,false);});
try{history.replaceState({page:'home'},'');}catch(e){}
function toggleMenu(){const nav=document.getElementById('nav');if(nav)nav.classList.toggle('open');}
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
function bibleText(){const c=state.characters[0]||{name:document.getElementById('chName').value,kind:document.getElementById('chKind').value,face:document.getElementById('chFace').value,hair:document.getElementById('chHair').value,outfit:document.getElementById('chOutfit').value,colors:document.getElementById('chColors').value,acc:document.getElementById('chAcc').value,expr:document.getElementById('chExpr').value};return c.name+' — '+c.kind+'; face: '+c.face+'; hair/fur: '+c.hair+'; outfit: '+c.outfit+'; colours: '+c.colors+'; accessories: '+c.acc+'; expression: '+c.expr+'. SAME character in every scene — do not change face, hair, outfit or colours.';}
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
  save(); renderBookOut(); renderEditor(); applyBible();
  illustrateAll();
  document.querySelectorAll('.step').forEach(s=>s.classList.toggle('on',+s.dataset.s<=3));
}
function renderBookOut(){
  const out=document.getElementById('bookOut'); if(!current){out.innerHTML='<p class="muted">No book generated yet.</p>';return;}
  const font=document.getElementById('edFont')?document.getElementById('edFont').value:'Georgia, serif';
  out.innerHTML='<h3>'+esc(current.title)+'</h3><p>'+esc(current.desc)+'</p><p><strong>Moral:</strong> '+esc(current.moral)+'</p><p><strong>Characters:</strong> '+esc(current.characters.join(' | '))+'</p>'+
  current.pages.map((p,i)=>'<div class="book-page" style="font-family:'+esc(font)+';background:'+esc(document.getElementById('edBg')?document.getElementById('edBg').value:'#fff8ec')+'"><strong>Page '+p.n+'</strong>'+(p.img?'<img src="'+p.img+'" alt="Page illustration">':'')+'<p>'+esc(p.text)+'</p><p class="muted small">Scene: '+esc(p.scene)+'</p><div class="row"><button class="btn" onclick="regenPage('+i+')">↻ Regenerate this page</button><button class="btn" onclick="editPageText('+i+')">✏ Edit text</button></div></div>').join('');
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
  const h=hash(page.scene+page.text+style);
  const palettes={'Watercolor':['#fde68a','#fbcfe8','#bae6fd','#d1fae5'],'3D Cartoon':['#f59e0b','#fb7185','#60a5fa','#a78bfa'],'Pixar-inspired 3D':['#fbbf24','#f472b6','#38bdf8','#c084fc'],'Storybook Illustration':['#fde68a','#fca5a5','#93c5fd','#86efac'],'Disney-inspired Fairy Tale':['#f9a8d4','#fde68a','#a5b4fc','#fda4af'],'Anime':['#fda4af','#93c5fd','#fde68a','#c4b5fd'],'Clay Animation':['#fdba74','#fca5a5','#93c5fd','#fde68a'],'Paper Cut':['#f87171','#60a5fa','#fbbf24','#34d399'],'Hand Drawn':['#fef3c7','#fecdd3','#dbeafe','#e9d5ff'],'Digital Painting':['#c7d2fe','#fbcfe8','#fde68a','#bae6fd']};
  const pal=palettes[style]||palettes['Storybook Illustration'];
  const c1=pal[h%4],c2=pal[(h+1)%4],c3=pal[(h+2)%4];
  const sunX=80+(h%200), moon=h%2===0;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="'+c2+'" opacity="0.35"/><circle cx="'+sunX+'" cy="90" r="55" fill="'+c1+'"/>'+(moon?'<circle cx="650" cy="80" r="38" fill="#fef9c3"/>':'')+'<ellipse cx="400" cy="520" rx="420" ry="90" fill="#86efac"/><ellipse cx="180" cy="480" rx="180" ry="60" fill="#4ade80"/><ellipse cx="620" cy="490" rx="200" ry="60" fill="#22c55e"/><circle cx="400" cy="360" r="90" fill="#fff" stroke="'+c3+'" stroke-width="6"/><circle cx="370" cy="350" r="12" fill="#1e1b2e"/><circle cx="430" cy="350" r="12" fill="#1e1b2e"/><path d="M370 390 Q400 415 430 390" stroke="#1e1b2e" stroke-width="5" fill="none"/><path d="M330 290 Q400 230 470 290" fill="'+c1+'"/><rect x="360" y="450" width="80" height="70" rx="14" fill="'+c3+'"/><text x="400" y="580" text-anchor="middle" font-family="Georgia,serif" font-size="22" fill="#334155">'+esc(page.scene.slice(0,60))+'</text></svg>';
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
  const r=await fetchWithTimeout(IMAGE_PROXY_URL,90000,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:prompt,seed:seed,width:768,height:768})});
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
        s.img=await fetchGeneratedImage(s.prompt+' — style: Storybook Illustration, children\'s picture book illustration',hash(s.prompt+i)%1000000);
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
function exportPDF(kind){if(kind==='comic'){window.print();return;}if(!current){const b=reader.book;if(b){current=b;}else return alert('Open or generate a book first.');}renderBookOut();setTimeout(()=>window.print(),100);}
function downloadPageImages(){if(!current)return alert('Generate a book first.');current.pages.forEach((p,i)=>{if(!p.img)return;const a=document.createElement('a');a.href=p.img;a.download=(current.title.replace(/\W+/g,'-')+'-page-'+p.n+'.svg');a.click();});}
function downloadStoryText(){if(!current)return alert('Generate a book first.');const txt=current.title+'\n'+current.desc+'\nMoral: '+current.moral+'\n\n'+current.pages.map(p=>'Page '+p.n+': '+p.text).join('\n\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));a.download=current.title.replace(/\W+/g,'-')+'.txt';a.click();}
function shareToLibrary(){if(!current)return;current.shared=true;if(!state.library.find(b=>b.id===current.id))state.library.unshift(current);saveCurrentBook();save();renderLibrary();alert('Shared to Library.');}
function renderLibrary(){const el=document.getElementById('libraryOut');if(!el)return;const books=state.library.length?state.library:state.projects.filter(p=>p.kind==='book');el.innerHTML=books.length?books.map(b=>'<div class="card"><h3>'+esc(b.title)+'</h3><p>'+esc(b.desc||'')+'</p><p class="muted small">'+(b.pages?b.pages.length:0)+' pages · '+esc(b.type||'')+' · '+esc(b.lang||'en')+'</p><button class="btn primary" onclick="openReader(\''+b.id+'\')">📖 Read</button></div>').join(''):'<p class="muted">Library is empty — share a book from the Picture Book Generator.</p>';}
async function openReader(id){const b=state.projects.find(p=>p.id===id)||state.library.find(p=>p.id===id);if(!b)return;await hydrateBook(b);reader={book:b,idx:0};current=b;document.getElementById('readerCard').style.display='block';document.getElementById('readerTitle').textContent=b.title;renderReader();go('library');}
function renderReader(){const el=document.getElementById('readerOut');if(!reader.book)return;const p=reader.book.pages[reader.idx];el.innerHTML='<div class="book-page">'+(p.img?'<img src="'+p.img+'" alt="Page illustration">':'')+'<h3>Page '+p.n+' of '+reader.book.pages.length+'</h3><p style="font-size:19px">'+esc(p.text)+'</p></div>';}
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
async function openProject(id){const b=state.projects.find(p=>p.id===id);if(!b)return;if(b.kind==='story'){openStory(id);}else if(b.kind==='book'||b.pages){await hydrateBook(b);current=b;renderBookOut();renderEditor();go('book');}else if(b.kind==='comic'){hydrateBook(b);go('comic');}else{go('projects');}}
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
function generateStoryboard(){
  const idea=document.getElementById('anIdea').value.trim()||'Milo the fox follows a glowing lantern';
  const n=Math.max(3,Math.min(8,parseInt(document.getElementById('anScenes').value)||4));
  const sides=['left','right','centre'];
  storyboard=[];let pos='centre';
  for(let i=0;i<n;i++){
    const entry=sides[i%3], exit=sides[(i+1)%3];
    const scene={n:i+1,narration:(i===0?idea+' begins. ':i===n-1?'At last, the journey ends happily. ':'The journey continues, step by step. ')+'Scene '+(i+1)+' of '+n+'.',
      entry, start:pos, end:exit, exit,
      camera:CAMERA, negative:NEGATIVE,
      prompt:''};
    scene.prompt='SCENE '+(i+1)+'/'+n+': '+idea+'. '+bibleText()+' Entry: from the '+entry+', start position '+pos+'. End position: '+exit+', exit to the '+exit+'. Next scene starts at '+exit+'. '+CAMERA+' '+NEGATIVE;
    /* v12: every scene gets its REAL illustration — the same makeSVG()
       picture-book illustration, built from this scene's narration +
       the Character Bible + Storybook style — so the storyboard preview
       and the rendered video show the user's character and setting,
       not a flat colour. */
    scene.img=makeSVG({scene:idea+' — scene '+(i+1)+': '+scene.narration,text:scene.narration},'Storybook Illustration');
    storyboard.push(scene); pos=exit;
  }
  /* v13: four SMALL blocks, not big stacked cards — a thumbnail with
     the scene number + short caption. Tap a block to expand its entry,
     positions, continuity and copy-ready prompt. */
  const out=document.getElementById('animOut');
  out.innerHTML=storyboard.map((s,i)=>'<div class="scene-thumb" onclick="toggleSceneDetail('+i+')">'+(s.img?'<img class="scene-thumb-img" src="'+s.img+'" alt="Scene '+s.n+' illustration">':'')+'<div class="scene-thumb-body"><strong>Scene '+s.n+'</strong><p>'+esc(s.narration.slice(0,90))+(s.narration.length>90?'…':'')+'</p></div><div class="scene-detail" id="scene-detail-'+i+'" style="display:none"><p class="small">Entry: <strong>'+esc(s.entry)+'</strong> · Start: '+esc(s.start)+' → End: '+esc(s.end)+' · Exit: '+esc(s.exit)+'</p><p class="small muted">Continuity: '+(i===0?'starts centre':('starts at '+storyboard[i-1].end+' (previous scene end)'))+'</p><p class="mono small">'+esc(s.prompt)+'</p><div class="row"><button class="btn" onclick="event.stopPropagation();copyPrompt('+i+')">📋 Copy prompt</button></div></div></div>').join('');
  logHistory('animation','Storyboard: '+n+' scenes — '+idea);save();
  /* v13: upgrade the scene pictures to the picked image model in the
     background (built-in pictures stay until each realistic one
     arrives). */
  upgradeStoryboardImages();
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
function drawSceneFrame(ctx,img,s,idx,t,per,W,H){
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
  /* Scene badge, top-left */
  const badge='SCENE '+(idx+1)+' / '+storyboard.length;
  ctx.font='bold '+Math.max(20,Math.round(W*0.022))+'px sans-serif';
  const bw=ctx.measureText(badge).width+28;
  const bh=Math.max(34,Math.round(W*0.032));
  ctx.fillStyle='rgba(8,26,67,0.72)';
  if(ctx.roundRect){ctx.beginPath(); ctx.roundRect(18,18,bw,bh,16); ctx.fill();}else{ctx.fillRect(18,18,bw,bh);}
  ctx.fillStyle='#ffd52e'; ctx.fillText(badge,32,18+bh-Math.max(10,Math.round(W*0.009)));
  /* Full narration as caption, wrapped — never truncated */
  const fs=Math.max(20,Math.round(W*0.026));
  ctx.font=fs+'px sans-serif';
  const lines=wrapCaptionText(ctx,s.narration,W-56);
  const lh=Math.round(fs*1.45); const bandH=lines.length*lh+28;
  ctx.fillStyle='rgba(0,0,0,0.68)'; ctx.fillRect(0,H-bandH,W,bandH);
  ctx.fillStyle='#fff';
  lines.forEach(function(ln,i){ctx.fillText(ln,28,H-bandH+18+(i+1)*lh-Math.round(fs*0.35));});
  return idx;
}
/* Reset the renderer to idle: button back, cancel hidden, bar at 0. */
function resetRenderUI(msg){
  rendering=false; cancelRender=false; activeRec=null;
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
  drawSceneFrame(previewCtx,previewImgs[idx],storyboard[idx],idx,loopT,previewPer,previewW,previewH);
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
  if(err) err.textContent=reason+' This browser cannot record a video file in the page, so there is no .webm download here. What still works: the moving preview below, Download scene pictures, and the copy-ready prompts for Runway / Pika / Luma in Settings → Providers.';
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
function renderVideo(){
  stopPreview();
  previewFallback=false;
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
    rec=new MediaRecorder(stream, {mimeType:mime,videoBitsPerSecond:5000000});
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
    rendering=false; activeRec=null;
    if(btn){btn.disabled=false;btn.textContent='▶ Render video in browser';}
    if(cancelBtn) cancelBtn.style.display='none';
    if(wasPreview) return; /* a preview fallback already took over the status text */
    if(!chunks.length||cancelRender){ if(status)status.textContent=cancelRender?'Render cancelled — tap Render again to try again.':'No video data was recorded — tap Render again, or try Chrome on a desktop.'; if(bar)bar.style.width='0%'; return; }
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
  };
  const per=dur/storyboard.length; let start=performance.now();
  const sceneImgs=loadSceneImages();
  function startRecording(){
    /* v13: Cancel pressed while pictures were still loading used to be
       ignored — the render started anyway. Abort instead. */
    if(cancelRender){ resetRenderUI('Render cancelled — tap Render again to try again.'); return; }
    start=performance.now(); /* clock starts when recording starts, not while pictures were loading */
    drawSceneFrame(ctx,sceneImgs[0],storyboard[0],0,0,per,W,H);
    try{ rec.start(250); }catch(e){ rendering=false; activeRec=null; if(btn){btn.disabled=false;btn.textContent='▶ Render video in browser';} if(err)err.textContent='Recorder could not start: '+(e&&e.message?e.message:e); return; }
    renderTimer=setInterval(()=>{
      const t=(performance.now()-start)/1000;
      if(cancelRender||t>=dur){ clearInterval(renderTimer); renderTimer=null; try{ if(rec.state!=='inactive') rec.stop(); }catch(e){} return; }
      const idx=Math.min(storyboard.length-1,Math.floor(t/per));
      drawSceneFrame(ctx,sceneImgs[idx],storyboard[idx],idx,t,per,W,H);
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
  state.projects.unshift(comic);
  document.getElementById('comicOut').innerHTML='<div class="page-grid">'+panels.map((p,i)=>'<div class="page-card"><img id="comic-panel-img-'+i+'" src="'+p.img+'" alt="Comic panel"><div class="pad"><strong>Panel '+p.n+'</strong><p>'+esc(p.text)+'</p><p><strong>'+esc(p.dialogue)+'</strong></p></div></div>').join('')+'</div>';
  logHistory('comic','Generated comic: '+idea+' ('+n+' panels)');save();
  /* v13: upgrade the panels to the picked image model in the
     background (built-in pictures stay until each realistic one
     arrives). */
  upgradeComicImages(panels);
}

/* ---------- Providers / Settings ---------- */
const PROVIDERS=[{id:'runway',name:'Runway (video)',endpoint:'https://api.runwayml.com/v1'},{id:'pika',name:'Pika (video)',endpoint:'https://api.pika.art/v1'},{id:'luma',name:'Luma Dream Machine (video)',endpoint:'https://api.lumalabs.ai/dream-machine/v1'},{id:'kling',name:'Kling (video)',endpoint:'https://api.klingai.com/v1'},{id:'veo',name:'Veo / Google (video)',endpoint:'https://generativelanguage.googleapis.com/v1beta'},{id:'openai',name:'OpenAI (LLM / image)',endpoint:'https://api.openai.com/v1'}];
function renderProviders(){const el=document.getElementById('providerList');if(!el)return;el.innerHTML=PROVIDERS.map(p=>{const s=state.providers[p.id]||{};const st=s.verified?'✅ Verified':(s.key?'Key saved — not verified':'Not connected');return '<div class="card"><h3>'+esc(p.name)+'</h3><p class="muted small">'+esc(p.endpoint)+'</p>'+'<p><strong>'+st+'</strong></p><input type="password" id="key-'+p.id+'" placeholder="API key (stored only in this browser)" value="'+esc(s.key||'')+'"><div class="row"><button class="btn" onclick="saveKey(\''+p.id+'\')">Save key</button><button class="btn" onclick="testProvider(\''+p.id+'\')">Test Connection</button></div><p class="small" id="test-'+p.id+'"></p></div>';}).join('');}
function saveKey(id){const v=document.getElementById('key-'+id).value.trim();state.providers[id]={key:v,verified:false};save();renderProviders();document.getElementById('test-'+id).textContent='Key saved — not verified. Press Test Connection.';}
async function testProvider(id){const p=PROVIDERS.find(x=>x.id===id);const s=state.providers[id]||{};const el=document.getElementById('test-'+id);if(!s.key){el.textContent='No key saved — cannot test.';return;}el.textContent='Testing…';try{const r=await fetch(p.endpoint,{method:'GET',headers:s.key?{Authorization:'Bearer '+s.key}:{},mode:'cors'});if(r.ok||r.status===401||r.status===403){s.verified=r.ok;save();renderProviders();document.getElementById('test-'+id).textContent=r.ok?'✅ Verified — provider responded.':'Provider responded '+r.status+' — key not accepted. Key saved — not verified.';}else{s.verified=false;save();renderProviders();document.getElementById('test-'+id).textContent='Provider responded '+r.status+'. Key saved — not verified.';}}catch(e){s.verified=false;save();renderProviders();const t=document.getElementById('test-'+id);if(t)t.textContent='Could not reach provider from this browser (network/CORS). Key saved — not verified. This does not claim a fake connection.';}}
function setTheme(t){state.theme=t;document.body.className=t==='dark'?'dark':'';save();}
function exportAllData(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.download='vitalize-storynest-data.json';a.click();}
function clearAllData(){if(!confirm('Delete ALL local ekiddy.com data in this browser?'))return;localStorage.removeItem(LS);location.reload();}

/* ---------- Init ---------- */
renderCounts();renderChars();renderHome();renderSimpleHome();renderLibrary();renderProjects();renderDashboard();renderAdmin();renderProviders();hydrateAll();
if(state.theme==='dark')document.body.className='dark';
