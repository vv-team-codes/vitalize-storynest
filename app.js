/* Vitalize StoryNest — standalone, built-in engine. No API keys, no limits, localStorage only. */
const LS='vsn_state_v1';
let state=load();
let current=null; // current book being edited
let reader={book:null,idx:0};
let storyboard=[];
function load(){try{const s=JSON.parse(localStorage.getItem(LS));if(s&&s.projects)return s}catch(e){}return{projects:[],characters:[],history:[],providers:{},theme:'indigo',library:[]};}
function save(){localStorage.setItem(LS,JSON.stringify(state));renderCounts();}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function uid(){return 'id'+Date.now().toString(36)+Math.floor(Math.random()*999);}
function go(p){document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));document.querySelectorAll('.page').forEach(s=>s.classList.remove('active'));const el=document.getElementById('page-'+p);if(el)el.classList.add('active');if(p==='library')renderLibrary();if(p==='projects')renderProjects();if(p==='dashboard')renderDashboard();if(p==='admin')renderAdmin();if(p==='settings')renderProviders();if(p==='home')renderHome();window.scrollTo(0,0);}
document.querySelectorAll('#nav button').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
function renderCounts(){const p=document.getElementById('countPill');if(p)p.textContent=state.projects.length+' projects · '+state.characters.length+' characters';}
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
  save(); renderBookOut(); renderEditor(); applyBible(); document.querySelectorAll('.step').forEach(s=>s.classList.toggle('on',+s.dataset.s<=3));
}
function renderBookOut(){
  const out=document.getElementById('bookOut'); if(!current){out.innerHTML='<p class="muted">No book generated yet.</p>';return;}
  const font=document.getElementById('edFont')?document.getElementById('edFont').value:'Georgia, serif';
  out.innerHTML='<h3>'+esc(current.title)+'</h3><p>'+esc(current.desc)+'</p><p><strong>Moral:</strong> '+esc(current.moral)+'</p><p><strong>Characters:</strong> '+esc(current.characters.join(' | '))+'</p>'+
  current.pages.map((p,i)=>'<div class="book-page" style="font-family:'+esc(font)+';background:'+esc(document.getElementById('edBg')?document.getElementById('edBg').value:'#fff8ec')+'"><strong>Page '+p.n+'</strong><p>'+esc(p.text)+'</p><p class="muted small">Scene: '+esc(p.scene)+'</p><div class="row"><button class="btn" onclick="regenPage('+i+')">↻ Regenerate this page</button><button class="btn" onclick="editPageText('+i+')">✏ Edit text</button></div></div>').join('');
}
function regenPage(i){if(!current)return;const beats=TYPES[current.type]||TYPES.Adventure;const b=beats[(i+2)%beats.length];current.pages[i].text=current.pages[i].n===current.pages.length?current.pages[i].text:current.hero+' discovered '+b+' and smiled — a small brave step, and then another.';current.pages[i].scene=current.hero+', '+b+', soft light';current.pages[i].img='';save();renderBookOut();renderEditor();}
function editPageText(i){const t=prompt('Edit page text:',current.pages[i].text);if(t!=null){current.pages[i].text=t;save();renderBookOut();renderEditor();}}
function renderEditor(){const out=document.getElementById('editorOut');if(!current){out.innerHTML='';return;}out.innerHTML=current.pages.map((p,i)=>'<div class="book-page"><strong>Page '+p.n+'</strong>'+(p.img?'<img src="'+p.img+'" alt="Page illustration">':'<p class="muted small">No illustration yet — use Step 5.</p>')+'<textarea rows="2" onchange="current.pages['+i+'].text=this.value;save()">'+esc(p.text)+'</textarea><div class="row"><button class="btn" onclick="illustratePage('+i+')">🎨 Illustrate</button><button class="btn" onclick="deletePage('+i+')">Delete page</button></div></div>').join('');}
function addPage(){if(!current)return alert('Generate a book first.');current.pages.push({n:current.pages.length+1,text:current.hero+' continued the journey, and something wonderful happened.',scene:current.hero+' on a sunny path',prompt:'',img:''});save();renderBookOut();renderEditor();}
function deletePage(i){if(!current||current.pages.length<=1)return;current.pages.splice(i,1);current.pages.forEach((p,j)=>p.n=j+1);save();renderBookOut();renderEditor();}
function saveCurrentBook(){if(!current)return alert('Generate a book first.');const ex=state.projects.findIndex(p=>p.id===current.id);if(ex>=0)state.projects[ex]=current;else state.projects.unshift(current);logHistory('save','Saved "'+current.title+'"');save();renderProjects();alert('Saved to My Projects.');}

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
function illustratePage(i){if(!current)return;current.pages[i].img=makeSVG(current.pages[i],current.style);current.pages[i].prompt=current.pages[i].scene+' — '+bibleText()+' — style: '+current.style;save();renderEditor();renderIllus();}
function illustrateAll(force){if(!current)return alert('Generate a book first.');current.pages.forEach((p,i)=>{if(force||!p.img){p.img=makeSVG(p,current.style);p.prompt=p.scene+' — '+bibleText()+' — style: '+current.style;}});logHistory('image','Illustrated '+current.pages.length+' pages ('+current.style+')');save();renderIllus();renderEditor();}
function renderIllus(){const el=document.getElementById('illusOut');if(!el||!current)return;el.innerHTML=current.pages.map((p,i)=>'<div class="page-card">'+(p.img?'<img src="'+p.img+'" alt="Illustration page '+p.n+'">':'<div class="pad muted">No image yet</div>')+'<div class="pad"><strong>Page '+p.n+'</strong><p class="small">'+esc(p.text.slice(0,120))+'</p><div class="row"><button class="btn" onclick="illustratePage('+i+')">↻ Regenerate</button><button class="btn" onclick="editPrompt('+i+')">✏ Edit prompt</button></div>'+(p.prompt?'<p class="small muted">'+esc(p.prompt.slice(0,160))+'</p>':'')+'</div></div>').join('');}
function editPrompt(i){const t=prompt('Edit image prompt:',current.pages[i].prompt||current.pages[i].scene);if(t!=null){current.pages[i].prompt=t;current.pages[i].img=makeSVG({scene:t,text:current.pages[i].text},current.style);save();renderIllus();renderEditor();}}

/* ---------- Export / Reader ---------- */
function exportPDF(kind){if(kind==='comic'){window.print();return;}if(!current){const b=reader.book;if(b){current=b;}else return alert('Open or generate a book first.');}renderBookOut();setTimeout(()=>window.print(),100);}
function downloadPageImages(){if(!current)return alert('Generate a book first.');current.pages.forEach((p,i)=>{if(!p.img)return;const a=document.createElement('a');a.href=p.img;a.download=(current.title.replace(/\W+/g,'-')+'-page-'+p.n+'.svg');a.click();});}
function downloadStoryText(){if(!current)return alert('Generate a book first.');const txt=current.title+'\n'+current.desc+'\nMoral: '+current.moral+'\n\n'+current.pages.map(p=>'Page '+p.n+': '+p.text).join('\n\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));a.download=current.title.replace(/\W+/g,'-')+'.txt';a.click();}
function shareToLibrary(){if(!current)return;current.shared=true;if(!state.library.find(b=>b.id===current.id))state.library.unshift(current);saveCurrentBook();save();renderLibrary();alert('Shared to Library.');}
function renderLibrary(){const el=document.getElementById('libraryOut');if(!el)return;const books=state.library.length?state.library:state.projects.filter(p=>p.kind==='book');el.innerHTML=books.length?books.map(b=>'<div class="card"><h3>'+esc(b.title)+'</h3><p>'+esc(b.desc||'')+'</p><p class="muted small">'+(b.pages?b.pages.length:0)+' pages · '+esc(b.type||'')+' · '+esc(b.lang||'en')+'</p><button class="btn primary" onclick="openReader(\''+b.id+'\')">📖 Read</button></div>').join(''):'<p class="muted">Library is empty — share a book from the Picture Book Generator.</p>';}
function openReader(id){const b=state.projects.find(p=>p.id===id)||state.library.find(p=>p.id===id);if(!b)return;reader={book:b,idx:0};current=b;document.getElementById('readerCard').style.display='block';document.getElementById('readerTitle').textContent=b.title;renderReader();go('library');}
function renderReader(){const el=document.getElementById('readerOut');if(!reader.book)return;const p=reader.book.pages[reader.idx];el.innerHTML='<div class="book-page">'+(p.img?'<img src="'+p.img+'" alt="Page illustration">':'')+'<h3>Page '+p.n+' of '+reader.book.pages.length+'</h3><p style="font-size:19px">'+esc(p.text)+'</p></div>';}
function readerPrev(){if(reader.idx>0){reader.idx--;renderReader();}}
function readerNext(){if(reader.book&&reader.idx<reader.book.pages.length-1){reader.idx++;renderReader();}}
function readAloud(){if(!reader.book)return;const p=reader.book.pages[reader.idx];const u=new SpeechSynthesisUtterance(p.text);u.rate=1;speechSynthesis.cancel();speechSynthesis.speak(u);}

/* ---------- Home / Projects / Dashboard / Admin ---------- */
function seed(){if(state.projects.length)return;
  const mk=(title,desc,type,hero,pages)=>({id:uid(),kind:'book',title,desc,moral:MORALS[type]||MORALS.Adventure,age:'5–7',type,lang:'en',pages:pages.map((t,i)=>({n:i+1,text:t,scene:hero+' in a sunny meadow',prompt:'',img:''})),style:'Storybook Illustration',hero,characters:[],created:new Date().toISOString(),shared:true});
  const ellie=mk('Ellie and the Twinkling Star Path','A baby elephant follows fireflies and learns to share light.','Adventure','Ellie',['Ellie woke up and saw twinkling lights in the garden.','She followed Pip the firefly across the meadow.','Together they found a lantern that glowed for everyone.','Ellie shared the light, and the whole garden smiled.','The stars twinkled a little brighter that night.','Ellie went home happy, knowing sharing makes light grow.']);
  const luna=mk('Luna the Moon Rabbit','Luna finds a glowing lantern and learns to share.','Bedtime','Luna',['Luna hopped under the moon and found a lantern.','The lantern glowed softly, just for her.','She met a sleepy owl who had lost his way.','Luna shared her light so the owl could find home.','The moon smiled down at them both.']);
  ellie.pages.forEach(p=>p.img=makeSVG(p,'Storybook Illustration'));luna.pages.forEach(p=>p.img=makeSVG(p,'Watercolor'));
  state.projects=[ellie,luna];state.library=[ellie,luna];
  state.characters=[{id:uid(),name:'Luna',kind:'Moon Rabbit',face:'big brown eyes, round cheeks',hair:'soft white fur, long ears with pink insides',outfit:'sky-blue hooded cloak with a yellow star',colors:'white, sky blue, soft yellow',acc:'tiny glowing lantern, yellow flower',expr:'kind, curious'},{id:uid(),name:'Ellie',kind:'Baby Elephant',face:'big brown eyes, rosy cheeks',hair:'soft grey skin, tiny tuft',outfit:'yellow flower behind one ear',colors:'grey, soft yellow, pink',acc:'yellow flower',expr:'gentle, brave'}];
  save();
}
function renderHome(){const el=document.getElementById('homeStats');if(el)el.innerHTML='<div class="card"><h3>'+state.projects.length+'</h3><p>Projects in this browser</p></div><div class="card"><h3>'+state.characters.length+'</h3><p>Saved characters</p></div><div class="card"><h3>Unlimited</h3><p>Generation — no daily limits</p></div>';
  const h=document.getElementById('heroArt');if(h&&current)h.innerHTML='';if(h)h.innerHTML='<img src="'+makeSVG({scene:'Luna the Moon Rabbit with a glowing lantern',text:'StoryNest'},'Storybook Illustration')+'" alt="StoryNest illustration">';
  const s=document.getElementById('homeSamples');if(s)s.innerHTML=state.projects.slice(0,3).map(b=>'<div class="card"><h3>'+esc(b.title)+'</h3><p>'+esc(b.desc||'')+'</p><button class="btn" onclick="openReader(\''+b.id+'\')">📖 Read</button></div>').join('')||'<p class="muted">No samples yet.</p>';
}
function renderProjects(){const el=document.getElementById('projectsOut');if(!el)return;el.innerHTML=state.projects.length?state.projects.map(b=>'<div class="card"><h3>'+esc(b.title)+'</h3><p>'+esc(b.desc||b.kind||'')+'</p><p class="muted small">'+(b.pages?b.pages.length+' pages · ':'')+esc(b.type||b.kind||'')+'</p><div class="row"><button class="btn" onclick="openProject(\''+b.id+'\')">Open</button><button class="btn" onclick="duplicateProject(\''+b.id+'\')">Duplicate</button><button class="btn danger" onclick="deleteProject(\''+b.id+'\')">Delete</button></div></div>').join(''):'<p class="muted">No projects yet — create one.</p>';}
function openProject(id){const b=state.projects.find(p=>p.id===id);if(!b)return;if(b.kind==='book'||b.pages){current=b;renderBookOut();renderEditor();go('book');}else if(b.kind==='comic'){go('comic');}else{go('projects');}}
function duplicateProject(id){const b=state.projects.find(p=>p.id===id);if(!b)return;const c=JSON.parse(JSON.stringify(b));c.id=uid();c.title=b.title+' (copy)';state.projects.unshift(c);save();renderProjects();}
function deleteProject(id){if(!confirm('Delete this project?'))return;state.projects=state.projects.filter(p=>p.id!==id);state.library=state.library.filter(p=>p.id!==id);save();renderProjects();renderLibrary();}
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
    storyboard.push(scene); pos=exit;
  }
  const out=document.getElementById('animOut');
  out.innerHTML=storyboard.map((s,i)=>'<div class="book-page"><strong>Scene '+s.n+'</strong><p>'+esc(s.narration)+'</p><p class="small">Entry: <strong>'+esc(s.entry)+'</strong> · Start: '+esc(s.start)+' → End: '+esc(s.end)+' · Exit: '+esc(s.exit)+'</p><p class="small muted">Continuity: '+(i===0?'starts centre':('starts at '+storyboard[i-1].end+' (previous scene end)'))+'</p><p class="mono small">'+esc(s.prompt)+'</p><div class="row"><button class="btn" onclick="copyPrompt('+i+')">📋 Copy prompt</button></div></div>').join('');
  logHistory('animation','Storyboard: '+n+' scenes — '+idea);save();
}
function copyText(t){if(navigator.clipboard)navigator.clipboard.writeText(t);else{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}}
function copyPrompt(i){copyText(storyboard[i].prompt);alert('Prompt copied.');}
function copyAllPrompts(){if(!storyboard.length)return alert('Generate a storyboard first.');copyText(storyboard.map(s=>s.prompt).join('\n\n'));alert('All '+storyboard.length+' prompts copied.');}
function renderVideo(){
  if(!storyboard.length)return alert('Generate a storyboard first.');
  const ratio=document.getElementById('anRatio').value, dur=parseInt(document.getElementById('anDur').value)||60;
  const q=document.getElementById('anQuality').value;
  const W=ratio==='9:16'?(q==='1080p'?1080:720):ratio==='16:9'?(q==='1080p'?1920:1280):(q==='1080p'?1080:720);
  const H=ratio==='9:16'?(q==='1080p'?1920:1280):ratio==='16:9'?(q==='1080p'?1080:720):(q==='1080p'?1080:720);
  const status=document.getElementById('renderStatus');status.textContent='Rendering '+dur+'s · '+ratio+' · '+q+' … (in this browser)';
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
  const stream=canvas.captureStream(30);let mime='video/webm';if(!MediaRecorder.isTypeSupported(mime))mime='';
  const rec=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:5000000}:undefined);
  const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  rec.onstop=()=>{const blob=new Blob(chunks,{type:'video/webm'});const url=URL.createObjectURL(blob);const v=document.getElementById('animVideo');v.src=url;v.style.display='block';const a=document.createElement('a');a.href=url;a.download='vitalize-storynest-video-'+dur+'s.webm';a.click();status.textContent='Done — video downloaded (WebM, '+dur+'s, '+ratio+', '+q+'). Playback above.';document.getElementById('renderNote').textContent='Built-in renderer: canvas + MediaRecorder in this browser. Not an external AI video model.';logHistory('video','Rendered '+dur+'s video '+ratio+' '+q);save();};
  rec.start();
  const per=dur/storyboard.length;const start=performance.now();
  function draw(now){
    const t=(now-start)/1000;if(t>=dur){rec.stop();return;}
    const idx=Math.min(storyboard.length-1,Math.floor(t/per));const local=(t-idx*per)/per;const s=storyboard[idx];
    const zoom=1+local*0.15;ctx.save();ctx.fillStyle=['#fde68a','#bae6fd','#fbcfe8','#d1fae5'][idx%4];ctx.fillRect(0,0,W,H);
    ctx.translate(W/2,H/2);ctx.scale(zoom,zoom);ctx.translate(-W/2,-H/2);
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(W/2,H*0.4,Math.min(W,H)*0.18,0,7);ctx.fill();
    ctx.fillStyle='#1e1b2e';ctx.beginPath();ctx.arc(W/2-30,H*0.38,8,0,7);ctx.arc(W/2+30,H*0.38,8,0,7);ctx.fill();
    ctx.strokeStyle='#1e1b2e';ctx.lineWidth=5;ctx.beginPath();ctx.arc(W/2,H*0.42,40,0.2,Math.PI-0.2);ctx.stroke();
    ctx.restore();
    ctx.fillStyle='rgba(0,0,0,0.65)';ctx.fillRect(0,H-90,W,90);ctx.fillStyle='#fff';ctx.font='28px sans-serif';ctx.fillText('Scene '+(idx+1)+' — '+s.narration.slice(0,70),20,H-40);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
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
  const panels=[];for(let i=0;i<n;i++)panels.push({n:i+1,dialogue:i===0?'"Let\'s build it!" said Bolt.':i===n-1?'"We did it!" cheered Pip.':'"Look! Up there!" laughed Pip.',text:'Panel '+(i+1)+': '+idea+' — moment '+(i+1)+' of '+n+'.'});
  const comic={id:uid(),kind:'comic',title:idea,desc:layout+' · '+n+' panels',created:new Date().toISOString(),panels};
  state.projects.unshift(comic);
  document.getElementById('comicOut').innerHTML='<div class="page-grid">'+panels.map(p=>'<div class="page-card"><img src="'+makeSVG({scene:p.text,text:p.dialogue},'Comic')+'" alt="Comic panel"><div class="pad"><strong>Panel '+p.n+'</strong><p>'+esc(p.text)+'</p><p><strong>'+esc(p.dialogue)+'</strong></p></div></div>').join('')+'</div>';
  logHistory('comic','Generated comic: '+idea+' ('+n+' panels)');save();
}

/* ---------- Providers / Settings ---------- */
const PROVIDERS=[{id:'runway',name:'Runway (video)',endpoint:'https://api.runwayml.com/v1'},{id:'pika',name:'Pika (video)',endpoint:'https://api.pika.art/v1'},{id:'luma',name:'Luma Dream Machine (video)',endpoint:'https://api.lumalabs.ai/dream-machine/v1'},{id:'kling',name:'Kling (video)',endpoint:'https://api.klingai.com/v1'},{id:'veo',name:'Veo / Google (video)',endpoint:'https://generativelanguage.googleapis.com/v1beta'},{id:'openai',name:'OpenAI (LLM / image)',endpoint:'https://api.openai.com/v1'}];
function renderProviders(){const el=document.getElementById('providerList');if(!el)return;el.innerHTML=PROVIDERS.map(p=>{const s=state.providers[p.id]||{};const st=s.verified?'✅ Verified':(s.key?'Key saved — not verified':'Not connected');return '<div class="card"><h3>'+esc(p.name)+'</h3><p class="muted small">'+esc(p.endpoint)+'</p><p><strong>'+st+'</strong></p><input type="password" id="key-'+p.id+'" placeholder="API key (stored only in this browser)" value="'+esc(s.key||'')+'"><div class="row"><button class="btn" onclick="saveKey(\''+p.id+'\')">Save key</button><button class="btn" onclick="testProvider(\''+p.id+'\')">Test Connection</button></div><p class="small" id="test-'+p.id+'"></p></div>';}).join('');}
function saveKey(id){const v=document.getElementById('key-'+id).value.trim();state.providers[id]={key:v,verified:false};save();renderProviders();document.getElementById('test-'+id).textContent='Key saved — not verified. Press Test Connection.';}
async function testProvider(id){const p=PROVIDERS.find(x=>x.id===id);const s=state.providers[id]||{};const el=document.getElementById('test-'+id);if(!s.key){el.textContent='No key saved — cannot test.';return;}el.textContent='Testing…';try{const r=await fetch(p.endpoint,{method:'GET',headers:s.key?{Authorization:'Bearer '+s.key}:{},mode:'cors'});if(r.ok||r.status===401||r.status===403){s.verified=r.ok;save();renderProviders();document.getElementById('test-'+id).textContent=r.ok?'✅ Verified — provider responded.':'Provider responded '+r.status+' — key not accepted. Key saved — not verified.';}else{s.verified=false;save();renderProviders();document.getElementById('test-'+id).textContent='Provider responded '+r.status+'. Key saved — not verified.';}}catch(e){s.verified=false;save();renderProviders();const t=document.getElementById('test-'+id);if(t)t.textContent='Could not reach provider from this browser (network/CORS). Key saved — not verified. This does not claim a fake connection.';}}
function setTheme(t){state.theme=t;document.body.className=t==='dark'?'dark':'';save();}
function exportAllData(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.download='vitalize-storynest-data.json';a.click();}
function clearAllData(){if(!confirm('Delete ALL local StoryNest data in this browser?'))return;localStorage.removeItem(LS);location.reload();}

/* ---------- Init ---------- */
seed();renderCounts();renderChars();renderHome();renderLibrary();renderProjects();renderDashboard();renderAdmin();renderProviders();
if(state.theme==='dark')document.body.className='dark';
