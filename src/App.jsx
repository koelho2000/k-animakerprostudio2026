import { useState, useEffect, useCallback } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const FILM_TYPES   = ["Drama","Action","Thriller","Comedy","Horror","Sci-Fi","Romance","Documentary","Animation","Short Film","Musical","Neo-Noir","Western","Period Film"];
const FILM_FORMATS = ["Feature Film","Short Film","Series Episode","Pilot","Documentary","Commercial","Music Video","Web Series","Micro Film"];
const LANGUAGES    = ["Português","English","Español","Français","Italiano","Deutsch","日本語","中文"];
const CAM_ANGLES   = ["Eye Level","High Angle","Low Angle","Bird's Eye / Aerial","Worm's Eye","Dutch Angle / Canted","Over-the-Shoulder","Point of View (POV)","Reverse Angle"];
const CAM_MOVES    = ["Static","Pan Left","Pan Right","Tilt Up","Tilt Down","Dolly In","Dolly Out","Tracking Shot","Crane Up","Crane Down","Handheld","Steadicam","Arc / Circular","Whip Pan","Roll"];
const LENS_TYPES   = ["Ultra Wide (8-14mm)","Wide (16-24mm)","Normal (35-50mm)","Portrait (85mm)","Telephoto (135mm)","Super Telephoto (200mm+)","Macro","Fisheye","Anamorphic","Tilt-Shift"];
const FRAMINGS     = ["Extreme Wide Shot (EWS)","Wide Shot (WS)","Medium Wide Shot (MWS)","Medium Shot (MS)","Medium Close-Up (MCU)","Close-Up (CU)","Extreme Close-Up (ECU)","Two-Shot","Three-Shot","Group Shot","Insert / Detail"];
const TIME_OF_DAY  = ["Dawn / Amanhecer","Morning / Manhã","Noon / Meio-dia","Golden Hour / Tarde","Dusk / Entardecer","Night / Noite","Interior Day","Interior Night","Magic Hour"];
const LIGHTING     = ["Natural Light","Soft Box","Three-Point","High Key","Low Key","Silhouette","Rembrandt","Neon / Practical","Chiaroscuro","Motivated"];

// ─── THEME ────────────────────────────────────────────────────────────────────
const T = {
  bg:          "#07070f",
  surface:     "#0f0f1c",
  surface2:    "#161628",
  surface3:    "#1e1e35",
  border:      "#252540",
  borderHover: "#3a3a60",
  accent:      "#e8b84b",
  accentDim:   "#6b520f",
  accentGlow:  "rgba(232,184,75,0.12)",
  text:        "#ddd8f0",
  textMid:     "#8880aa",
  textMuted:   "#4a4870",
  red:         "#e05252",
  green:       "#52b788",
  blue:        "#5299e0",
  purple:      "#9b72cf",
};

// ─── STORAGE LAYER ────────────────────────────────────────────────────────────
// Design: _mem (Map) is the source of truth — always written first, always
// read as fallback. window.storage is the persistence layer — written async
// with a hard timeout so it NEVER blocks the UI.

const _mem = new Map();
let _cloudOK = false;

// Race window.storage test against 1.5 s — always resolves
const storageReady = (async () => {
  try {
    const ws = window.storage;
    if (!ws) return false;
    const ok = await Promise.race([
      (async () => {
        await ws.set("__ping__","ok");
        const r = await ws.get("__ping__");
        ws.delete("__ping__").catch(()=>{});
        return r?.value === "ok";
      })(),
      new Promise(res => setTimeout(() => res(false), 1500))
    ]);
    _cloudOK = !!ok;
    return _cloudOK;
  } catch { return false; }
})();

// ── Core primitives — _mem first, cloud fire-and-forget ──────────────────────
const dbGet = async (k) => {
  // Always check _mem first (synchronous, instant)
  const local = _mem.get(k);
  if (local !== undefined) {
    try { return JSON.parse(local); } catch { return null; }
  }
  // If cloud available, try to fetch (may have data from previous session)
  if (_cloudOK) {
    try {
      const r = await Promise.race([
        window.storage.get(k),
        new Promise(res => setTimeout(() => res(null), 1000))
      ]);
      if (r?.value) {
        _mem.set(k, r.value); // cache locally
        return JSON.parse(r.value);
      }
    } catch {}
  }
  return null;
};

const dbSet = async (k, v) => {
  const s = JSON.stringify(v);
  _mem.set(k, s); // write to memory immediately — this is what all reads see
  if (_cloudOK) {
    // Cloud write is fire-and-forget with timeout — never blocks caller
    Promise.race([
      window.storage.set(k, s),
      new Promise(res => setTimeout(res, 1000))
    ]).catch(() => {});
  }
  return true;
};

const dbDelete = async (k) => {
  _mem.delete(k);
  if (_cloudOK) { window.storage.delete(k).catch(() => {}); }
};

// ── Domain helpers — no storageReady dependency, always instant ───────────────
const getUser      = (u)    => dbGet(`u:${u}`);
const saveUser     = async (u, h) => {
  await dbSet(`u:${u}`, {username:u, hash:h});
  // Verify write to _mem succeeded (should always pass)
  if (!_mem.has(`u:${u}`)) throw new Error("Falha interna ao guardar utilizador.");
};
const getProjects  = async (u)    => (await dbGet(`pl:${u}`)) || [];
const saveProjects = (u, l)       => dbSet(`pl:${u}`, l);
const getProject   = (u, id)      => dbGet(`p:${u}:${id}`);
const saveProject  = async (u, p) => {
  await dbSet(`p:${u}:${p.id}`, p);
  const list = await getProjects(u);
  const meta = {id:p.id,title:p.title,genre:p.genre,format:p.format,
    language:p.language,duration:p.duration,updatedAt:p.updatedAt,sceneCount:p.scenes.length};
  const idx = list.findIndex(x => x.id===p.id);
  if (idx>=0) list[idx]=meta; else list.push(meta);
  await saveProjects(u, list);
};
const deleteProject = async (u, id) => {
  await dbDelete(`p:${u}:${id}`);
  const list = await getProjects(u);
  await saveProjects(u, list.filter(x => x.id!==id));
};
function hashPw(s){let h=5381;for(let i=0;i<s.length;i++)h=(h*33)^s.charCodeAt(i);return(h>>>0).toString(16);}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}

// ─── FACTORIES ────────────────────────────────────────────────────────────────
const newTake = (num=1) => ({
  id:uid(), number:num,
  cameraAngle:"Eye Level", cameraMovement:"Static",
  lens:"Normal (35-50mm)", framing:"Medium Shot",
  lighting:"Natural Light",
  characters:"", action:"", dialogue:"", narration:"",
  sound:"", music:"", duration:5, fps:24,
  imagePrompt:"", videoPrompt:"", notes:""
});

const newScene = (num=1) => ({
  id:uid(), number:num,
  title:`Cena ${num}`, location:"", timeOfDay:"Interior Day",
  description:"", notes:"",
  takes:[newTake(1)]
});

const newProject = (title,genre,language,format,duration) => ({
  id:uid(), title, genre, language, format, duration,
  createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
  scenes:[newScene(1)]
});

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
const Label = ({children})=>(
  <div style={{fontSize:9,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.18em",
    color:T.textMuted,textTransform:"uppercase",marginBottom:5}}>{children}</div>
);

const FieldWrap = ({label,children,style})=>(
  <div style={{marginBottom:14,...style}}><Label>{label}</Label>{children}</div>
);

const inputBase = {
  width:"100%",boxSizing:"border-box",
  background:T.bg,border:`1px solid ${T.border}`,color:T.text,
  padding:"8px 11px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,
  outline:"none",borderRadius:5,transition:"border-color 0.2s"
};

const Inp = ({label,value,onChange,type="text",placeholder,style})=>{
  const [focus,setFocus]=useState(false);
  return(
    <FieldWrap label={label} style={style}>
      <input type={type} value={value??""} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder} onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
        style={{...inputBase,borderColor:focus?T.accent:T.border}} />
    </FieldWrap>
  );
};

const TA = ({label,value,onChange,rows=3,placeholder})=>{
  const [focus,setFocus]=useState(false);
  return(
    <FieldWrap label={label}>
      <textarea value={value??""} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder} rows={rows}
        onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
        style={{...inputBase,resize:"vertical",lineHeight:1.6,borderColor:focus?T.accent:T.border}} />
    </FieldWrap>
  );
};

const Sel = ({label,value,onChange,options})=>(
  <FieldWrap label={label}>
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{...inputBase,cursor:"pointer"}}>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  </FieldWrap>
);

const Btn = ({children,onClick,variant="primary",style,disabled,title})=>{
  const [hover,setHover]=useState(false);
  const v={
    primary:  {bg:T.accent,       color:"#000",         border:"none"},
    secondary:{bg:hover?"#ffffff10":"transparent",color:T.text,    border:`1px solid ${T.border}`},
    ghost:    {bg:hover?"#ffffff08":"transparent",color:T.textMid,  border:"none"},
    danger:   {bg:hover?"#e0525220":"transparent",color:T.red,      border:`1px solid ${T.red}40`},
    accent:   {bg:hover?`${T.accent}30`:T.accentGlow,color:T.accent,border:`1px solid ${T.accentDim}`},
  }[variant]||{};
  return(
    <button onClick={onClick} disabled={disabled} title={title}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{padding:"8px 16px",borderRadius:5,cursor:disabled?"not-allowed":"pointer",
        fontFamily:"'JetBrains Mono',monospace",fontSize:11,letterSpacing:"0.05em",
        opacity:disabled?0.45:1,transition:"all 0.15s",whiteSpace:"nowrap",
        background:v.bg,color:v.color,border:v.border,...style}}>
      {children}
    </button>
  );
};

const Tag = ({children,color=T.accent})=>(
  <span style={{fontSize:9,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.12em",
    color,background:`${color}18`,border:`1px solid ${color}40`,
    padding:"2px 7px",borderRadius:3,whiteSpace:"nowrap"}}>{children}</span>
);

const Divider = ()=><div style={{height:1,background:T.border,margin:"16px 0"}}/>;

// ─── LOGIN / REGISTER ─────────────────────────────────────────────────────────
function AuthScreen({onLogin, onGuest}){
  const [mode,setMode]        = useState("login");
  const [user,setUser]        = useState("");
  const [pass,setPass]        = useState("");
  const [err,setErr]          = useState("");
  const [loading,setLoading]  = useState(false);
  const [cloudOk,setCloudOk]  = useState(null);   // null=checking, true/false

  // Check storage on mount
  useEffect(()=>{
    storageReady.then(ok => setCloudOk(ok));
  },[]);

  const done = (msg) => { setErr(msg); setLoading(false); };

  const submit = async () => {
    if (!user.trim() || !pass.trim()) { setErr("Preenche todos os campos."); return; }
    setLoading(true); setErr("");
    try {
      const h = hashPw(pass);

      if (mode === "login") {
        const u = await getUser(user.trim());
        if (!u)           return done("Utilizador não encontrado.");
        if (u.hash !== h) return done("Password incorreta.");
        setLoading(false);
        onLogin(user.trim());

      } else {
        if (pass.length < 4) return done("Password mínima: 4 caracteres.");
        const ex = await getUser(user.trim());
        if (ex) return done("Nome de utilizador já existe. Escolhe outro.");
        await saveUser(user.trim(), h);
        setLoading(false);
        onLogin(user.trim());
      }
    } catch(e) { done("Erro: " + e.message); }
  };

  return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",
      justifyContent:"center",
      backgroundImage:"radial-gradient(ellipse 80% 60% at 50% 0%, #1a103880 0%, transparent 70%)"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:${T.bg}}
        ::-webkit-scrollbar-thumb{background:${T.surface3};border-radius:3px}
        select option{background:${T.surface}}
        input::placeholder,textarea::placeholder{color:${T.textMuted};opacity:1}
      `}</style>

      <div style={{width:460,padding:"48px 44px",background:T.surface,
        border:`1px solid ${T.border}`,borderRadius:12,
        boxShadow:"0 40px 80px #00000080"}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontSize:44,marginBottom:10,filter:"drop-shadow(0 0 20px #e8b84b60)"}}>🎬</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:26,color:T.accent,
            fontWeight:700,letterSpacing:"0.06em"}}>K-ANIMAKERPROSTUDIO2026</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:T.textMuted,
            letterSpacing:"0.35em",marginTop:6,textTransform:"uppercase"}}>Storyboard · Cinema · IA</div>
        </div>

        {/* Storage status pill */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:22}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"0.12em",
            padding:"4px 12px",borderRadius:10,border:"1px solid",
            borderColor: cloudOk===null?T.border: cloudOk?T.green:T.accent,
            color:        cloudOk===null?T.textMuted: cloudOk?T.green:T.accent,
            background:   cloudOk===null?"transparent": cloudOk?`${T.green}10`:`${T.accent}10`,
          }}>
            {cloudOk===null ? "⏳ A verificar armazenamento…"
              : cloudOk     ? "☁ Armazenamento cloud activo — dados persistentes"
                            : "💾 Modo sessão — dados guardados apenas nesta sessão"}
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:6,marginBottom:24,background:T.bg,
          padding:4,borderRadius:7,border:`1px solid ${T.border}`}}>
          {[["login","Entrar"],["register","Registar"]].map(([m,l])=>(
            <button key={m} onClick={()=>{setMode(m);setErr("");}}
              style={{flex:1,padding:"9px",border:"none",
                background:mode===m?T.surface3:"transparent",
                color:mode===m?T.accent:T.textMid,
                fontFamily:"'JetBrains Mono',monospace",fontSize:11,
                letterSpacing:"0.1em",cursor:"pointer",borderRadius:5,transition:"all 0.2s"}}>
              {l}
            </button>
          ))}
        </div>

        <div onKeyDown={e=>e.key==="Enter"&&!loading&&submit()}>
          <Inp label="Utilizador" value={user}
            onChange={v=>{setUser(v);setErr("");}} placeholder="nome de utilizador" />
          <Inp label="Password"   value={pass}
            onChange={v=>{setPass(v);setErr("");}} type="password" placeholder="••••••••"
            style={{marginBottom:4}}/>
          {mode==="register"&&(
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,
              color:T.textMuted,marginBottom:14,paddingLeft:2}}>
              Mínimo 4 caracteres
            </div>
          )}
        </div>

        {err&&(
          <div style={{color:T.red,fontFamily:"'JetBrains Mono',monospace",
            fontSize:11,marginBottom:14,padding:"10px 12px",background:"#e0525210",
            border:`1px solid ${T.red}40`,borderRadius:5,lineHeight:1.6}}>
            ⚠ {err}
          </div>
        )}

        <Btn onClick={submit} disabled={loading}
          style={{width:"100%",padding:"12px",fontSize:12,letterSpacing:"0.08em",marginBottom:10}}>
          {loading ? "A processar…"
            : mode==="login" ? "Entrar no Studio"
            : "Criar Conta"}
        </Btn>

        {/* Divider */}
        <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0"}}>
          <div style={{flex:1,height:1,background:T.border}}/>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,
            color:T.textMuted,letterSpacing:"0.15em"}}>OU</span>
          <div style={{flex:1,height:1,background:T.border}}/>
        </div>

        {/* Guest */}
        <button onClick={onGuest}
          style={{width:"100%",padding:"11px",background:"transparent",
            border:`1px dashed ${T.border}`,borderRadius:5,cursor:"pointer",
            fontFamily:"'JetBrains Mono',monospace",fontSize:11,
            color:T.textMid,letterSpacing:"0.08em",transition:"all 0.2s",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.textMid;e.currentTarget.style.color=T.text;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.textMid;}}>
          <span style={{fontSize:14}}>👁</span>
          Continuar como Convidado
        </button>

        <div style={{textAlign:"center",marginTop:14,fontFamily:"'JetBrains Mono',monospace",
          fontSize:8,color:T.textMuted,letterSpacing:"0.08em",lineHeight:1.7}}>
          Convidado: acesso total ao editor · sem gravação de dados
          <br/>KOELHO2000 © 2026 · K-ANIMAKERPROSTUDIO2026
        </div>
      </div>
    </div>
  );
}


// ─── GUEST BANNER ─────────────────────────────────────────────────────────────
function GuestBanner({onLogin}){
  const [vis,setVis]=useState(true);
  if(!vis)return null;
  return(
    <div style={{background:"#1a1200",borderBottom:`2px solid ${T.accent}50`,
      padding:"9px 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
      <span style={{fontSize:15}}>👁</span>
      <div style={{flex:1}}>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:T.accent,
          fontWeight:600,letterSpacing:"0.12em"}}>MODO CONVIDADO</span>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:T.textMid,marginLeft:12}}>
          Podes explorar e editar livremente — os dados <strong style={{color:T.red}}>não são guardados</strong> nesta sessão.
        </span>
      </div>
      <button onClick={onLogin}
        style={{background:T.accent,border:"none",color:"#000",cursor:"pointer",
          fontFamily:"'JetBrains Mono',monospace",fontSize:10,fontWeight:700,
          padding:"6px 16px",borderRadius:4,letterSpacing:"0.08em",whiteSpace:"nowrap"}}>
        Criar Conta / Entrar
      </button>
      <button onClick={()=>setVis(false)}
        style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",
          fontSize:16,padding:"2px 6px",lineHeight:1}}>✕</button>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({username,onOpen,onLogout,isGuest,guestProjects,setGuestProjects,onGenerateAI,onOpenMedia,onOpenProfile,onOpenAPIKeys,onOpenProduction,onOpenCredits}){
  const [cloudProjects,setCloudProjects]=useState([]);
  const [loading,setLoading]=useState(!isGuest);
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({title:"",genre:"Drama",language:"Português",format:"Feature Film",duration:90});

  const projects = isGuest ? guestProjects : cloudProjects;
  const setProjects = isGuest ? setGuestProjects : setCloudProjects;

  useEffect(()=>{
    if(isGuest){ setLoading(false); return; }
    getProjects(username).then(p=>{setCloudProjects(p);setLoading(false);});
  },[username,isGuest]);

  const create=async()=>{
    if(!form.title.trim())return;
    const p=newProject(form.title,form.genre,form.language,form.format,form.duration);
    if(!isGuest) await saveProject(username,p);
    const meta={id:p.id,title:p.title,genre:p.genre,format:p.format,
      language:p.language,duration:p.duration,updatedAt:p.updatedAt,sceneCount:1,_full:p};
    setProjects(ps=>[...ps,meta]);
    setShowNew(false);
    setForm({title:"",genre:"Drama",language:"Português",format:"Feature Film",duration:90});
    onOpen(p.id);
  };

  const del=async(id,e)=>{
    e.stopPropagation();
    if(!confirm("Eliminar este projeto?"))return;
    if(!isGuest) await deleteProject(username,id);
    setProjects(ps=>ps.filter(p=>p.id!==id));
  };

  const genreColors={
    "Drama":T.blue,"Action":T.red,"Thriller":T.purple,"Comedy":T.green,
    "Horror":T.red,"Sci-Fi":T.blue,"Romance":T.accent
  };

  return(
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Playfair Display',serif",
      display:"flex",flexDirection:"column"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${T.bg}}
        ::-webkit-scrollbar-thumb{background:${T.surface3};border-radius:3px}
        select option{background:${T.surface}}
        input::placeholder,textarea::placeholder{color:${T.textMuted};opacity:1}
      `}</style>

      {/* Guest banner */}
      {isGuest&&<GuestBanner onLogin={onLogout}/>}

      {/* Header */}
      <div style={{borderBottom:`1px solid ${T.border}`,padding:"0 32px",
        background:T.surface,height:60,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <span style={{fontSize:22}}>🎬</span>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:17,color:T.accent,fontWeight:700,letterSpacing:"0.06em"}}>K-ANIMAKERPROSTUDIO2026</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:T.textMuted,letterSpacing:"0.25em"}}>Storyboard · Cinema · IA</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:T.textMid,
            padding:"6px 12px",background:T.surface3,borderRadius:5,border:`1px solid ${T.border}`}}>
            {isGuest?"👁 Convidado":`👤 ${username}`}
          </div>
          {!isGuest&&(
            <>
              <button onClick={onOpenMedia}
                title="Biblioteca de Media"
                style={{background:"none",border:`1px solid ${T.border}`,color:T.textMid,cursor:"pointer",
                  fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:"5px 10px",borderRadius:5}}>
                🎞 Biblioteca
              </button>
              <button onClick={onOpenAPIKeys}
                title="Chaves API"
                style={{background:"none",border:`1px solid ${T.border}`,color:T.textMid,cursor:"pointer",
                  fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:"5px 10px",borderRadius:5}}>
                🔑 API
              </button>
              <button onClick={onOpenProfile}
                title="Perfil"
                style={{background:"none",border:`1px solid ${T.border}`,color:T.textMid,cursor:"pointer",
                  fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:"5px 10px",borderRadius:5}}>
                👤 Perfil
              </button>
            </>
          )}
          <Btn variant="secondary" onClick={onLogout} style={{fontSize:11}}>
            {isGuest?"Entrar / Registar":"Sair"}
          </Btn>
        </div>
      </div>

      <div style={{padding:"40px 48px",maxWidth:1200,margin:"0 auto",flex:1}}>
        {/* Page header */}
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:36}}>
          <div>
            <h1 style={{fontSize:34,color:T.text,fontWeight:700,marginBottom:6}}>
              {isGuest?"Projetos de Demonstração":"Os Meus Projetos"}
            </h1>
            <p style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:T.textMid}}>
              {projects.length} projeto(s){isGuest?" · sessão temporária":""}
            </p>
          </div>
          <div style={{display:"flex",gap:10}}>
            <Btn variant="accent" onClick={onGenerateAI} style={{fontSize:12,padding:"10px 20px"}}>
              ✨ Gerar com IA
            </Btn>
            <Btn onClick={()=>setShowNew(p=>!p)} style={{fontSize:12,padding:"10px 20px"}}>
              ＋ Novo Projeto
            </Btn>
          </div>
        </div>

        {/* New Project Form */}
        {showNew&&(
          <div style={{background:T.surface,border:`1px solid ${T.accent}40`,borderRadius:10,
            padding:28,marginBottom:36,boxShadow:`0 0 40px ${T.accentGlow}`}}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:T.accent,
              letterSpacing:"0.15em",marginBottom:20,textTransform:"uppercase"}}>
              ✦ Novo Projeto de Cinema {isGuest&&<span style={{color:T.red,marginLeft:8}}>(temporário)</span>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 80px",gap:16,marginBottom:16}}>
              <Inp label="Título do Projeto" value={form.title} onChange={v=>setForm(f=>({...f,title:v}))} placeholder="Nome do seu filme..." />
              <Sel label="Género" value={form.genre} onChange={v=>setForm(f=>({...f,genre:v}))} options={FILM_TYPES} />
              <Sel label="Língua" value={form.language} onChange={v=>setForm(f=>({...f,language:v}))} options={LANGUAGES} />
              <Sel label="Formato" value={form.format} onChange={v=>setForm(f=>({...f,format:v}))} options={FILM_FORMATS} />
              <Inp label="Min." value={form.duration} onChange={v=>setForm(f=>({...f,duration:v}))} type="number" />
            </div>
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={create}>Criar Projeto</Btn>
              <Btn variant="secondary" onClick={()=>setShowNew(false)}>Cancelar</Btn>
            </div>
          </div>
        )}

        {/* Projects Grid */}
        {loading?(
          <div style={{textAlign:"center",color:T.textMuted,fontFamily:"'JetBrains Mono',monospace",padding:80,fontSize:12}}>
            ⏳ A carregar projetos...
          </div>
        ):projects.length===0?(
          <div style={{textAlign:"center",padding:"80px 0"}}>
            <div style={{fontSize:56,marginBottom:20,opacity:0.4}}>🎞️</div>
            <div style={{color:T.textMid,fontFamily:"'JetBrains Mono',monospace",fontSize:13,marginBottom:8}}>Sem projetos ainda.</div>
            <div style={{color:T.textMuted,fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>
              {isGuest?"Cria um projeto de demonstração sem necessidade de conta!":"Cria o teu primeiro storyboard!"}
            </div>
          </div>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:20}}>
            {projects.map(p=>{
              const col=genreColors[p.genre]||T.accent;
              return(
                <div key={p.id} onClick={()=>onOpen(p.id)}
                  style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,
                    padding:24,cursor:"pointer",transition:"all 0.2s",position:"relative",overflow:"hidden"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=col;e.currentTarget.style.transform="translateY(-2px)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.transform="translateY(0)";}}>
                  <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${col},transparent)`}}/>
                  {isGuest&&<div style={{position:"absolute",top:10,right:36,
                    fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:T.red,
                    letterSpacing:"0.1em",opacity:0.7}}>TEMP</div>}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                    <div style={{fontSize:28}}>🎬</div>
                    <div style={{display:"flex",gap:4}}>
                      {onOpenProduction&&(
                        <button onClick={e=>{e.stopPropagation();onOpenProduction(p.id);}}
                          title="Produção / Preview"
                          style={{background:"none",border:"none",color:T.blue,cursor:"pointer",
                            fontSize:13,opacity:0.6,padding:2,lineHeight:1}}
                          onMouseEnter={e=>e.currentTarget.style.opacity=1}
                          onMouseLeave={e=>e.currentTarget.style.opacity=0.6}>🎥</button>
                      )}
                      {onOpenCredits&&(
                        <button onClick={e=>{e.stopPropagation();onOpen(p.id);setTimeout(()=>onOpenCredits(p.id),100);}}
                          title="Créditos & Intro"
                          style={{background:"none",border:"none",color:T.purple,cursor:"pointer",
                            fontSize:13,opacity:0.6,padding:2,lineHeight:1}}
                          onMouseEnter={e=>e.currentTarget.style.opacity=1}
                          onMouseLeave={e=>e.currentTarget.style.opacity=0.6}>🎞</button>
                      )}
                      <button onClick={e=>del(p.id,e)}
                        title="Eliminar projeto"
                        style={{background:"none",border:"none",color:T.red,cursor:"pointer",
                          fontSize:13,opacity:0.5,lineHeight:1,padding:2}}
                        onMouseEnter={e=>e.currentTarget.style.opacity=1}
                        onMouseLeave={e=>e.currentTarget.style.opacity=0.5}>✕</button>
                    </div>
                  </div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:T.text,
                    fontWeight:600,marginBottom:10,lineHeight:1.3}}>{p.title}</div>
                  <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
                    <Tag color={col}>{p.genre}</Tag>
                    <Tag color={T.textMid}>{p.language}</Tag>
                    <Tag color={T.textMuted}>{p.format}</Tag>
                  </div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,
                    color:T.textMuted,display:"flex",gap:16}}>
                    <span>⏱ {p.duration} min</span>
                    <span>🎞 {p.sceneCount||0} cenas</span>
                    <span>📅 {new Date(p.updatedAt).toLocaleDateString("pt-PT")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN EDITOR ──────────────────────────────────────────────────────────────
function Editor({username,projectId,onBack,isGuest,guestProjects,setGuestProjects,onOpenCredits,onOpenProduction,onOpenMedia,onOpenAPIKeys}){
  const [proj,setProj]=useState(null);
  const [selScene,setSelScene]=useState(null);
  const [selTake,setSelTake]=useState(null);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [tab,setTab]=useState("camera");
  const [projOpen,setProjOpen]=useState(false);
  const [aiLoad,setAiLoad]=useState({img:false,vid:false});

  useEffect(()=>{
    if(isGuest){
      const meta=(guestProjects||[]).find(p=>p.id===projectId);
      const p=meta?._full||null;
      if(p){ setProj(p); setSelScene(p.scenes[0]?.id||null); setSelTake(p.scenes[0]?.takes[0]?.id||null); }
    } else {
      getProject(username,projectId).then(p=>{
        if(p){ setProj(p); setSelScene(p.scenes[0]?.id||null); setSelTake(p.scenes[0]?.takes[0]?.id||null); }
      });
    }
  },[projectId,username,isGuest]);

  const save=async(p=proj)=>{
    if(!p||isGuest)return;
    setSaving(true);
    const u={...p,updatedAt:new Date().toISOString()};
    await saveProject(username,u);
    setProj(u);setSaving(false);setSaved(true);
    setTimeout(()=>setSaved(false),2500);
  };

  // Auto-save (only for authenticated users)
  useEffect(()=>{
    if(!proj||isGuest)return;
    const t=setTimeout(()=>save(proj),3000);
    return()=>clearTimeout(t);
  },[proj]);

  // Sync guest project in memory
  useEffect(()=>{
    if(!isGuest||!proj||!setGuestProjects)return;
    setGuestProjects(ps=>ps.map(p=>p.id===proj.id?{...p,_full:proj,sceneCount:proj.scenes.length}:p));
  },[proj,isGuest]);

  const updProj=changes=>setProj(p=>({...p,...changes}));

  const updScene=(sid,changes)=>setProj(p=>({
    ...p,scenes:p.scenes.map(s=>s.id===sid?{...s,...changes}:s)
  }));

  const updTake=(sid,tid,changes)=>setProj(p=>({
    ...p,scenes:p.scenes.map(s=>s.id===sid?{
      ...s,takes:s.takes.map(t=>t.id===tid?{...t,...changes}:t)
    }:s)
  }));

  const addScene=()=>{
    const n=newScene(proj.scenes.length+1);
    setProj(p=>({...p,scenes:[...p.scenes,n]}));
    setSelScene(n.id);setSelTake(n.takes[0].id);
  };

  const dupScene=(sid)=>{
    const src=proj.scenes.find(s=>s.id===sid);
    const n={...JSON.parse(JSON.stringify(src)),id:uid(),number:proj.scenes.length+1,
      takes:src.takes.map(t=>({...t,id:uid()}))};
    setProj(p=>({...p,scenes:[...p.scenes,n]}));
    setSelScene(n.id);setSelTake(n.takes[0].id);
  };

  const delScene=(sid)=>{
    if(proj.scenes.length<=1)return;
    const ns=proj.scenes.filter(s=>s.id!==sid);
    setProj(p=>({...p,scenes:ns}));
    setSelScene(ns[0].id);setSelTake(ns[0].takes[0].id);
  };

  const addTake=(sid)=>{
    const sc=proj.scenes.find(s=>s.id===sid);
    const t=newTake(sc.takes.length+1);
    updScene(sid,{takes:[...sc.takes,t]});
    setSelTake(t.id);
  };

  const dupTake=(sid,tid)=>{
    const sc=proj.scenes.find(s=>s.id===sid);
    const src=sc.takes.find(t=>t.id===tid);
    const n={...JSON.parse(JSON.stringify(src)),id:uid(),number:sc.takes.length+1};
    updScene(sid,{takes:[...sc.takes,n]});
    setSelTake(n.id);
  };

  const delTake=(sid,tid)=>{
    const sc=proj.scenes.find(s=>s.id===sid);
    if(sc.takes.length<=1)return;
    const nt=sc.takes.filter(t=>t.id!==tid);
    updScene(sid,{takes:nt});
    setSelTake(nt[0].id);
  };

  const genAI=async(type)=>{
    const sc=proj.scenes.find(s=>s.id===selScene);
    const tk=sc?.takes.find(t=>t.id===selTake);
    if(!tk)return;
    setAiLoad(a=>({...a,[type]:true}));
    try{
      const ctx=`
PROJECT: "${proj.title}" | Genre: ${proj.genre} | Format: ${proj.format} | Language: ${proj.language} | Duration: ${proj.duration}min

SCENE ${sc.number}: "${sc.title}"
Location/Scenario: ${sc.location||"unspecified"}
Time of Day: ${sc.timeOfDay}
Scene Description: ${sc.description||"none"}

TAKE ${tk.number}:
- Framing: ${tk.framing}
- Camera Angle: ${tk.cameraAngle}
- Camera Movement: ${tk.cameraMovement}
- Lens: ${tk.lens}
- Lighting: ${tk.lighting}
- Characters: ${tk.characters||"none"}
- Action: ${tk.action||"none"}
- Dialogue: ${tk.dialogue||"none"}
- Narration: ${tk.narration||"none"}
- Sound FX: ${tk.sound||"none"}
- Music Mood: ${tk.music||"none"}
- Duration: ${tk.duration}s @ ${tk.fps}fps
- Notes: ${tk.notes||"none"}
      `.trim();

      const sys=type==="img"
        ? `You are a world-class cinematographer and AI prompt engineer.
Generate a single, highly detailed image generation prompt for Midjourney/DALL-E/Stable Diffusion based on this storyboard take.
Focus on: visual composition, lighting style, color palette, mood, atmosphere, costume, set design, depth of field.
Use cinematic language. Include aspect ratio suggestion (e.g. --ar 16:9). Max 250 words.
Output ONLY the prompt, no preamble or explanation.`
        : `You are a world-class film director and video prompt engineer.
Generate a single, highly detailed video generation prompt for Sora/Runway Gen-3/Pika/Kling based on this storyboard take.
Include: exact camera movement, speed, timing, visual transitions, color grade, film stock feel, mood.
Describe the motion in detail. Max 250 words.
Output ONLY the prompt, no preamble or explanation.`;

      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system:sys,
          messages:[{role:"user",content:ctx}]
        })
      });
      const data=await res.json();
      const txt=data.content?.[0]?.text||"";
      updTake(selScene,selTake,type==="img"?{imagePrompt:txt}:{videoPrompt:txt});
    }catch(e){console.error(e);}
    finally{setAiLoad(a=>({...a,[type]:false}));}
  };

  const genBoth=async()=>{await genAI("img");await genAI("vid");};

  if(!proj) return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:T.textMid,fontFamily:"'JetBrains Mono',monospace",fontSize:13}}>
        ⏳ A carregar projeto...
      </div>
    </div>
  );

  const sc=proj.scenes.find(s=>s.id===selScene);
  const tk=sc?.takes.find(t=>t.id===selTake);
  const totalTakes=proj.scenes.reduce((a,s)=>a+s.takes.length,0);
  const totalSec=proj.scenes.reduce((a,s)=>a+s.takes.reduce((b,t)=>b+(+t.duration||0),0),0);

  const TABS=[
    {id:"camera", icon:"📷", label:"Câmara"},
    {id:"audio",  icon:"🎵", label:"Áudio"},
    {id:"action", icon:"🎭", label:"Ação"},
    {id:"ai",     icon:"✨", label:"IA Prompts"},
  ];

  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:T.bg,overflow:"hidden",
      fontFamily:"'JetBrains Mono',monospace"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:${T.bg}}
        ::-webkit-scrollbar-thumb{background:${T.surface3};border-radius:3px}
        select option{background:${T.surface}}
        input::placeholder,textarea::placeholder{color:${T.textMuted};opacity:1}
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{height:50,background:T.surface,borderBottom:`1px solid ${T.border}`,
        display:"flex",alignItems:"center",padding:"0 14px",gap:10,flexShrink:0,zIndex:10}}>
        <button onClick={onBack}
          style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",
            fontSize:18,lineHeight:1,padding:"4px 6px"}}>‹</button>
        <span style={{fontSize:17}}>🎬</span>
        <span style={{fontFamily:"'Playfair Display',serif",color:T.accent,fontSize:14,fontWeight:700}}>K-ANIMAKERPROSTUDIO2026</span>
        <div style={{width:1,height:18,background:T.border}}/>
        <span style={{color:T.text,fontSize:13,fontWeight:600}}>{proj.title}</span>
        <Tag color={T.accent}>{proj.genre}</Tag>
        <Tag color={T.textMid}>{proj.format}</Tag>
        <Tag color={T.textMuted}>{proj.language}</Tag>
        <button onClick={()=>setProjOpen(p=>!p)}
          style={{background:"none",border:`1px solid ${T.border}`,color:T.textMid,
            cursor:"pointer",fontSize:10,fontFamily:"'JetBrains Mono',monospace",
            padding:"3px 9px",borderRadius:4,marginLeft:4}}>
          {projOpen?"▲":"▼"} Projeto
        </button>
        <div style={{flex:1}}/>
        {isGuest?(
          <span style={{fontSize:9,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.1em",
            color:T.red,background:"#e0525215",border:`1px solid ${T.red}30`,
            padding:"4px 10px",borderRadius:4,marginRight:6}}>
            👁 MODO CONVIDADO · sem gravação
          </span>
        ):(
          <>
            <span style={{fontSize:11,color:saving?T.textMid:saved?T.green:T.textMuted,
              transition:"color 0.3s",marginRight:4}}>
              {saving?"⏳ Gravando…":saved?"✓ Gravado":""}
            </span>
            {onOpenProduction&&<button onClick={onOpenProduction}
              style={{background:"none",border:`1px solid ${T.border}`,color:T.blue,cursor:"pointer",
                fontFamily:"'JetBrains Mono',monospace",fontSize:9,padding:"5px 10px",borderRadius:4}}>
              🎥 Produção
            </button>}
            {onOpenCredits&&<button onClick={onOpenCredits}
              style={{background:"none",border:`1px solid ${T.border}`,color:T.purple,cursor:"pointer",
                fontFamily:"'JetBrains Mono',monospace",fontSize:9,padding:"5px 10px",borderRadius:4}}>
              🎞 Créditos
            </button>}
            <Btn onClick={()=>save()} style={{fontSize:10,padding:"6px 14px"}}>💾 Gravar</Btn>
          </>
        )}
      </div>

      {/* ── PROJECT SETTINGS DRAWER ── */}
      {projOpen&&(
        <div style={{background:T.surface2,borderBottom:`1px solid ${T.border}`,
          padding:"16px 20px",flexShrink:0}}>
          <div style={{display:"flex",gap:14,alignItems:"flex-end",flexWrap:"wrap"}}>
            <div style={{flex:"2 1 180px"}}><Inp label="Título" value={proj.title} onChange={v=>updProj({title:v})} /></div>
            <div style={{flex:"1 1 130px"}}><Sel label="Género" value={proj.genre} onChange={v=>updProj({genre:v})} options={FILM_TYPES} /></div>
            <div style={{flex:"1 1 120px"}}><Sel label="Língua" value={proj.language} onChange={v=>updProj({language:v})} options={LANGUAGES} /></div>
            <div style={{flex:"1 1 140px"}}><Sel label="Formato" value={proj.format||"Feature Film"} onChange={v=>updProj({format:v})} options={FILM_FORMATS} /></div>
            <div style={{flex:"0 1 80px"}}><Inp label="Duração (min)" value={proj.duration} onChange={v=>updProj({duration:v})} type="number" /></div>
          </div>
        </div>
      )}

      {/* ── MAIN BODY ── */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>

        {/* ── LEFT: SCENE / TAKE TREE ── */}
        <div style={{width:215,background:T.surface,borderRight:`1px solid ${T.border}`,
          display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>
          <div style={{padding:"11px 13px",borderBottom:`1px solid ${T.border}`,
            display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:9,letterSpacing:"0.18em",color:T.textMuted,textTransform:"uppercase"}}>
              Cenas · {proj.scenes.length}
            </span>
            <button onClick={addScene}
              style={{background:"none",border:"none",color:T.accent,cursor:"pointer",
                fontSize:18,lineHeight:1,opacity:0.8}}>＋</button>
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {proj.scenes.map(scene=>{
              const isSceneSel=selScene===scene.id;
              return(
                <div key={scene.id}>
                  {/* Scene Row */}
                  <div onClick={()=>{setSelScene(scene.id);setSelTake(scene.takes[0]?.id);}}
                    style={{padding:"10px 13px",cursor:"pointer",display:"flex",
                      alignItems:"center",justifyContent:"space-between",
                      background:isSceneSel?T.accentGlow:"transparent",
                      borderLeft:`3px solid ${isSceneSel?T.accent:"transparent"}`,
                      transition:"all 0.15s"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:9,color:T.accent,letterSpacing:"0.15em",marginBottom:2}}>
                        CENA {scene.number}
                      </div>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:13,
                        color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {scene.title}
                      </div>
                      <div style={{fontSize:9,color:T.textMuted,marginTop:2}}>
                        {scene.takes.length} take{scene.takes.length!==1?"s":""}
                        {scene.location&&` · ${scene.location.slice(0,20)}`}
                      </div>
                    </div>
                    {isSceneSel&&(
                      <div style={{display:"flex",gap:2,flexShrink:0}}>
                        <button onClick={e=>{e.stopPropagation();dupScene(scene.id);}}
                          title="Duplicar cena"
                          style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",fontSize:11,padding:2}}>⎘</button>
                        {proj.scenes.length>1&&(
                          <button onClick={e=>{e.stopPropagation();delScene(scene.id);}}
                            style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:11,padding:2,opacity:0.6}}>✕</button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Takes list */}
                  {isSceneSel&&scene.takes.map(take=>{
                    const isTakeSel=selTake===take.id;
                    return(
                      <div key={take.id} onClick={()=>setSelTake(take.id)}
                        style={{padding:"6px 13px 6px 26px",cursor:"pointer",
                          display:"flex",alignItems:"center",justifyContent:"space-between",
                          background:isTakeSel?`${T.accent}0a`:"transparent",
                          transition:"all 0.15s"}}>
                        <div>
                          <span style={{fontSize:10,color:isTakeSel?T.accent:T.textMid,
                            fontWeight:isTakeSel?"600":"400"}}>
                            ▸ Take {take.number}
                          </span>
                          <div style={{fontSize:9,color:T.textMuted,marginTop:1}}>
                            {take.framing.split(" (")[0]}
                          </div>
                        </div>
                        {isTakeSel&&(
                          <div style={{display:"flex",gap:2}}>
                            <button onClick={e=>{e.stopPropagation();dupTake(scene.id,take.id);}}
                              title="Duplicar take"
                              style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",fontSize:10,padding:2}}>⎘</button>
                            {scene.takes.length>1&&(
                              <button onClick={e=>{e.stopPropagation();delTake(scene.id,take.id);}}
                                style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:10,padding:2,opacity:0.5}}>✕</button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add Take button */}
                  {isSceneSel&&(
                    <div style={{padding:"4px 26px 10px"}}>
                      <button onClick={()=>addTake(scene.id)}
                        style={{width:"100%",background:"none",
                          border:`1px dashed ${T.border}`,color:T.textMuted,
                          cursor:"pointer",fontSize:9,fontFamily:"'JetBrains Mono',monospace",
                          padding:"5px",borderRadius:4,letterSpacing:"0.1em",
                          transition:"all 0.2s"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.color=T.accent;}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.textMuted;}}>
                        + TAKE
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Stats footer */}
          <div style={{borderTop:`1px solid ${T.border}`,padding:"10px 13px",
            fontSize:9,color:T.textMuted,lineHeight:1.9}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span>CENAS</span><span style={{color:T.accent}}>{proj.scenes.length}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span>TAKES</span><span style={{color:T.accent}}>{totalTakes}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span>DURAÇÃO</span><span style={{color:T.accent}}>{totalSec}s</span>
            </div>
          </div>
        </div>

        {/* ── CENTER: TAKE EDITOR ── */}
        <div style={{flex:1,overflowY:"auto",padding:"20px 24px",display:"flex",flexDirection:"column",gap:0}}>
          {sc&&(
            <>
              {/* Scene Card */}
              <div style={{background:T.surface,border:`1px solid ${T.border}`,
                borderRadius:10,padding:20,marginBottom:16}}>
                <div style={{fontSize:10,color:T.accent,letterSpacing:"0.2em",
                  textTransform:"uppercase",marginBottom:14}}>Cena {sc.number}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:12}}>
                  <Inp label="Título da Cena" value={sc.title}
                    onChange={v=>updScene(sc.id,{title:v})} />
                  <Inp label="Cenário / Localização" value={sc.location}
                    onChange={v=>updScene(sc.id,{location:v})}
                    placeholder="Ex: INT. Apartamento" />
                  <Sel label="Momento / Luz" value={sc.timeOfDay}
                    onChange={v=>updScene(sc.id,{timeOfDay:v})} options={TIME_OF_DAY} />
                </div>
                <TA label="Descrição da Cena" value={sc.description}
                  onChange={v=>updScene(sc.id,{description:v})} rows={2}
                  placeholder="O que acontece nesta cena..." />
                <TA label="Notas de Realização" value={sc.notes||""}
                  onChange={v=>updScene(sc.id,{notes:v})} rows={1}
                  placeholder="Notas técnicas ou de direção..." />
              </div>

              {/* Take Card */}
              {tk&&(
                <div style={{background:T.surface,border:`1px solid ${T.border}`,
                  borderRadius:10,padding:20}}>
                  {/* Take header + tab bar */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    marginBottom:18,flexWrap:"wrap",gap:10}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                        <span style={{fontSize:10,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase"}}>
                          Take {tk.number}
                        </span>
                        <Tag color={T.blue}>{tk.framing.split(" (")[0]}</Tag>
                        <Tag color={T.purple}>{tk.cameraAngle}</Tag>
                        <Tag color={T.textMid}>{tk.cameraMovement}</Tag>
                      </div>
                      <div style={{fontSize:9,color:T.textMuted}}>
                        {tk.lens} · {tk.lighting} · {tk.duration}s @ {tk.fps}fps
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {TABS.map(t=>(
                        <button key={t.id} onClick={()=>setTab(t.id)}
                          style={{padding:"6px 13px",
                            background:tab===t.id?T.accentGlow:"transparent",
                            border:`1px solid ${tab===t.id?T.accent:T.border}`,
                            color:tab===t.id?T.accent:T.textMid,
                            cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
                            fontSize:10,borderRadius:5,transition:"all 0.15s"}}>
                          {t.icon} {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── TAB: CÂMARA ── */}
                  {tab==="camera"&&(
                    <div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:0}}>
                        <Sel label="Ângulo de Câmara" value={tk.cameraAngle}
                          onChange={v=>updTake(sc.id,tk.id,{cameraAngle:v})} options={CAM_ANGLES} />
                        <Sel label="Movimento de Câmara" value={tk.cameraMovement}
                          onChange={v=>updTake(sc.id,tk.id,{cameraMovement:v})} options={CAM_MOVES} />
                        <Sel label="Objetiva / Lente" value={tk.lens}
                          onChange={v=>updTake(sc.id,tk.id,{lens:v})} options={LENS_TYPES} />
                        <Sel label="Enquadramento / Plano" value={tk.framing}
                          onChange={v=>updTake(sc.id,tk.id,{framing:v})} options={FRAMINGS} />
                        <Sel label="Iluminação" value={tk.lighting||"Natural Light"}
                          onChange={v=>updTake(sc.id,tk.id,{lighting:v})} options={LIGHTING} />
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                          <Inp label="Duração (seg)" value={tk.duration}
                            onChange={v=>updTake(sc.id,tk.id,{duration:v})} type="number" />
                          <Inp label="FPS" value={tk.fps}
                            onChange={v=>updTake(sc.id,tk.id,{fps:v})} type="number" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── TAB: ÁUDIO ── */}
                  {tab==="audio"&&(
                    <div>
                      <TA label="Diálogo" value={tk.dialogue}
                        onChange={v=>updTake(sc.id,tk.id,{dialogue:v})} rows={4}
                        placeholder="Linhas de diálogo dos personagens..." />
                      <TA label="Narração / Voice Over" value={tk.narration}
                        onChange={v=>updTake(sc.id,tk.id,{narration:v})} rows={2}
                        placeholder="Narração em off..." />
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                        <TA label="Som / Efeitos Sonoros" value={tk.sound}
                          onChange={v=>updTake(sc.id,tk.id,{sound:v})} rows={3}
                          placeholder="Ambiente, SFX, Foley..." />
                        <TA label="Música" value={tk.music}
                          onChange={v=>updTake(sc.id,tk.id,{music:v})} rows={3}
                          placeholder="Tom, estilo, referência musical..." />
                      </div>
                    </div>
                  )}

                  {/* ── TAB: AÇÃO ── */}
                  {tab==="action"&&(
                    <div>
                      <Inp label="Personagens em Cena" value={tk.characters}
                        onChange={v=>updTake(sc.id,tk.id,{characters:v})}
                        placeholder="Ex: MIGUEL (30), ANA (28), Figurantes" />
                      <TA label="Ação / Descrição do Take" value={tk.action}
                        onChange={v=>updTake(sc.id,tk.id,{action:v})} rows={5}
                        placeholder="Descreve em detalhe o que acontece neste take. Movimentos dos atores, gestos, expressões, staging..." />
                      <TA label="Notas de Direção" value={tk.notes}
                        onChange={v=>updTake(sc.id,tk.id,{notes:v})} rows={2}
                        placeholder="Intenções emocionais, referências, notas técnicas..." />
                    </div>
                  )}

                  {/* ── TAB: IA PROMPTS ── */}
                  {tab==="ai"&&(
                    <div>
                      <div style={{background:T.bg,border:`1px solid ${T.border}`,
                        borderRadius:8,padding:14,marginBottom:16,
                        fontSize:10,color:T.textMid,lineHeight:1.7}}>
                        ✨ <strong style={{color:T.accent}}>IA Generativa</strong> — Gera prompts otimizados para{" "}
                        <span style={{color:T.text}}>Midjourney · DALL-E · Stable Diffusion · Sora · Runway · Pika · Kling</span>
                        <br/>com base em todos os detalhes desta cena e take.
                      </div>

                      {/* Image Prompt */}
                      <div style={{marginBottom:20}}>
                        <div style={{display:"flex",alignItems:"center",
                          justifyContent:"space-between",marginBottom:8}}>
                          <Label>🖼 Prompt de Imagem (Midjourney / DALL-E / SD)</Label>
                          <Btn variant="accent" onClick={()=>genAI("img")}
                            disabled={aiLoad.img} style={{fontSize:9,padding:"5px 12px"}}>
                            {aiLoad.img?"⏳ Gerando...":"✨ Gerar"}
                          </Btn>
                        </div>
                        <textarea value={tk.imagePrompt||""} rows={5}
                          onChange={e=>updTake(sc.id,tk.id,{imagePrompt:e.target.value})}
                          placeholder="Clica 'Gerar' para criar um prompt com IA, ou escreve manualmente..."
                          style={{...inputBase,resize:"vertical",lineHeight:1.6,
                            border:`1px solid ${tk.imagePrompt?T.accent+"40":T.border}`}} />
                        {tk.imagePrompt&&(
                          <div style={{display:"flex",gap:8,marginTop:6}}>
                            <button onClick={()=>navigator.clipboard.writeText(tk.imagePrompt)}
                              style={{background:"none",border:`1px solid ${T.border}`,
                                color:T.textMid,fontSize:9,fontFamily:"'JetBrains Mono',monospace",
                                padding:"4px 10px",borderRadius:4,cursor:"pointer"}}>
                              📋 Copiar
                            </button>
                            <button onClick={()=>updTake(sc.id,tk.id,{imagePrompt:""})}
                              style={{background:"none",border:`1px solid ${T.border}`,
                                color:T.red,fontSize:9,fontFamily:"'JetBrains Mono',monospace",
                                padding:"4px 10px",borderRadius:4,cursor:"pointer"}}>
                              ✕ Limpar
                            </button>
                          </div>
                        )}
                      </div>

                      <Divider/>

                      {/* Video Prompt */}
                      <div style={{marginBottom:16}}>
                        <div style={{display:"flex",alignItems:"center",
                          justifyContent:"space-between",marginBottom:8}}>
                          <Label>🎬 Prompt de Vídeo (Sora / Runway / Pika / Kling)</Label>
                          <Btn variant="accent" onClick={()=>genAI("vid")}
                            disabled={aiLoad.vid} style={{fontSize:9,padding:"5px 12px"}}>
                            {aiLoad.vid?"⏳ Gerando...":"✨ Gerar"}
                          </Btn>
                        </div>
                        <textarea value={tk.videoPrompt||""} rows={5}
                          onChange={e=>updTake(sc.id,tk.id,{videoPrompt:e.target.value})}
                          placeholder="Clica 'Gerar' para criar um prompt de vídeo com IA, ou escreve manualmente..."
                          style={{...inputBase,resize:"vertical",lineHeight:1.6,
                            border:`1px solid ${tk.videoPrompt?T.blue+"40":T.border}`}} />
                        {tk.videoPrompt&&(
                          <div style={{display:"flex",gap:8,marginTop:6}}>
                            <button onClick={()=>navigator.clipboard.writeText(tk.videoPrompt)}
                              style={{background:"none",border:`1px solid ${T.border}`,
                                color:T.textMid,fontSize:9,fontFamily:"'JetBrains Mono',monospace",
                                padding:"4px 10px",borderRadius:4,cursor:"pointer"}}>
                              📋 Copiar
                            </button>
                            <button onClick={()=>updTake(sc.id,tk.id,{videoPrompt:""})}
                              style={{background:"none",border:`1px solid ${T.border}`,
                                color:T.red,fontSize:9,fontFamily:"'JetBrains Mono',monospace",
                                padding:"4px 10px",borderRadius:4,cursor:"pointer"}}>
                              ✕ Limpar
                            </button>
                          </div>
                        )}
                      </div>

                      <Divider/>

                      {/* Generate Both */}
                      <div style={{textAlign:"center",paddingTop:4}}>
                        <Btn onClick={genBoth} disabled={aiLoad.img||aiLoad.vid}
                          style={{fontSize:11,padding:"10px 28px"}}>
                          {(aiLoad.img||aiLoad.vid)?"⏳ A gerar prompts...":"✨ Gerar Ambos os Prompts"}
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT: SUMMARY / METADATA ── */}
        <div style={{width:185,background:T.surface,borderLeft:`1px solid ${T.border}`,
          padding:14,overflowY:"auto",flexShrink:0,display:"flex",flexDirection:"column",gap:14}}>

          {/* Project info */}
          <div>
            <div style={{fontSize:9,letterSpacing:"0.18em",color:T.textMuted,
              textTransform:"uppercase",marginBottom:10}}>Projeto</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,
              color:T.accent,fontWeight:600,lineHeight:1.4,marginBottom:6}}>{proj.title}</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              <Tag color={T.accent}>{proj.genre}</Tag>
              <Tag color={T.textMid}>{proj.language}</Tag>
              <Tag color={T.textMuted}>{proj.format}</Tag>
            </div>
          </div>

          <Divider/>

          {/* Stats */}
          <div>
            <div style={{fontSize:9,letterSpacing:"0.18em",color:T.textMuted,
              textTransform:"uppercase",marginBottom:10}}>Estatísticas</div>
            {[
              ["Cenas",    proj.scenes.length,        T.accent],
              ["Takes",    totalTakes,                 T.accent],
              ["Total",    `${totalSec}s`,             T.blue],
              ["Duração",  `${proj.duration} min`,     T.purple],
            ].map(([k,v,c])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",
                marginBottom:7,fontSize:10}}>
                <span style={{color:T.textMuted}}>{k}</span>
                <span style={{color:c,fontWeight:600}}>{v}</span>
              </div>
            ))}
          </div>

          <Divider/>

          {/* Current take summary */}
          {sc&&tk&&(
            <div>
              <div style={{fontSize:9,letterSpacing:"0.18em",color:T.textMuted,
                textTransform:"uppercase",marginBottom:10}}>Take Atual</div>
              {[
                ["Cena",    sc.number],
                ["Take",    tk.number],
                ["Ângulo",  tk.cameraAngle.split(" ")[0]],
                ["Mov.",    tk.cameraMovement.split(" ")[0]],
                ["Plano",   tk.framing.split(" (")[0].slice(0,14)],
                ["Lente",   tk.lens.split(" ")[0]],
                ["Luz",     (tk.lighting||"Natural").split(" ")[0]],
                ["Dur.",    `${tk.duration}s / ${tk.fps}fps`],
              ].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",
                  marginBottom:6,fontSize:9}}>
                  <span style={{color:T.textMuted}}>{k}</span>
                  <span style={{color:T.text}}>{v}</span>
                </div>
              ))}
              {tk.imagePrompt&&(
                <div style={{marginTop:8}}>
                  <div style={{fontSize:9,color:T.accent,marginBottom:4}}>✓ Prompt imagem</div>
                </div>
              )}
              {tk.videoPrompt&&(
                <div>
                  <div style={{fontSize:9,color:T.blue}}>✓ Prompt vídeo</div>
                </div>
              )}
            </div>
          )}

          <Divider/>

          {/* Keyboard shortcuts */}
          <div>
            <div style={{fontSize:9,letterSpacing:"0.18em",color:T.textMuted,
              textTransform:"uppercase",marginBottom:10}}>Atalhos</div>
            {[
              ["Tabs","← → (teclado)"],
              ["Gravar","Ctrl+S"],
            ].map(([k,v])=>(
              <div key={k} style={{marginBottom:5,fontSize:8}}>
                <span style={{color:T.textMuted}}>{k}: </span>
                <span style={{color:T.textMid,fontFamily:"'JetBrains Mono',monospace"}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ─── AI SCREENPLAY GENERATOR ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function callClaude(system, user, maxTokens=4000){
  // Use /api/claude proxy in production (Vercel) to avoid CORS.
  // Fall back to direct API in the Claude artifact preview environment.
  const isArtifact = typeof window !== "undefined" &&
    (window.location.hostname === "claude.ai" ||
     window.location.hostname.includes("anthropic") ||
     window.location.hostname === "localhost" ||
     window.location.hostname === "127.0.0.1");

  const url = isArtifact
    ? "https://api.anthropic.com/v1/messages"
    : "/api/claude";

  const headers = { "Content-Type": "application/json" };
  // Direct call (artifact preview) needs the version header
  if (isArtifact) headers["anthropic-version"] = "2023-06-01";

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
  return JSON.parse(text);
}

// Progress atom
const ProgressBar = ({value,label,color=T.accent})=>(
  <div style={{marginBottom:12}}>
    {label&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,
      color:T.textMuted,letterSpacing:"0.15em",marginBottom:5,textTransform:"uppercase"}}>{label}</div>}
    <div style={{background:T.surface3,borderRadius:4,overflow:"hidden",height:6}}>
      <div style={{height:"100%",background:`linear-gradient(90deg,${color},${color}80)`,
        width:`${value}%`,transition:"width 0.5s ease",borderRadius:4}}/>
    </div>
  </div>
);

const Pulse = ({children,active})=>(
  <span style={{
    animation:active?"kanimaker-pulse 1.4s ease-in-out infinite":"none",
    display:"inline-block"
  }}>{children}</span>
);

// ─── SCREENPLAY GENERATOR SCREEN ──────────────────────────────────────────────
function ScreenplayGenerator({username,isGuest,guestProjects,setGuestProjects,onDone,onCancel}){

  // ── Ordered step metadata ─────────────────────────────────────────────────
  const STEPS = [
    {id:"idea",      icon:"💡", label:"Ideia"},
    {id:"decisions", icon:"📖", label:"Narrativa"},
    {id:"bible",     icon:"🌍", label:"Bíblia"},
    {id:"scenes",    icon:"🎬", label:"Cenas"},
    {id:"preview",   icon:"👁",  label:"Preview"},
  ];
  const STEP_IDS = STEPS.map(s=>s.id);

  const [step, setStep]         = useState("idea");
  const [loading, setLoading]   = useState(false);
  const [loadMsg, setLoadMsg]   = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError]       = useState("");

  // ── Idea params ───────────────────────────────────────────────────────────
  const [idea, setIdea]         = useState("");
  const [genre, setGenre]       = useState("Drama");
  const [language, setLanguage] = useState("Português");
  const [format, setFormat]     = useState("Feature Film");
  const [duration, setDuration] = useState(90);
  // ── Generated data ────────────────────────────────────────────────────────
  const [outline, setOutline]       = useState(null);
  const [choices, setChoices]       = useState({});
  const [bible, setBible]           = useState(null);
  const [sceneList, setSceneList]   = useState([]);
  const [fullProject, setFullProject]= useState(null);
  const [genProjectId, setGenProjectId] = useState(null);   // auto-created project ID
  const [projectTitle, setProjectTitle] = useState("");      // editable title

  // ── Snapshot keys used at generation time (for dirty detection) ───────────
  const [snapIdea, setSnapIdea]       = useState(null); // JSON.stringify({idea,genre,language,format,duration})
  const [snapChoices, setSnapChoices] = useState(null); // JSON.stringify(choices) used for bible
  const [snapBibleVer, setSnapBibleVer] = useState(0); // version counter
  const [bibleVer, setBibleVer]         = useState(0);
  const [snapScenesVer, setSnapScenesVer] = useState(0);
  const [scenesVer, setScenesVer]         = useState(0);

  // ── Dirty flags ───────────────────────────────────────────────────────────
  const currentIdeaKey = JSON.stringify({idea,genre,language,format,duration});
  const currentChoicesKey = JSON.stringify(choices);

  const outlineDirty  = outline  && snapIdea     && currentIdeaKey    !== snapIdea;
  const bibleDirty    = bible    && (outlineDirty || (snapChoices && currentChoicesKey !== snapChoices));
  const scenesDirty   = sceneList.length>0 && (bibleDirty || bibleVer !== snapBibleVer);
  const takesDirty    = fullProject && (scenesDirty || scenesVer !== snapScenesVer);

  // ── Step availability (can navigate to) ──────────────────────────────────
  const stepAvail = {
    idea:      true,
    decisions: !!outline,
    bible:     !!outline,
    scenes:    !!bible,
    preview:   !!fullProject,
  };

  const setLoad=(msg,pct)=>{ setLoadMsg(msg); if(pct!==undefined)setProgress(pct); };


  const goStep=(s)=>{ if(stepAvail[s]) setStep(s); };

  // ── GENERATE OUTLINE ──────────────────────────────────────────────────────
  const generateOutline = async()=>{
    if(!idea.trim()){setError("Escreve a tua ideia primeiro.");return;}
    setError(""); setLoading(true); setLoad("A construir a narrativa…",10);
    try{
      const sys=`You are a world-class screenwriter and story architect.
Given a story idea, generate a structured 3-act narrative outline with EXACTLY 4 decision points spread across acts 1-3.
Each decision has EXACTLY 3 options the user can choose from.
IMPORTANT: Write everything in the language: ${language}.
Respond ONLY with valid JSON in this exact structure (no markdown):
{
  "title": "string",
  "logline": "string (1-2 sentences)",
  "acts": [
    {
      "number": 1,
      "title": "string",
      "description": "string (2-3 sentences)",
      "decisions": [
        {
          "id": "d1",
          "question": "string",
          "options": [
            {"id":"d1a","label":"string (short)","consequence":"string (1 sentence of what happens next)"},
            {"id":"d1b","label":"string (short)","consequence":"string"},
            {"id":"d1c","label":"string (short)","consequence":"string"}
          ]
        }
      ]
    },
    {"number":2,"title":"string","description":"string","decisions":[{"id":"d2","question":"...","options":[...]},{"id":"d3","question":"...","options":[...]}]},
    {"number":3,"title":"string","description":"string","decisions":[{"id":"d4","question":"...","options":[...]}]}
  ]
}`;
      const data = await callClaude(sys,
        `Idea: ${idea}\nGenre: ${genre}\nFormat: ${format}\nDuration: ${duration} minutes`
      );
      setOutline(data);
      const ch={};
      data.acts.forEach(a=>a.decisions.forEach(d=>{ch[d.id]=d.options[0].id;}));
      setChoices(ch);
      setSnapIdea(currentIdeaKey);
      // Auto-create / update project
      const autoTitle = data.title||("Guião IA – "+new Date().toLocaleDateString("pt-PT"));
      setProjectTitle(autoTitle);
      const existId = genProjectId||uid();
      if(!genProjectId) setGenProjectId(existId);
      const draftProj = {
        id:existId, title:autoTitle, genre, language, format, duration,
        createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
        logline:data.logline||"", scenes:[newScene(1)],
        genDraft:{step:"decisions",outline:data,choices:ch}
      };
      if(!isGuest) await saveProject(username, draftProj).catch(()=>{});
      else { const meta={id:existId,title:autoTitle,genre,format,language,duration,
        updatedAt:draftProj.updatedAt,sceneCount:0,_full:draftProj};
        setGuestProjects(ps=>ps.filter(p=>p.id!==existId).concat(meta)); }
      setStep("decisions");
    }catch(e){setError("Erro ao gerar outline: "+e.message);}
    finally{setLoading(false);}
  };

  // ── GENERATE BIBLE ────────────────────────────────────────────────────────
  const generateBible = async()=>{
    setError(""); setLoading(true); setLoad("A criar personagens e o mundo…",20);
    try{
      const chosenPaths = outline.acts.map(a=>{
        const decs = a.decisions.map(d=>{
          const opt=d.options.find(o=>o.id===choices[d.id])||d.options[0];
          return `Decision: "${d.question}" → Chosen: "${opt.label}" → ${opt.consequence}`;
        }).join("\n");
        return `ACT ${a.number} - ${a.title}:\n${a.description}\n${decs}`;
      }).join("\n\n");

      const sys=`You are a world-class film production designer and character creator.
Create a complete story bible for a ${genre} ${format} film.
CRITICAL: Write everything in language: ${language}. Be specific and visual.
Respond ONLY with valid JSON (no markdown):
{
  "world": {
    "era": "string",
    "setting": "string",
    "atmosphere": "string",
    "colorPalette": "string (e.g. 'desaturated blues, amber highlights')",
    "visualStyle": "string (e.g. 'handheld, natural light, Fincher-esque')",
    "description": "string (3 sentences)"
  },
  "mainCharacters": [
    {
      "name": "string",
      "role": "Protagonist|Antagonist|Love Interest",
      "age": "string",
      "appearance": "string (detailed: hair, eyes, build, skin tone)",
      "costume": "string (signature outfit)",
      "personality": "string",
      "motivation": "string",
      "visualTag": "string (1 distinctive visual element)"
    }
  ],
  "secondaryCharacters": [
    {"name":"string","role":"string","age":"string","appearance":"string","costume":"string","personality":"string","motivation":"string","visualTag":"string"}
  ],
  "locations": [
    {
      "name": "string",
      "type": "main|connecting",
      "description": "string",
      "visualStyle": "string",
      "lightingMood": "string",
      "colorKey": "string"
    }
  ]
}`;
      const data = await callClaude(sys,
        `Title: ${outline.title}\nLogline: ${outline.logline}\nGenre: ${genre}\nNarrative chosen:\n${chosenPaths}`,
        4000);
      setBible(data);
      const nv = bibleVer+1;
      setBibleVer(nv);
      setSnapChoices(currentChoicesKey);
      setSnapBibleVer(nv);
      // Save draft with bible
      if(genProjectId){
        const draftUpd={id:genProjectId,title:projectTitle||outline.title,genre,language,format,duration,
          createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
          logline:outline.logline||"",scenes:[newScene(1)],
          genDraft:{step:"bible",outline,choices,bible:data}};
        if(!isGuest) await saveProject(username,draftUpd).catch(()=>{});
      }
      setStep("bible");
    }catch(e){setError("Erro ao gerar bíblia: "+e.message);}
    finally{setLoading(false);}
  };

  // ── GENERATE SCENES ───────────────────────────────────────────────────────
  const generateScenes = async()=>{
    setError(""); setLoading(true); setLoad("A estruturar as cenas…",35);
    try{
      const numScenes = Math.max(6, Math.min(18, Math.round(duration/7)));
      const chosenPaths = outline.acts.map(a=>{
        const decs = a.decisions.map(d=>{
          const opt=d.options.find(o=>o.id===choices[d.id])||d.options[0];
          return `"${opt.label}" → ${opt.consequence}`;
        }).join("; ");
        return `Act ${a.number}: ${a.title} — ${a.description} [Decisions: ${decs}]`;
      }).join("\n");

      const bibleStr=`
WORLD: ${bible.world.era}, ${bible.world.setting}. Style: ${bible.world.visualStyle}. Palette: ${bible.world.colorPalette}.
CHARACTERS: ${[...bible.mainCharacters,...(bible.secondaryCharacters||[])].map(c=>`${c.name} (${c.role}, ${c.age}, ${c.appearance}, ${c.costume})`).join("; ")}
LOCATIONS: ${bible.locations.map(l=>`${l.name} [${l.type}]: ${l.description}`).join("; ")}`.trim();

      const sys=`You are a professional screenplay writer.
Create exactly ${numScenes} scenes for this film. Each scene must:
- Use only established locations and characters from the bible
- Follow the chosen narrative path precisely
- Have 2-4 takes each (takesCount field)
- Maintain visual consistency with the world bible
Write in language: ${language}.
Respond ONLY with valid JSON (no markdown):
{
  "scenes": [
    {
      "number": 1,
      "title": "string",
      "location": "exact location name from bible",
      "timeOfDay": "one of: Dawn/Amanhecer|Morning/Manhã|Noon/Meio-dia|Golden Hour/Tarde|Dusk/Entardecer|Night/Noite|Interior Day|Interior Night",
      "description": "string (2-3 sentences of what happens)",
      "charactersPresent": ["name1","name2"],
      "emotionalBeat": "string (e.g. 'tension escalates')",
      "takesCount": 3,
      "notes": "string (director notes)"
    }
  ]
}`;
      const data = await callClaude(sys,
        `Title: ${outline.title}\nNarrative:\n${chosenPaths}\n\nBIBLE:\n${bibleStr}`,
        4000);
      setSceneList(data.scenes||[]);
      const nv = scenesVer+1;
      setScenesVer(nv);
      setSnapScenesVer(nv);
      setSnapBibleVer(bibleVer);
      // Save draft with scenes
      if(genProjectId){
        const draftUpd={id:genProjectId,title:projectTitle||outline.title,genre,language,format,duration,
          createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
          logline:outline.logline||"",scenes:[newScene(1)],
          genDraft:{step:"scenes",outline,choices,bible,sceneList:data.scenes||[]}};
        if(!isGuest) await saveProject(username,draftUpd).catch(()=>{});
      }
      setStep("scenes");
    }catch(e){setError("Erro ao gerar cenas: "+e.message);}
    finally{setLoading(false);}
  };

  // ── GENERATE TAKES ────────────────────────────────────────────────────────
  const generateTakes = async()=>{
    setError(""); setLoading(true);
    setLoad("A gerar takes e prompts para todas as cenas…",40);

    const bibleStr=`
WORLD: ${bible.world.era}, ${bible.world.setting}. Visual style: ${bible.world.visualStyle}. Color palette: ${bible.world.colorPalette}. Atmosphere: ${bible.world.atmosphere}.
MAIN CHARACTERS: ${bible.mainCharacters.map(c=>`${c.name}: ${c.appearance}. Costume: ${c.costume}. Visual tag: ${c.visualTag||""}`).join(" | ")}
SECONDARY: ${(bible.secondaryCharacters||[]).map(c=>`${c.name}: ${c.appearance}`).join(" | ")}
LOCATIONS: ${bible.locations.map(l=>`${l.name}: ${l.description}. Lighting: ${l.lightingMood}. Color: ${l.colorKey}`).join(" | ")}`.trim();

    const allScenes=[];
    for(let i=0;i<sceneList.length;i++){
      const scene=sceneList[i];
      const pct=40+Math.round((i/sceneList.length)*55);
      setLoad(`A gerar cena ${i+1}/${sceneList.length}: "${scene.title}"…`,pct);
      try{
        const sys=`You are a master cinematographer and screenwriter.
For this scene, generate exactly ${scene.takesCount||3} takes.
CRITICAL CONSISTENCY RULES:
- Characters MUST always be described exactly as in the bible (same appearance, same costume)
- Locations MUST match the bible's visual style and color key
- Camera choices must feel cohesive with the world's visual style
- Image and video prompts must reference character descriptions from the bible for AI consistency
Write in language: ${language}. For prompts always write in English.
Respond ONLY with valid JSON (no markdown):
{
  "takes": [
    {
      "number": 1,
      "framing": "one of the standard framings",
      "cameraAngle": "one of the standard angles",
      "cameraMovement": "one of the standard movements",
      "lens": "one of the standard lenses",
      "lighting": "one of the standard lighting types",
      "action": "string",
      "dialogue": "string",
      "narration": "string",
      "sound": "string",
      "music": "string",
      "duration": 6,
      "fps": 24,
      "imagePrompt": "string (detailed English prompt for Midjourney/DALL-E with exact character descriptions)",
      "videoPrompt": "string (detailed English prompt for Sora/Runway with camera movement and pacing)",
      "notes": "string"
    }
  ]
}`;
        const data = await callClaude(sys,
          `FILM: "${outline.title}" | Genre: ${genre} | Language: ${language}
BIBLE:\n${bibleStr}
SCENE ${scene.number}: "${scene.title}"
Location: ${scene.location}
Time: ${scene.timeOfDay}
Description: ${scene.description}
Characters present: ${scene.charactersPresent.join(", ")}
Emotional beat: ${scene.emotionalBeat}
Director notes: ${scene.notes||""}`,
          3000);

        allScenes.push({
          id:uid(), number:scene.number, title:scene.title,
          location:scene.location, timeOfDay:scene.timeOfDay,
          description:scene.description, notes:scene.notes||"",
          takes:(data.takes||[]).map((t,idx)=>({
            id:uid(), number:t.number||idx+1,
            cameraAngle:t.cameraAngle||"Eye Level",
            cameraMovement:t.cameraMovement||"Static",
            lens:t.lens||"Normal (35-50mm)",
            framing:t.framing||"Medium Shot",
            lighting:t.lighting||"Natural Light",
            characters:scene.charactersPresent.join(", "),
            action:t.action||"", dialogue:t.dialogue||"",
            narration:t.narration||"", sound:t.sound||"",
            music:t.music||"", duration:t.duration||6, fps:t.fps||24,
            imagePrompt:t.imagePrompt||"", videoPrompt:t.videoPrompt||"",
            notes:t.notes||""
          }))
        });
      }catch(e){
        console.warn(`Scene ${i+1} error:`,e);
        allScenes.push({
          id:uid(), number:scene.number, title:scene.title,
          location:scene.location, timeOfDay:scene.timeOfDay,
          description:scene.description, notes:scene.notes||"",
          takes:[newTake(1)]
        });
      }
    }

    const pid = genProjectId||uid();
    const proj={
      id:pid, title:projectTitle||outline.title, genre, language, format, duration,
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
      bible, logline:outline.logline, scenes:allScenes, _genStep:"complete"
    };
    setFullProject(proj);
    setSnapScenesVer(scenesVer);
    // Save complete project
    if(!isGuest){ await saveProject(username,proj); }
    else {
      const meta={id:pid,title:proj.title,genre,format,language,duration,
        updatedAt:proj.updatedAt,sceneCount:allScenes.length,_full:proj};
      setGuestProjects(ps=>ps.filter(p=>p.id!==pid).concat(meta));
    }
    setLoad("Guião completo!",100);
    setStep("preview");
    setLoading(false);
  };

  // ── IMPORT ────────────────────────────────────────────────────────────────
  const importProject=async()=>{
    if(!fullProject)return;
    // Project was already saved during generateTakes — just open it
    onDone(fullProject.id);
  };

  // ── DIRTY BANNER ─────────────────────────────────────────────────────────
  const DirtyBanner = ({message, onRegen, regenLabel})=>(
    <div style={{background:"#1a0f00",border:`1px solid ${T.accent}60`,borderRadius:8,
      padding:"12px 16px",marginBottom:20,
      display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
      <span style={{fontSize:16}}>⚠️</span>
      <div style={{flex:1,fontSize:10,color:T.accent,lineHeight:1.6,
        fontFamily:"'JetBrains Mono',monospace"}}>{message}</div>
      <Btn variant="accent" onClick={onRegen}
        style={{fontSize:10,padding:"6px 14px",whiteSpace:"nowrap"}}>
        🔄 {regenLabel}
      </Btn>
    </div>
  );

  // ── STEP NAVIGATOR (top pills, clickable) ─────────────────────────────────
  const stepIdx = STEP_IDS.indexOf(step);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",
      fontFamily:"'JetBrains Mono',monospace",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=JetBrains+Mono:wght@300;400;500;600&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:${T.bg}}
        ::-webkit-scrollbar-thumb{background:${T.surface3};border-radius:3px}
        select option{background:${T.surface}}
        input::placeholder,textarea::placeholder{color:${T.textMuted};opacity:1}
        @keyframes kanimaker-pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes gen-spin{to{transform:rotate(360deg)}}
        @keyframes gen-fadein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .gen-card{animation:gen-fadein 0.35s ease forwards}
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{height:54,background:T.surface,borderBottom:`1px solid ${T.border}`,
        display:"flex",alignItems:"center",padding:"0 20px",gap:14,flexShrink:0,flexWrap:"wrap"}}>
        <button onClick={onCancel}
          style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",
            fontSize:20,lineHeight:1,padding:"4px 6px",flexShrink:0}}>‹</button>
        <span style={{fontSize:17,flexShrink:0}}>✨</span>
        <span style={{fontFamily:"'Playfair Display',serif",color:T.accent,fontSize:14,
          fontWeight:700,letterSpacing:"0.06em",flexShrink:0}}>
          K-ANIMAKERPROSTUDIO2026 · Gerador de Guião IA
        </span>
        {outline&&(
          <input value={projectTitle||outline.title}
            onChange={e=>setProjectTitle(e.target.value)}
            style={{background:"transparent",border:"none",borderBottom:`1px solid ${T.border}`,
              color:T.text,fontFamily:"'Playfair Display',serif",fontSize:13,fontStyle:"italic",
              outline:"none",padding:"2px 6px",maxWidth:240,color:T.textMid}}
            title="Clica para editar o título do projeto"/>
        )}
        {genProjectId&&!isGuest&&(
          <span style={{fontSize:8,color:T.green,background:`${T.green}15`,
            border:`1px solid ${T.green}30`,padding:"2px 8px",borderRadius:3,letterSpacing:"0.1em"}}>
            💾 AUTO-GUARDADO
          </span>
        )}
        <div style={{flex:1}}/>
        {/* Clickable step pills */}
        <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
          {STEPS.map((s,i)=>{
            const avail = stepAvail[s.id];
            const isCurrent = s.id===step;
            const isDone = STEP_IDS.indexOf(s.id) < stepIdx;
            const isStale = (s.id==="decisions"&&outlineDirty) ||
                            (s.id==="bible"&&bibleDirty) ||
                            (s.id==="scenes"&&scenesDirty) ||
                            (s.id==="preview"&&takesDirty);
            return(
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:3}}>
                {i>0&&<div style={{width:12,height:1,background:T.border,flexShrink:0}}/>}
                <button onClick={()=>goStep(s.id)} disabled={!avail}
                  style={{
                    display:"flex",alignItems:"center",gap:5,
                    padding:"5px 10px",borderRadius:16,border:"1px solid",
                    cursor:avail?"pointer":"default",
                    fontFamily:"'JetBrains Mono',monospace",fontSize:9,
                    letterSpacing:"0.1em",transition:"all 0.15s",
                    borderColor:isCurrent?T.accent:isStale?"#e8b84b80":isDone?T.green:T.border,
                    background:isCurrent?T.accentGlow:isStale?"#1a110020":isDone?"#52b78810":"transparent",
                    color:isCurrent?T.accent:isStale?T.accent:isDone?T.green:avail?T.textMid:T.textMuted,
                    opacity:avail?1:0.38,
                  }}>
                  <span>{isDone&&!isStale?"✓":s.icon}</span>
                  <span>{s.label}</span>
                  {isStale&&<span style={{color:T.red,fontSize:8}}>⚠</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── LOADING OVERLAY ── */}
      {loading&&(
        <div style={{position:"fixed",inset:0,background:"#07070fcc",zIndex:100,
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:24}}>
          <div style={{width:64,height:64,borderRadius:"50%",
            border:`3px solid ${T.border}`,borderTopColor:T.accent,
            animation:"gen-spin 1s linear infinite"}}/>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:T.accent,textAlign:"center",
            maxWidth:500,textAlign:"center",lineHeight:1.4}}>
            {loadMsg||"A processar…"}
          </div>
          <div style={{width:360}}>
            <ProgressBar value={progress} color={T.accent}/>
          </div>
          <div style={{fontSize:9,color:T.textMuted,letterSpacing:"0.2em"}}>
            K-ANIMAKERPROSTUDIO2026 IA · A CRIAR O SEU GUIÃO
          </div>
        </div>
      )}

      {/* ── CONTENT ── */}
      <div style={{flex:1,overflowY:"auto",padding:"32px 40px",
        maxWidth:940,margin:"0 auto",width:"100%"}}>

        {error&&(
          <div style={{background:"#e0525215",border:`1px solid ${T.red}40`,borderRadius:8,
            padding:"12px 16px",marginBottom:20,color:T.red,fontSize:11,lineHeight:1.6}}>
            ⚠ {error}
            <button onClick={()=>setError("")}
              style={{marginLeft:12,background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:12}}>✕</button>
          </div>
        )}

        {/* ════════════════════════════════════ STEP: IDEA ═══════════════════════ */}
        {step==="idea"&&(
          <div className="gen-card">
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:34,color:T.text,
              fontWeight:900,marginBottom:6,lineHeight:1.2}}>
              Qual é a tua <span style={{color:T.accent}}>história?</span>
            </div>
            <div style={{color:T.textMid,fontSize:11,marginBottom:32,letterSpacing:"0.04em"}}>
              Descreve a ideia — pode ser uma frase ou vários parágrafos. A IA transforma-a num guião completo.
            </div>

            {/* If outline exists, show that we can go back to it */}
            {outline&&!outlineDirty&&(
              <div style={{background:`${T.green}10`,border:`1px solid ${T.green}30`,
                borderRadius:8,padding:"10px 14px",marginBottom:18,
                display:"flex",alignItems:"center",gap:10,fontSize:10,color:T.green}}>
                <span>✓</span>
                <span>Narrativa "{outline.title}" já gerada.</span>
                <button onClick={()=>setStep("decisions")}
                  style={{marginLeft:"auto",background:"none",border:`1px solid ${T.green}`,
                    color:T.green,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
                    fontSize:9,padding:"3px 10px",borderRadius:4}}>
                  Ver Narrativa →
                </button>
              </div>
            )}

            {outlineDirty&&(
              <div style={{background:"#1a0f00",border:`1px solid ${T.accent}50`,
                borderRadius:8,padding:"10px 14px",marginBottom:18,
                fontSize:10,color:T.accent,lineHeight:1.6}}>
                ⚠ Os parâmetros mudaram desde a última geração. Regenera a narrativa para continuar.
              </div>
            )}

            {/* Project title + status */}
            <div style={{display:"grid",gridTemplateColumns:"2fr auto",gap:12,marginBottom:18,
              background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:16,alignItems:"end"}}>
              <div>
                <Label>🎬 Título do Projeto <span style={{color:T.red}}>*</span></Label>
                <input value={projectTitle} onChange={e=>setProjectTitle(e.target.value)}
                  placeholder="O nome do teu filme…"
                  style={{...inputBase,fontSize:14,border:`1px solid ${projectTitle?T.accent+"60":T.border}`,
                    fontFamily:"'Playfair Display',serif"}}/>
              </div>
              {genProjectId&&(
                <div style={{paddingBottom:1}}>
                  <div style={{fontSize:8,color:T.green,letterSpacing:"0.12em",marginBottom:4}}>✓ PROJETO CRIADO</div>
                  <div style={{fontSize:9,color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>
                    ID: {genProjectId.slice(-8)}
                  </div>
                </div>
              )}
            </div>

            <div style={{marginBottom:20}}>
              <Label>💡 A tua ideia</Label>
              <textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={6}
                placeholder="Ex: Um detective aposentado em Lisboa dos anos 40 recebe uma carta do seu antigo parceiro morto há 10 anos..."
                style={{...inputBase,resize:"vertical",lineHeight:1.8,fontSize:13,
                  border:`1px solid ${idea?T.accent+"50":T.border}`}}/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 90px",gap:14,marginBottom:28}}>
              <Sel label="Género" value={genre} onChange={setGenre} options={FILM_TYPES}/>
              <Sel label="Língua" value={language} onChange={setLanguage} options={LANGUAGES}/>
              <Sel label="Formato" value={format} onChange={setFormat} options={FILM_FORMATS}/>
              <Inp label="Duração (min)" value={duration} onChange={setDuration} type="number"/>
              <div/>
            </div>

            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,
              padding:"14px 18px",marginBottom:24,fontSize:10,color:T.textMid,lineHeight:1.9}}>
              🤖 A IA vai gerar:<br/>
              <span style={{color:T.text}}>① Estrutura 3 atos com 4 pontos de decisão narrativa</span><br/>
              <span style={{color:T.text}}>② Bíblia: personagens, cenários, paleta e estilo visual</span><br/>
              <span style={{color:T.text}}>③ Lista de cenas completa com realização</span><br/>
              <span style={{color:T.text}}>④ Takes com prompts de imagem e vídeo consistentes</span>
            </div>

            <Btn onClick={generateOutline} disabled={!idea.trim()||loading}
              style={{fontSize:13,padding:"14px 32px",letterSpacing:"0.06em"}}>
              {outline&&!outlineDirty?"🔄 Regenerar Narrativa":"✨ Gerar Narrativa"}
            </Btn>
          </div>
        )}

        {/* ════════════════════════════════ STEP: DECISIONS ══════════════════════ */}
        {step==="decisions"&&outline&&(
          <div className="gen-card">
            {outlineDirty&&(
              <DirtyBanner
                message={`Os parâmetros da ideia mudaram. A narrativa atual pode não corresponder às tuas alterações.`}
                onRegen={generateOutline}
                regenLabel="Regenerar Narrativa"
              />
            )}

            <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,color:T.text,fontWeight:700,marginBottom:4}}>
              {outline.title}
            </div>
            <div style={{color:T.accent,fontSize:12,marginBottom:28,fontStyle:"italic",lineHeight:1.6}}>
              "{outline.logline}"
            </div>

            {outline.acts.map((act)=>(
              <div key={act.number} style={{marginBottom:32}}>
                <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12}}>
                  <div style={{width:32,height:32,borderRadius:"50%",flexShrink:0,
                    background:`linear-gradient(135deg,${T.accent},${T.purple})`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:13,fontWeight:700,color:"#000"}}>
                    {act.number}
                  </div>
                  <div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:T.text,fontWeight:600}}>
                      Ato {act.number} — {act.title}
                    </div>
                    <div style={{fontSize:10,color:T.textMid,marginTop:2,lineHeight:1.5}}>{act.description}</div>
                  </div>
                </div>

                {act.decisions.map(dec=>{
                  const sel=choices[dec.id]||dec.options[0].id;
                  return(
                    <div key={dec.id} style={{marginLeft:46,marginBottom:16,
                      background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:18}}>
                      <div style={{fontSize:9,color:T.accent,letterSpacing:"0.15em",
                        textTransform:"uppercase",marginBottom:10}}>🎭 Decisão Narrativa</div>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,
                        color:T.text,marginBottom:14,fontWeight:600}}>{dec.question}</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {dec.options.map(opt=>{
                          const isSel=sel===opt.id;
                          return(
                            <div key={opt.id}
                              onClick={()=>setChoices(c=>({...c,[dec.id]:opt.id}))}
                              style={{padding:"12px 16px",borderRadius:7,cursor:"pointer",
                                border:`1px solid ${isSel?T.accent:T.border}`,
                                background:isSel?T.accentGlow:T.bg,transition:"all 0.18s"}}>
                              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                                <div style={{width:18,height:18,borderRadius:"50%",flexShrink:0,marginTop:1,
                                  border:`2px solid ${isSel?T.accent:T.border}`,
                                  background:isSel?T.accent:"transparent",
                                  display:"flex",alignItems:"center",justifyContent:"center"}}>
                                  {isSel&&<div style={{width:6,height:6,borderRadius:"50%",background:"#000"}}/>}
                                </div>
                                <div>
                                  <div style={{fontSize:12,color:isSel?T.accent:T.text,
                                    fontWeight:isSel?"600":"400",marginBottom:4}}>{opt.label}</div>
                                  <div style={{fontSize:10,color:T.textMid,lineHeight:1.5}}>→ {opt.consequence}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Narrative summary */}
            <div style={{background:`${T.accent}08`,border:`1px solid ${T.accent}30`,
              borderRadius:10,padding:18,marginBottom:28}}>
              <div style={{fontSize:9,color:T.accent,letterSpacing:"0.18em",
                textTransform:"uppercase",marginBottom:10}}>Narrativa Escolhida</div>
              {outline.acts.map(act=>
                act.decisions.map(dec=>{
                  const opt=dec.options.find(o=>o.id===(choices[dec.id]||dec.options[0].id));
                  return(
                    <div key={dec.id} style={{display:"flex",gap:8,marginBottom:6,fontSize:10}}>
                      <span style={{color:T.textMuted,minWidth:70}}>Ato {act.number}:</span>
                      <span style={{color:T.accent,fontWeight:600}}>{opt?.label}</span>
                      <span style={{color:T.textMuted,fontSize:9}}>→ {opt?.consequence?.slice(0,80)}{opt?.consequence?.length>80?"…":""}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Dirty bible banner */}
            {bibleDirty&&(
              <DirtyBanner
                message="As decisões mudaram desde a última bíblia gerada. Regenera a bíblia para manter a consistência."
                onRegen={generateBible}
                regenLabel="Regenerar Bíblia"
              />
            )}

            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <Btn onClick={generateBible} disabled={loading}
                style={{fontSize:12,padding:"12px 24px"}}>
                {bible&&!bibleDirty?"🌍 Ver Bíblia →":"🌍 Criar Bíblia de Mundo"}
              </Btn>
              {bible&&!bibleDirty&&(
                <Btn variant="secondary" onClick={()=>setStep("bible")}
                  style={{fontSize:12,padding:"12px 24px"}}>
                  Ver Bíblia existente →
                </Btn>
              )}
              <Btn variant="ghost" onClick={()=>setStep("idea")} style={{fontSize:11}}>← Editar Ideia</Btn>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════ STEP: BIBLE ══════════════════════ */}
        {step==="bible"&&bible&&(
          <div className="gen-card">
            {bibleDirty&&(
              <DirtyBanner
                message="As decisões narrativas mudaram desde esta bíblia. Regenera para manter consistência com a narrativa actual."
                onRegen={generateBible}
                regenLabel="Regenerar Bíblia"
              />
            )}

            <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,color:T.text,fontWeight:700,marginBottom:6}}>
              Bíblia de <span style={{color:T.accent}}>Mundo</span>
            </div>
            <div style={{color:T.textMid,fontSize:11,marginBottom:28}}>
              Personagens, cenários e paleta visual — mantidos consistentes em todas as cenas e takes.
            </div>

            {/* World */}
            <div style={{background:`linear-gradient(135deg,${T.surface2},${T.surface3})`,
              border:`1px solid ${T.accent}40`,borderRadius:12,padding:22,marginBottom:24}}>
              <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:14}}>🌍 O MUNDO</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                {[["Época",bible.world.era],["Cenário",bible.world.setting],
                  ["Atmosfera",bible.world.atmosphere],["Paleta Visual",bible.world.colorPalette],
                  ["Estilo Visual",bible.world.visualStyle]].map(([k,v])=>(
                  <div key={k}>
                    <div style={{fontSize:8,color:T.textMuted,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:3}}>{k}</div>
                    <div style={{fontSize:11,color:T.text,lineHeight:1.5}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
                <div style={{fontSize:8,color:T.textMuted,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Descrição</div>
                <div style={{fontSize:11,color:T.textMid,lineHeight:1.7}}>{bible.world.description}</div>
              </div>
            </div>

            {/* Main characters */}
            <div style={{marginBottom:24}}>
              <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:14}}>👤 PERSONAGENS PRINCIPAIS</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
                {bible.mainCharacters.map((c,i)=>(
                  <div key={i} style={{background:T.surface,border:`1px solid ${T.border}`,
                    borderRadius:10,padding:16,borderLeft:`3px solid ${[T.accent,T.blue,T.red][i%3]}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,color:T.text,fontWeight:700}}>{c.name}</div>
                      <Tag color={[T.accent,T.blue,T.red][i%3]}>{c.role}</Tag>
                    </div>
                    {[["Idade",c.age],["Aparência",c.appearance],["Vestuário",c.costume],
                      ["Personalidade",c.personality],["Motivação",c.motivation],["Elemento Visual",c.visualTag]
                    ].map(([k,v])=>v&&(
                      <div key={k} style={{marginBottom:5}}>
                        <span style={{fontSize:8,color:T.textMuted,letterSpacing:"0.12em",textTransform:"uppercase"}}>{k}: </span>
                        <span style={{fontSize:10,color:T.textMid}}>{v}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Secondary */}
            {(bible.secondaryCharacters||[]).length>0&&(
              <div style={{marginBottom:24}}>
                <div style={{fontSize:9,color:T.purple,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:12}}>👥 PERSONAGENS SECUNDÁRIAS</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                  {bible.secondaryCharacters.map((c,i)=>(
                    <div key={i} style={{background:T.surface,border:`1px solid ${T.border}`,
                      borderRadius:8,padding:14,borderLeft:`3px solid ${T.purple}`}}>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,color:T.text,fontWeight:600,marginBottom:6}}>{c.name}</div>
                      {[["Aparência",c.appearance],["Vestuário",c.costume]].map(([k,v])=>v&&(
                        <div key={k} style={{marginBottom:4}}>
                          <span style={{fontSize:8,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em"}}>{k}: </span>
                          <span style={{fontSize:10,color:T.textMid}}>{v}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Locations */}
            <div style={{marginBottom:28}}>
              <div style={{fontSize:9,color:T.green,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:12}}>📍 CENÁRIOS</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                {bible.locations.map((l,i)=>(
                  <div key={i} style={{background:T.surface,border:`1px solid ${T.border}`,
                    borderRadius:8,padding:14,borderLeft:`3px solid ${l.type==="main"?T.green:T.textMid}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,color:T.text,fontWeight:600}}>{l.name}</div>
                      <Tag color={l.type==="main"?T.green:T.textMid}>{l.type}</Tag>
                    </div>
                    {[["Descrição",l.description],["Luz",l.lightingMood],["Cor",l.colorKey],["Estilo",l.visualStyle]].map(([k,v])=>v&&(
                      <div key={k} style={{marginBottom:4}}>
                        <span style={{fontSize:8,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em"}}>{k}: </span>
                        <span style={{fontSize:10,color:T.textMid}}>{v}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Dirty scenes banner */}
            {scenesDirty&&(
              <DirtyBanner
                message="A bíblia foi alterada desde a geração das cenas. As cenas existentes podem ser inconsistentes."
                onRegen={generateScenes}
                regenLabel="Regenerar Cenas"
              />
            )}

            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <Btn onClick={generateScenes} disabled={loading}
                style={{fontSize:12,padding:"12px 24px"}}>
                {sceneList.length>0&&!scenesDirty?"🎬 Ver Cenas →":"🎬 Gerar Lista de Cenas"}
              </Btn>
              {sceneList.length>0&&!scenesDirty&&(
                <Btn variant="secondary" onClick={()=>setStep("scenes")}
                  style={{fontSize:12,padding:"12px 24px"}}>
                  Ver Cenas existentes →
                </Btn>
              )}
              <Btn variant="ghost" onClick={()=>setStep("decisions")} style={{fontSize:11}}>← Narrativa</Btn>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════ STEP: SCENES ═════════════════════ */}
        {step==="scenes"&&sceneList.length>0&&(
          <div className="gen-card">
            {scenesDirty&&(
              <DirtyBanner
                message="A bíblia de mundo mudou desde a geração destas cenas. As cenas podem não ser consistentes com o estado actual."
                onRegen={generateScenes}
                regenLabel="Regenerar Cenas"
              />
            )}

            <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,color:T.text,fontWeight:700,marginBottom:6}}>
              {sceneList.length} Cenas <span style={{color:T.accent}}>Geradas</span>
            </div>
            <div style={{color:T.textMid,fontSize:11,marginBottom:24}}>
              Revê a estrutura. A seguir serão gerados os takes e prompts IA para cada cena.
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:28}}>
              {sceneList.map((sc,i)=>(
                <div key={i} style={{background:T.surface,border:`1px solid ${T.border}`,
                  borderRadius:8,padding:"13px 16px",display:"flex",gap:14,alignItems:"flex-start"}}>
                  <div style={{width:30,height:30,borderRadius:6,background:T.surface3,
                    border:`1px solid ${T.border}`,display:"flex",alignItems:"center",
                    justifyContent:"center",flexShrink:0,fontSize:11,color:T.accent,fontWeight:700}}>
                    {sc.number}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,color:T.text,fontWeight:600}}>{sc.title}</div>
                      <Tag color={T.textMid}>{sc.location}</Tag>
                      <Tag color={T.textMuted}>{sc.timeOfDay}</Tag>
                      <Tag color={T.blue}>{sc.takesCount} takes</Tag>
                    </div>
                    <div style={{fontSize:10,color:T.textMid,lineHeight:1.5,marginBottom:3}}>{sc.description}</div>
                    <div style={{fontSize:9,color:T.textMuted}}>🎭 {sc.charactersPresent.join(", ")} · {sc.emotionalBeat}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,
              padding:16,marginBottom:20,display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
              {[["Cenas",sceneList.length,T.accent],
                ["Takes totais",sceneList.reduce((a,s)=>a+s.takesCount,0),T.blue],
                ["Duração est.",`~${duration}min`,T.purple],
                ["Prompts IA",sceneList.reduce((a,s)=>a+s.takesCount,0)*2,T.green]
              ].map(([k,v,c])=>(
                <div key={k} style={{textAlign:"center"}}>
                  <div style={{fontSize:20,color:c,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{v}</div>
                  <div style={{fontSize:9,color:T.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginTop:2}}>{k}</div>
                </div>
              ))}
            </div>

            <div style={{background:"#1a1200",border:`1px solid ${T.accent}30`,borderRadius:8,
              padding:"11px 15px",marginBottom:22,fontSize:10,color:T.textMid}}>
              ⏱ A geração de takes e prompts processa cada cena individualmente. Pode demorar alguns minutos.
            </div>

            {/* Dirty takes banner */}
            {takesDirty&&(
              <DirtyBanner
                message="As cenas mudaram desde a geração dos takes. O guião final pode estar desactualizado."
                onRegen={generateTakes}
                regenLabel="Regenerar Takes"
              />
            )}

            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <Btn onClick={generateTakes} disabled={loading}
                style={{fontSize:12,padding:"12px 24px"}}>
                {fullProject&&!takesDirty?"👁 Ver Preview →":"✨ Gerar Takes & Prompts IA"}
              </Btn>
              {fullProject&&!takesDirty&&(
                <Btn variant="secondary" onClick={()=>setStep("preview")}
                  style={{fontSize:12,padding:"12px 24px"}}>
                  Ver Preview existente →
                </Btn>
              )}
              <Btn variant="ghost" onClick={()=>setStep("bible")} style={{fontSize:11}}>← Bíblia</Btn>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════ STEP: PREVIEW ════════════════════ */}
        {step==="preview"&&fullProject&&(
          <div className="gen-card">
            {takesDirty&&(
              <DirtyBanner
                message="As cenas mudaram desde a geração deste guião. Regenera os takes para um guião actualizado."
                onRegen={generateTakes}
                regenLabel="Regenerar Guião"
              />
            )}

            <div style={{fontFamily:"'Playfair Display',serif",fontSize:32,color:T.accent,
              fontWeight:900,marginBottom:4}}>✦ {fullProject.title}</div>
            <div style={{color:T.textMid,fontSize:12,fontStyle:"italic",marginBottom:28,lineHeight:1.6}}>
              "{fullProject.logline}"
            </div>

            {/* Stats grid */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:28}}>
              {[["🎬","Cenas",fullProject.scenes.length,T.accent],
                ["🎭","Takes",fullProject.scenes.reduce((a,s)=>a+s.takes.length,0),T.blue],
                ["🖼","Prompts Img",fullProject.scenes.reduce((a,s)=>a+s.takes.filter(t=>t.imagePrompt).length,0),T.purple],
                ["🎥","Prompts Vídeo",fullProject.scenes.reduce((a,s)=>a+s.takes.filter(t=>t.videoPrompt).length,0),T.green],
                ["⏱","Duração",`${fullProject.duration}min`,T.textMid]
              ].map(([ico,k,v,c])=>(
                <div key={k} style={{background:T.surface,border:`1px solid ${T.border}`,
                  borderRadius:10,padding:16,textAlign:"center"}}>
                  <div style={{fontSize:20,marginBottom:4}}>{ico}</div>
                  <div style={{fontSize:18,color:c,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>{v}</div>
                  <div style={{fontSize:9,color:T.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginTop:2}}>{k}</div>
                </div>
              ))}
            </div>

            {/* World summary */}
            {fullProject.bible&&(
              <div style={{background:T.surface,border:`1px solid ${T.accent}30`,borderRadius:10,
                padding:18,marginBottom:20}}>
                <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:12}}>Bíblia de Mundo</div>
                <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:8}}>
                  {fullProject.bible.mainCharacters.map((c,i)=>(
                    <span key={i} style={{fontSize:10}}>
                      <span style={{color:T.accent,fontWeight:600}}>{c.name}</span>
                      <span style={{color:T.textMuted}}> · {c.role}</span>
                    </span>
                  ))}
                  {(fullProject.bible.secondaryCharacters||[]).map((c,i)=>(
                    <span key={i} style={{fontSize:10,color:T.purple}}>{c.name}</span>
                  ))}
                </div>
                <div style={{fontSize:10,color:T.textMuted,lineHeight:1.6}}>
                  {fullProject.bible.world.era} · {fullProject.bible.world.setting} · {fullProject.bible.world.colorPalette}
                </div>
              </div>
            )}

            {/* Scene list */}
            <div style={{marginBottom:28}}>
              <div style={{fontSize:9,color:T.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:12}}>Estrutura de Cenas</div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {fullProject.scenes.map((sc,i)=>(
                  <div key={i} style={{background:T.surface,border:`1px solid ${T.border}`,
                    borderRadius:7,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:10,color:T.accent,fontWeight:600,minWidth:24}}>{sc.number}</span>
                    <span style={{fontFamily:"'Playfair Display',serif",fontSize:13,color:T.text,flex:1}}>{sc.title}</span>
                    <Tag color={T.textMuted}>{sc.location}</Tag>
                    <span style={{fontSize:10,color:T.blue}}>{sc.takes.length} takes</span>
                    {sc.takes.some(t=>t.imagePrompt)&&<span style={{fontSize:10,color:T.purple}}>✦ prompts</span>}
                  </div>
                ))}
              </div>
            </div>

            <div style={{background:`${T.green}10`,border:`1px solid ${T.green}30`,borderRadius:8,
              padding:"14px 18px",marginBottom:24,fontSize:11,color:T.green,lineHeight:1.7}}>
              ✓ Guião completo com consistência total de personagens e cenários. Pronto para importar.
            </div>

            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <Btn onClick={importProject} style={{fontSize:13,padding:"14px 32px",letterSpacing:"0.06em"}}>
                🎬 Importar para o Studio
              </Btn>
              <Btn variant="secondary" onClick={()=>setStep("scenes")} style={{fontSize:11}}>← Rever Cenas</Btn>
              <Btn variant="ghost" onClick={()=>setStep("bible")} style={{fontSize:11}}>← Bíblia</Btn>
            </div>
          </div>
        )}

        {/* Empty state when step has no data yet */}
        {step==="decisions"&&!outline&&(
          <div style={{textAlign:"center",padding:"80px 0"}}>
            <div style={{fontSize:48,marginBottom:20,opacity:0.3}}>📖</div>
            <div style={{color:T.textMid,fontSize:13,marginBottom:8}}>Narrativa ainda não gerada.</div>
            <Btn onClick={()=>setStep("idea")} style={{fontSize:11,padding:"10px 20px"}}>← Voltar à Ideia</Btn>
          </div>
        )}
        {step==="bible"&&!bible&&(
          <div style={{textAlign:"center",padding:"80px 0"}}>
            <div style={{fontSize:48,marginBottom:20,opacity:0.3}}>🌍</div>
            <div style={{color:T.textMid,fontSize:13,marginBottom:8}}>Bíblia ainda não gerada.</div>
            <Btn onClick={()=>setStep("decisions")} style={{fontSize:11,padding:"10px 20px"}}>← Voltar à Narrativa</Btn>
          </div>
        )}
        {step==="scenes"&&sceneList.length===0&&(
          <div style={{textAlign:"center",padding:"80px 0"}}>
            <div style={{fontSize:48,marginBottom:20,opacity:0.3}}>🎬</div>
            <div style={{color:T.textMid,fontSize:13,marginBottom:8}}>Cenas ainda não geradas.</div>
            <Btn onClick={()=>setStep("bible")} style={{fontSize:11,padding:"10px 20px"}}>← Voltar à Bíblia</Btn>
          </div>
        )}
        {step==="preview"&&!fullProject&&(
          <div style={{textAlign:"center",padding:"80px 0"}}>
            <div style={{fontSize:48,marginBottom:20,opacity:0.3}}>👁</div>
            <div style={{color:T.textMid,fontSize:13,marginBottom:8}}>Guião ainda não gerado.</div>
            <Btn onClick={()=>setStep("scenes")} style={{fontSize:11,padding:"10px 20px"}}>← Voltar às Cenas</Btn>
          </div>
        )}

      </div>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════════════════════════
// ─── PROFILE SCREEN ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileScreen({username,onBack}){
  const [profile,setProfile]=useState({name:"",email:"",phone:"",bio:""});
  const [saved,setSaved]=useState(false);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{ getProfile(username).then(p=>{setProfile(p);setLoading(false);}); },[username]);

  const save=async()=>{
    await saveProfile(username,profile);
    setSaved(true); setTimeout(()=>setSaved(false),2500);
  };

  return(
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{height:54,background:T.surface,borderBottom:`1px solid ${T.border}`,
        display:"flex",alignItems:"center",padding:"0 24px",gap:14}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:T.textMid,
          cursor:"pointer",fontSize:20,lineHeight:1}}>‹</button>
        <span style={{fontSize:16}}>👤</span>
        <span style={{fontFamily:"'Playfair Display',serif",color:T.accent,fontSize:15,fontWeight:700}}>
          Perfil de Utilizador
        </span>
        <div style={{flex:1}}/>
        <span style={{fontSize:11,color:saved?T.green:T.textMuted,transition:"color 0.3s"}}>
          {saved?"✓ Guardado":""}
        </span>
        <Btn onClick={save} style={{fontSize:11,padding:"7px 18px"}}>💾 Guardar</Btn>
      </div>
      <div style={{maxWidth:600,margin:"0 auto",padding:"40px 32px"}}>
        {loading?(
          <div style={{color:T.textMuted,fontSize:12,textAlign:"center",padding:60}}>⏳ A carregar…</div>
        ):(
          <>
            {/* Avatar placeholder */}
            <div style={{display:"flex",alignItems:"center",gap:20,marginBottom:36}}>
              <div style={{width:72,height:72,borderRadius:"50%",background:T.surface3,
                border:`2px solid ${T.accent}`,display:"flex",alignItems:"center",
                justifyContent:"center",fontSize:30}}>
                {profile.name?profile.name[0].toUpperCase():"?"}
              </div>
              <div>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,color:T.text,fontWeight:700}}>
                  {profile.name||username}
                </div>
                <div style={{fontSize:10,color:T.textMuted,marginTop:4,letterSpacing:"0.1em"}}>
                  @{username} · K-ANIMAKERPROSTUDIO2026
                </div>
              </div>
            </div>
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:24}}>
              <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:20}}>
                Dados Pessoais
              </div>
              <Inp label="Nome Completo" value={profile.name}
                onChange={v=>setProfile(p=>({...p,name:v}))} placeholder="O seu nome" />
              <Inp label="Email" value={profile.email}
                onChange={v=>setProfile(p=>({...p,email:v}))} placeholder="email@exemplo.com" />
              <Inp label="Telefone / Telemóvel" value={profile.phone}
                onChange={v=>setProfile(p=>({...p,phone:v}))} placeholder="+351 9xx xxx xxx" />
              <TA label="Biografia / Apresentação" value={profile.bio}
                onChange={v=>setProfile(p=>({...p,bio:v}))} rows={4}
                placeholder="Conta algo sobre ti, a tua experiência em cinema, projetos…" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── API KEYS MODAL ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function APIKeysModal({username,onClose}){
  const [keys,setKeys]=useState({stability:"",replicate:"",runwayml:""});
  const [saved,setSaved]=useState(false);

  useEffect(()=>{ getAPIKeys(username).then(k=>setKeys(k)); },[username]);

  const save=async()=>{
    await saveAPIKeys(username,keys);
    setSaved(true); setTimeout(()=>{setSaved(false);onClose();},1200);
  };

  return(
    <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:200,
      display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:480,background:T.surface,border:`1px solid ${T.border}`,
        borderRadius:12,padding:32,boxShadow:"0 40px 80px #000000a0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:T.accent,fontWeight:700}}>
              🔑 Chaves de API
            </div>
            <div style={{fontSize:9,color:T.textMuted,marginTop:4,letterSpacing:"0.1em"}}>
              Para geração de imagens e vídeos na aplicação
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",fontSize:18}}>✕</button>
        </div>

        {[
          {id:"stability",label:"Stability AI",placeholder:"sk-...",hint:"Para geração de imagens (SDXL, SD3)",link:"https://platform.stability.ai/"},
          {id:"replicate",label:"Replicate",placeholder:"r8_...",hint:"Para imagens e vídeos (múltiplos modelos)",link:"https://replicate.com/"},
          {id:"runwayml",label:"RunwayML",placeholder:"key_...",hint:"Para geração de vídeo Gen-3 Alpha",link:"https://runwayml.com/"},
        ].map(({id,label,placeholder,hint,link})=>(
          <div key={id} style={{marginBottom:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <Label>{label}</Label>
              <a href={link} target="_blank" rel="noreferrer"
                style={{fontSize:8,color:T.accent,letterSpacing:"0.1em"}}>Obter chave →</a>
            </div>
            <input type="password" value={keys[id]||""}
              onChange={e=>setKeys(k=>({...k,[id]:e.target.value}))}
              placeholder={placeholder}
              style={{...inputBase,fontFamily:"'JetBrains Mono',monospace",
                border:`1px solid ${keys[id]?T.accent+"60":T.border}`}}/>
            <div style={{fontSize:8,color:T.textMuted,marginTop:4}}>{hint}</div>
          </div>
        ))}

        <div style={{background:`${T.accent}08`,border:`1px solid ${T.border}`,borderRadius:6,
          padding:"10px 14px",marginBottom:20,fontSize:9,color:T.textMuted,lineHeight:1.7}}>
          🔒 As chaves são guardadas localmente e nunca enviadas a terceiros.
          São usadas directamente nas chamadas à API de cada serviço.
        </div>

        <div style={{display:"flex",gap:10}}>
          <Btn onClick={save} style={{flex:1,fontSize:12,padding:"11px"}}>
            {saved?"✓ Guardado!":"💾 Guardar Chaves"}
          </Btn>
          <Btn variant="secondary" onClick={onClose} style={{fontSize:11}}>Cancelar</Btn>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MEDIA LIBRARY ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function MediaLibraryScreen({username,isGuest,onBack,onSelect,selectMode=false,selectFilter=null}){
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [filter,setFilter]=useState(selectFilter||"all");
  const [search,setSearch]=useState("");
  const [uploading,setUploading]=useState(false);
  const [urlInput,setUrlInput]=useState("");
  const [urlType,setUrlType]=useState("image");
  const [urlName,setUrlName]=useState("");
  const [showUrlForm,setShowUrlForm]=useState(false);
  const fileRef = React.useRef();

  useEffect(()=>{ if(!isGuest) getMediaList(username).then(l=>{setItems(l);setLoading(false);}); else setLoading(false); },[username]);

  const filtered = items.filter(it=>{
    const typeOk = filter==="all"||it.type===filter;
    const searchOk = !search||it.name.toLowerCase().includes(search.toLowerCase())||(it.tags||[]).join(" ").includes(search.toLowerCase());
    return typeOk&&searchOk;
  });

  const addFromFile=async(e)=>{
    const files=Array.from(e.target.files||[]);
    if(!files.length)return;
    setUploading(true);
    for(const file of files){
      const type = file.type.startsWith("image")?"image":file.type.startsWith("video")?"video":file.type.startsWith("audio")?"audio":"other";
      const reader=new FileReader();
      await new Promise(res=>{ reader.onload=res; reader.readAsDataURL(file); });
      const data=reader.result;
      const thumb=type==="image"?data:"";
      const asset={id:uid(),name:file.name,type,data,thumb,size:file.size,
        mimeType:file.type,tags:[],createdAt:new Date().toISOString(),source:"upload"};
      if(!isGuest) await addMedia(username,asset);
      setItems(prev=>[...prev,{id:asset.id,name:asset.name,type,thumb,createdAt:asset.createdAt,tags:[]}]);
    }
    setUploading(false);
  };

  const addFromUrl=async()=>{
    if(!urlInput.trim())return;
    const asset={id:uid(),name:urlName||urlInput.split("/").pop()||"Asset",type:urlType,
      data:urlInput,thumb:urlType==="image"?urlInput:"",tags:[],
      createdAt:new Date().toISOString(),source:"url",url:urlInput};
    if(!isGuest) await addMedia(username,asset);
    setItems(prev=>[...prev,{id:asset.id,name:asset.name,type:urlType,thumb:asset.thumb,createdAt:asset.createdAt,tags:[]}]);
    setUrlInput(""); setUrlName(""); setShowUrlForm(false);
  };

  const del=async(id,e)=>{
    e.stopPropagation();
    if(!confirm("Eliminar este item?"))return;
    if(!isGuest) await delMedia(username,id);
    setItems(prev=>prev.filter(x=>x.id!==id));
  };

  const typeIcon={image:"🖼",video:"🎥",audio:"🎵",other:"📄"};
  const typeColor={image:T.accent,video:T.blue,audio:T.purple,other:T.textMid};
  const FILTERS=[["all","Todos"],["image","Imagens"],["video","Vídeos"],["audio","Áudio"]];

  return(
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'JetBrains Mono',monospace",display:"flex",flexDirection:"column"}}>
      <div style={{height:54,background:T.surface,borderBottom:`1px solid ${T.border}`,
        display:"flex",alignItems:"center",padding:"0 24px",gap:14,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",fontSize:20,lineHeight:1}}>‹</button>
        <span style={{fontSize:16}}>🎞</span>
        <span style={{fontFamily:"'Playfair Display',serif",color:T.accent,fontSize:15,fontWeight:700}}>
          Biblioteca de Media
        </span>
        {selectMode&&<span style={{fontSize:10,color:T.textMid,background:T.surface3,padding:"3px 10px",borderRadius:4,border:`1px solid ${T.border}`}}>Modo Selecção</span>}
        <div style={{flex:1}}/>
        <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*"
          onChange={addFromFile} style={{display:"none"}}/>
        {!isGuest&&(
          <>
            <Btn variant="secondary" onClick={()=>setShowUrlForm(v=>!v)} style={{fontSize:10,padding:"6px 14px"}}>🔗 URL</Btn>
            <Btn onClick={()=>fileRef.current?.click()} disabled={uploading}
              style={{fontSize:10,padding:"6px 14px"}}>{uploading?"⏳":"⬆ Upload"}</Btn>
          </>
        )}
      </div>

      {showUrlForm&&(
        <div style={{background:T.surface2,borderBottom:`1px solid ${T.border}`,padding:"14px 24px",
          display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div style={{flex:"2 1 200px"}}><Inp label="URL do recurso" value={urlInput} onChange={setUrlInput} placeholder="https://…"/></div>
          <div style={{flex:"1 1 140px"}}><Inp label="Nome" value={urlName} onChange={setUrlName} placeholder="Nome do ficheiro"/></div>
          <div style={{flex:"0 1 120px"}}>
            <FieldWrap label="Tipo">
              <select value={urlType} onChange={e=>setUrlType(e.target.value)} style={{...inputBase,cursor:"pointer"}}>
                <option value="image">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option>
              </select>
            </FieldWrap>
          </div>
          <Btn onClick={addFromUrl} style={{fontSize:11,marginBottom:14}}>Adicionar</Btn>
          <Btn variant="secondary" onClick={()=>setShowUrlForm(false)} style={{fontSize:11,marginBottom:14}}>✕</Btn>
        </div>
      )}

      <div style={{padding:"16px 24px",borderBottom:`1px solid ${T.border}`,background:T.surface,
        display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",flexShrink:0}}>
        {FILTERS.map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)}
            style={{padding:"5px 14px",border:`1px solid ${filter===v?T.accent:T.border}`,
              background:filter===v?T.accentGlow:"transparent",color:filter===v?T.accent:T.textMid,
              borderRadius:14,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
              fontSize:10,transition:"all 0.15s"}}>{l}</button>
        ))}
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Pesquisar…" style={{...inputBase,width:200,marginLeft:"auto"}}/>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:24}}>
        {loading?(
          <div style={{color:T.textMuted,textAlign:"center",padding:60}}>⏳ A carregar…</div>
        ):filtered.length===0?(
          <div style={{textAlign:"center",padding:"60px 0"}}>
            <div style={{fontSize:48,marginBottom:16,opacity:0.3}}>🎞</div>
            <div style={{color:T.textMid,fontSize:12}}>
              {isGuest?"A biblioteca não está disponível em modo convidado.":"Sem itens. Faz upload ou adiciona um URL."}
            </div>
          </div>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:14}}>
            {filtered.map(it=>(
              <div key={it.id}
                onClick={selectMode&&onSelect?()=>onSelect(it):undefined}
                style={{background:T.surface,border:`1px solid ${it.type==="image"?T.accent+"30":T.border}`,
                  borderRadius:8,overflow:"hidden",cursor:selectMode?"pointer":"default",
                  transition:"all 0.15s",position:"relative"}}
                onMouseEnter={e=>{if(selectMode)e.currentTarget.style.borderColor=T.accent;}}
                onMouseLeave={e=>{if(selectMode)e.currentTarget.style.borderColor=it.type==="image"?T.accent+"30":T.border;}}>
                {/* Thumbnail */}
                <div style={{height:100,background:T.surface3,display:"flex",alignItems:"center",
                  justifyContent:"center",overflow:"hidden",position:"relative"}}>
                  {it.thumb?(
                    <img src={it.thumb} alt={it.name}
                      style={{width:"100%",height:"100%",objectFit:"cover"}}
                      onError={e=>{e.target.style.display="none";}}/>
                  ):(
                    <span style={{fontSize:32,opacity:0.4}}>{typeIcon[it.type]||"📄"}</span>
                  )}
                  <div style={{position:"absolute",top:6,left:6}}>
                    <Tag color={typeColor[it.type]||T.textMid}>{it.type}</Tag>
                  </div>
                </div>
                <div style={{padding:"10px 10px 8px"}}>
                  <div style={{fontSize:10,color:T.text,overflow:"hidden",textOverflow:"ellipsis",
                    whiteSpace:"nowrap",marginBottom:4}}>{it.name}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:8,color:T.textMuted}}>
                      {new Date(it.createdAt).toLocaleDateString("pt-PT")}
                    </div>
                    {!isGuest&&!selectMode&&(
                      <button onClick={e=>del(it.id,e)}
                        style={{background:"none",border:"none",color:T.red,cursor:"pointer",
                          fontSize:11,opacity:0.5,padding:2,lineHeight:1}}
                        onMouseEnter={e=>e.currentTarget.style.opacity=1}
                        onMouseLeave={e=>e.currentTarget.style.opacity=0.5}>✕</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CREDITS & INTRO EDITOR ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function CreditsIntroScreen({username,projectId,isGuest,onBack}){
  const [proj,setProj]=useState(null);
  const [credits,setCredits]=useState(null);
  const [genLoading,setGenLoading]=useState({});
  const [saved,setSaved]=useState(false);

  const defaultCredits=()=>({
    intro:{title:"",tagline:"",director:"",backgroundPrompt:"",videoPrompt:"",font:"serif",style:"dramatic"},
    openingTitles:[{id:uid(),text:"",duration:3,style:"fade",prompt:""}],
    cast:[{id:uid(),actor:"",character:"",order:1}],
    crew:[{id:uid(),role:"Realização",name:""}],
    endCard:{text:"",prompt:"",music:""}
  });

  useEffect(()=>{
    if(!projectId){setCredits(defaultCredits());return;}
    Promise.all([
      isGuest?Promise.resolve(null):getProject(username,projectId),
      isGuest?Promise.resolve(null):getCredits(username,projectId)
    ]).then(([p,cr])=>{
      setProj(p);
      setCredits(cr||defaultCredits());
    });
  },[projectId,username]);

  const save=async()=>{
    if(!isGuest&&projectId) await saveCredits(username,projectId,credits);
    setSaved(true); setTimeout(()=>setSaved(false),2500);
  };

  const genPrompt=async(section,id,field)=>{
    const k=`${section}_${id}_${field}`;
    setGenLoading(g=>({...g,[k]:true}));
    try{
      const ctx=`Film: "${proj?.title||"Unknown"}" | Genre: ${proj?.genre||"Drama"} | Language: ${proj?.language||"Português"}`;
      const sectionCtx= section==="intro"
        ? `Intro title card. Title: "${credits.intro.title}", Tagline: "${credits.intro.tagline}", Director: "${credits.intro.director}". Style: ${credits.intro.style}.`
        : section==="endCard"
        ? `End card. Text: "${credits.endCard.text}". Emotional tone: final, reflective.`
        : `Opening title card #${id}. Text: "${(credits.openingTitles.find(t=>t.id===id)||{}).text}".`;
      const sys=`You are a cinematographer. Generate a ${field==="videoPrompt"?"video generation (Sora/Runway)":"image generation (Midjourney/DALL-E)"} prompt for a film ${section==="intro"?"intro title card":"credit card"}. English only. Max 150 words. Output ONLY the prompt.`;
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:500,system:sys,
          messages:[{role:"user",content:`${ctx}\n${sectionCtx}`}]})
      });
      const data=await res.json();
      const txt=data.content?.[0]?.text||"";
      if(section==="intro") setCredits(c=>({...c,intro:{...c.intro,[field]:txt}}));
      else if(section==="endCard") setCredits(c=>({...c,endCard:{...c.endCard,[field]:txt}}));
      else setCredits(c=>({...c,openingTitles:c.openingTitles.map(t=>t.id===id?{...t,[field]:txt}:t)}));
    }catch(e){console.error(e);}
    setGenLoading(g=>({...g,[k]:false}));
  };

  const addTitle=()=>setCredits(c=>({...c,openingTitles:[...c.openingTitles,{id:uid(),text:"",duration:3,style:"fade",prompt:""}]}));
  const delTitle=id=>setCredits(c=>({...c,openingTitles:c.openingTitles.filter(t=>t.id!==id)}));
  const addCast=()=>setCredits(c=>({...c,cast:[...c.cast,{id:uid(),actor:"",character:"",order:c.cast.length+1}]}));
  const addCrew=()=>setCredits(c=>({...c,crew:[...c.crew,{id:uid(),role:"",name:""}]}));

  if(!credits) return <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>⏳ A carregar…</div>;

  const PromptField=({label,value,onChange,onGen,loading})=>(
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
        <Label>{label}</Label>
        <Btn variant="accent" onClick={onGen} disabled={loading} style={{fontSize:8,padding:"3px 10px"}}>
          {loading?"⏳":"✨ IA"}
        </Btn>
      </div>
      <textarea value={value||""} onChange={e=>onChange(e.target.value)} rows={3}
        style={{...inputBase,resize:"vertical",fontSize:11,lineHeight:1.6,
          border:`1px solid ${value?T.accent+"40":T.border}`}}
        placeholder="Clica ✨IA para gerar, ou escreve manualmente…"/>
      {value&&(
        <button onClick={()=>navigator.clipboard.writeText(value)}
          style={{background:"none",border:`1px solid ${T.border}`,color:T.textMuted,
            fontSize:8,fontFamily:"'JetBrains Mono',monospace",padding:"3px 8px",
            borderRadius:3,cursor:"pointer",marginTop:4}}>📋 Copiar</button>
      )}
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'JetBrains Mono',monospace",display:"flex",flexDirection:"column"}}>
      <div style={{height:54,background:T.surface,borderBottom:`1px solid ${T.border}`,
        display:"flex",alignItems:"center",padding:"0 24px",gap:14,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",fontSize:20,lineHeight:1}}>‹</button>
        <span style={{fontSize:16}}>🎞</span>
        <span style={{fontFamily:"'Playfair Display',serif",color:T.accent,fontSize:15,fontWeight:700}}>
          Créditos & Intro{proj?" — "+proj.title:""}
        </span>
        <div style={{flex:1}}/>
        <span style={{fontSize:11,color:saved?T.green:T.textMuted,transition:"color 0.3s"}}>{saved?"✓ Guardado":""}</span>
        <Btn onClick={save} disabled={isGuest} style={{fontSize:11,padding:"7px 18px"}}>💾 Guardar</Btn>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"28px 32px",maxWidth:860,margin:"0 auto",width:"100%"}}>

        {/* INTRO */}
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:22,marginBottom:20}}>
          <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:16}}>🎬 INTRO / ABERTURA</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <Inp label="Título do Filme" value={credits.intro.title}
              onChange={v=>setCredits(c=>({...c,intro:{...c.intro,title:v}}))}/>
            <Inp label="Tagline / Logline" value={credits.intro.tagline}
              onChange={v=>setCredits(c=>({...c,intro:{...c.intro,tagline:v}}))}/>
            <Inp label="Realização" value={credits.intro.director}
              onChange={v=>setCredits(c=>({...c,intro:{...c.intro,director:v}}))}/>
            <Sel label="Estilo Visual" value={credits.intro.style}
              onChange={v=>setCredits(c=>({...c,intro:{...c.intro,style:v}}))}
              options={["dramatic","minimal","noir","ethereal","kinetic","vintage","neon"]}/>
          </div>
          <PromptField label="🖼 Prompt Imagem (cartão de abertura)"
            value={credits.intro.backgroundPrompt}
            onChange={v=>setCredits(c=>({...c,intro:{...c.intro,backgroundPrompt:v}}))}
            onGen={()=>genPrompt("intro","","backgroundPrompt")}
            loading={genLoading["intro__backgroundPrompt"]}/>
          <PromptField label="🎥 Prompt Vídeo (animação de abertura)"
            value={credits.intro.videoPrompt}
            onChange={v=>setCredits(c=>({...c,intro:{...c.intro,videoPrompt:v}}))}
            onGen={()=>genPrompt("intro","","videoPrompt")}
            loading={genLoading["intro__videoPrompt"]}/>
        </div>

        {/* OPENING TITLES */}
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:22,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase"}}>🎞 TÍTULOS DE ABERTURA</div>
            <Btn variant="secondary" onClick={addTitle} style={{fontSize:9,padding:"4px 12px"}}>+ Adicionar</Btn>
          </div>
          {credits.openingTitles.map((title,i)=>(
            <div key={title.id} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,padding:16,marginBottom:10}}>
              <div style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
                <div style={{width:24,height:24,borderRadius:4,background:T.surface3,display:"flex",alignItems:"center",
                  justifyContent:"center",fontSize:10,color:T.accent,flexShrink:0,marginTop:2}}>{i+1}</div>
                <div style={{flex:1,display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10}}>
                  <Inp label="Texto" value={title.text}
                    onChange={v=>setCredits(c=>({...c,openingTitles:c.openingTitles.map(t=>t.id===title.id?{...t,text:v}:t)}))}
                    placeholder="Texto do título…"/>
                  <Inp label="Duração (seg)" value={title.duration}
                    onChange={v=>setCredits(c=>({...c,openingTitles:c.openingTitles.map(t=>t.id===title.id?{...t,duration:v}:t)}))}
                    type="number"/>
                  <Sel label="Transição" value={title.style}
                    onChange={v=>setCredits(c=>({...c,openingTitles:c.openingTitles.map(t=>t.id===title.id?{...t,style:v}:t)}))}
                    options={["fade","cut","wipe","dissolve","push"]}/>
                </div>
                {credits.openingTitles.length>1&&(
                  <button onClick={()=>delTitle(title.id)}
                    style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:14,marginTop:20,opacity:0.6,lineHeight:1}}>✕</button>
                )}
              </div>
              <PromptField label="🖼 Prompt Visual deste Título"
                value={title.prompt}
                onChange={v=>setCredits(c=>({...c,openingTitles:c.openingTitles.map(t=>t.id===title.id?{...t,prompt:v}:t)}))}
                onGen={()=>genPrompt("openingTitles",title.id,"prompt")}
                loading={genLoading[`openingTitles_${title.id}_prompt`]}/>
            </div>
          ))}
        </div>

        {/* CAST */}
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:22,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase"}}>🎭 ELENCO (CAST)</div>
            <Btn variant="secondary" onClick={addCast} style={{fontSize:9,padding:"4px 12px"}}>+ Actor</Btn>
          </div>
          {credits.cast.map((c,i)=>(
            <div key={c.id} style={{display:"grid",gridTemplateColumns:"2fr 2fr auto",gap:10,marginBottom:8,alignItems:"flex-end"}}>
              <Inp label={i===0?"Actor / Actriz":""} value={c.actor}
                onChange={v=>setCredits(cr=>({...cr,cast:cr.cast.map(x=>x.id===c.id?{...x,actor:v}:x)}))}
                placeholder="Nome do actor"/>
              <Inp label={i===0?"Personagem":""} value={c.character}
                onChange={v=>setCredits(cr=>({...cr,cast:cr.cast.map(x=>x.id===c.id?{...x,character:v}:x)}))}
                placeholder="Nome da personagem"/>
              <button onClick={()=>setCredits(cr=>({...cr,cast:cr.cast.filter(x=>x.id!==c.id)}))}
                style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:14,
                  marginBottom:14,opacity:0.5,lineHeight:1}}>✕</button>
            </div>
          ))}
        </div>

        {/* CREW */}
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:22,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase"}}>🎬 EQUIPA TÉCNICA (CREW)</div>
            <Btn variant="secondary" onClick={addCrew} style={{fontSize:9,padding:"4px 12px"}}>+ Função</Btn>
          </div>
          {credits.crew.map((c,i)=>(
            <div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr 2fr auto",gap:10,marginBottom:8,alignItems:"flex-end"}}>
              <Inp label={i===0?"Função":""} value={c.role}
                onChange={v=>setCredits(cr=>({...cr,crew:cr.crew.map(x=>x.id===c.id?{...x,role:v}:x)}))}
                placeholder="Realização, Produção…"/>
              <Inp label={i===0?"Nome":""} value={c.name}
                onChange={v=>setCredits(cr=>({...cr,crew:cr.crew.map(x=>x.id===c.id?{...x,name:v}:x)}))}
                placeholder="Nome"/>
              <button onClick={()=>setCredits(cr=>({...cr,crew:cr.crew.filter(x=>x.id!==c.id)}))}
                style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:14,marginBottom:14,opacity:0.5,lineHeight:1}}>✕</button>
            </div>
          ))}
        </div>

        {/* END CARD */}
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:22,marginBottom:20}}>
          <div style={{fontSize:9,color:T.accent,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:16}}>🏁 CARTÃO FINAL</div>
          <TA label="Texto Final (agradecimentos, nota de produção…)" value={credits.endCard.text}
            onChange={v=>setCredits(c=>({...c,endCard:{...c.endCard,text:v}}))} rows={3}/>
          <Inp label="Música dos Créditos" value={credits.endCard.music}
            onChange={v=>setCredits(c=>({...c,endCard:{...c.endCard,music:v}}))}
            placeholder="Ex: score orquestral, tema principal, fade out…"/>
          <PromptField label="🖼 Prompt Visual do Cartão Final"
            value={credits.endCard.prompt}
            onChange={v=>setCredits(c=>({...c,endCard:{...c.endCard,prompt:v}}))}
            onGen={()=>genPrompt("endCard","","prompt")}
            loading={genLoading["endCard__prompt"]}/>
        </div>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── IMAGE / VIDEO GENERATION MODAL ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function GenerateMediaModal({username,prompt,type="image",onClose,onSave}){
  const [apiKey,setApiKey]=useState("");
  const [service,setService]=useState("stability");
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");
  const [assetName,setAssetName]=useState("Generated-"+Date.now());

  useEffect(()=>{ getAPIKeys(username).then(k=>{ setApiKey(k.stability||""); }); },[username]);

  const generate=async()=>{
    if(!apiKey.trim()){setErr("Insere a tua chave API nas Definições.");return;}
    setLoading(true);setErr("");
    try{
      if(service==="stability"&&type==="image"){
        const res=await fetch("https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",{
          method:"POST",
          headers:{"Content-Type":"application/json","Accept":"application/json","Authorization":`Bearer ${apiKey}`},
          body:JSON.stringify({text_prompts:[{text:prompt,weight:1}],cfg_scale:7,height:576,width:1024,steps:30,samples:1})
        });
        if(!res.ok){const e=await res.json();throw new Error(e.message||res.statusText);}
        const data=await res.json();
        const b64=data.artifacts?.[0]?.base64;
        if(b64) setResult("data:image/png;base64,"+b64);
        else throw new Error("Sem imagem na resposta");
      } else {
        setErr("Para vídeo, copia o prompt e usa a plataforma directamente (Runway, Kling, Pika).");
        setLoading(false);return;
      }
    }catch(e){setErr("Erro: "+e.message);}
    setLoading(false);
  };

  const save=async()=>{
    if(!result)return;
    const asset={id:uid(),name:assetName+".png",type:"image",data:result,
      thumb:result,tags:["generated"],createdAt:new Date().toISOString(),source:"generated",prompt};
    await addMedia(username,asset);
    onSave&&onSave(asset);
    onClose();
  };

  const download=()=>{
    if(!result)return;
    const a=document.createElement("a");
    a.href=result;a.download=assetName+".png";a.click();
  };

  return(
    <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:200,
      display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:600,background:T.surface,border:`1px solid ${T.border}`,
        borderRadius:12,padding:28,maxHeight:"90vh",overflowY:"auto",
        boxShadow:"0 40px 80px #000000a0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:T.accent,fontWeight:700}}>
            🎨 Gerar {type==="image"?"Imagem":"Vídeo"}
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",fontSize:18}}>✕</button>
        </div>

        <div style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:7,
          padding:12,marginBottom:16,fontSize:10,color:T.textMid,lineHeight:1.7,maxHeight:80,overflowY:"auto"}}>
          {prompt}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
          <Sel label="Serviço" value={service} onChange={setService}
            options={type==="image"?["stability","replicate"]:["runway","kling","pika"]}/>
          <Inp label="Chave API" value={apiKey} onChange={v=>{setApiKey(v);getAPIKeys(username).then(k=>saveAPIKeys(username,{...k,stability:v}));}}
            type="password" placeholder="sk-… ou r8_…"/>
        </div>

        {err&&<div style={{color:T.red,fontSize:10,padding:"8px 12px",background:"#e0525210",border:`1px solid ${T.red}30`,borderRadius:5,marginBottom:12}}>{err}</div>}

        {result&&(
          <div style={{marginBottom:16,borderRadius:8,overflow:"hidden",background:T.bg,border:`1px solid ${T.border}`}}>
            <img src={result} alt="Generated" style={{width:"100%",display:"block"}}/>
          </div>
        )}

        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <Btn onClick={generate} disabled={loading} style={{fontSize:11,padding:"9px 20px"}}>
            {loading?"⏳ A gerar…":"🎨 Gerar"}
          </Btn>
          {result&&<>
            <Btn onClick={save} variant="accent" style={{fontSize:11,padding:"9px 20px"}}>💾 Gravar na Biblioteca</Btn>
            <Btn onClick={download} variant="secondary" style={{fontSize:11,padding:"9px 20px"}}>⬇ Download</Btn>
          </>}
          <Btn variant="ghost" onClick={onClose} style={{fontSize:11}}>Fechar</Btn>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PRODUCTION SCREEN ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ProductionScreen({username,projectId,isGuest,guestProjects,onBack}){
  const [proj,setProj]=useState(null);
  const [playing,setPlaying]=useState(false);
  const [curScene,setCurScene]=useState(0);
  const [curTake,setCurTake]=useState(0);
  const [cinemaMode,setCinemaMode]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  const intervalRef=React.useRef(null);
  const [mediaLib,setMediaLib]=useState([]);

  useEffect(()=>{
    const load=async()=>{
      let p=null;
      if(isGuest){
        const m=(guestProjects||[]).find(x=>x.id===projectId);
        p=m?._full||null;
      } else {
        p=await getProject(username,projectId);
        const ml=await getMediaList(username);
        setMediaLib(ml);
      }
      setProj(p);
    };
    load();
  },[projectId,username,isGuest]);

  // Auto-advance
  useEffect(()=>{
    if(!playing||!proj)return;
    intervalRef.current=setInterval(()=>{
      setElapsed(e=>{
        const sc=proj.scenes[curScene];
        const tk=sc?.takes[curTake];
        const dur=(+tk?.duration||5)*1000;
        if(e+250>=dur){
          // advance
          const nextTake=curTake+1;
          if(nextTake<sc.takes.length){ setCurTake(nextTake);return 0; }
          const nextScene=curScene+1;
          if(nextScene<proj.scenes.length){ setCurScene(nextScene);setCurTake(0);return 0; }
          setPlaying(false);return 0;
        }
        return e+250;
      });
    },250);
    return()=>clearInterval(intervalRef.current);
  },[playing,curScene,curTake,proj]);

  const sc=proj?.scenes[curScene];
  const tk=sc?.takes[curTake];
  const totalTakes=proj?.scenes.reduce((a,s)=>a+s.takes.length,0)||0;
  const playedTakes=proj?.scenes.slice(0,curScene).reduce((a,s)=>a+s.takes.length,0)+(curTake||0);
  const progressPct=totalTakes?Math.round((playedTakes/totalTakes)*100):0;
  const dur=(+tk?.duration||5);

  const goPrev=()=>{
    setPlaying(false);setElapsed(0);
    if(curTake>0){setCurTake(t=>t-1);return;}
    if(curScene>0){const ps=proj.scenes[curScene-1];setCurScene(s=>s-1);setCurTake(ps.takes.length-1);}
  };
  const goNext=()=>{
    setPlaying(false);setElapsed(0);
    if(!proj)return;
    const sc=proj.scenes[curScene];
    if(curTake<sc.takes.length-1){setCurTake(t=>t+1);return;}
    if(curScene<proj.scenes.length-1){setCurScene(s=>s+1);setCurTake(0);}
  };

  if(!proj) return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",color:T.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>
      ⏳ A carregar produção…
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:"#000",fontFamily:"'JetBrains Mono',monospace",display:"flex",flexDirection:"column"}}>
      {!cinemaMode&&(
        <div style={{height:54,background:T.surface,borderBottom:`1px solid ${T.border}`,
          display:"flex",alignItems:"center",padding:"0 20px",gap:14,flexShrink:0}}>
          <button onClick={onBack} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",fontSize:20,lineHeight:1}}>‹</button>
          <span style={{fontSize:16}}>🎥</span>
          <span style={{fontFamily:"'Playfair Display',serif",color:T.accent,fontSize:15,fontWeight:700}}>
            {proj.title}
          </span>
          <Tag color={T.accent}>{proj.genre}</Tag>
          <Tag color={T.textMid}>{proj.format}</Tag>
          <div style={{flex:1}}/>
          <Btn variant="accent" onClick={()=>setCinemaMode(true)} style={{fontSize:10,padding:"6px 16px"}}>
            🎬 Modo Cinema
          </Btn>
        </div>
      )}

      {cinemaMode?(
        /* ── CINEMA MODE ── */
        <div style={{flex:1,background:"#000",display:"flex",flexDirection:"column",position:"relative",
          minHeight:"100vh",cursor:"pointer"}} onClick={()=>setCinemaMode(false)}>
          {/* Film frame */}
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
            {/* Background - show image if thumb available, else gradient */}
            {tk?.imagePrompt&&mediaLib.find(m=>m.prompt===tk.imagePrompt)?(
              <img src={mediaLib.find(m=>m.prompt===tk.imagePrompt).thumb}
                style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",opacity:0.7}}/>
            ):(
              <div style={{position:"absolute",inset:0,
                background:`radial-gradient(ellipse at center, ${T.surface3} 0%, #000 80%)`}}/>
            )}
            {/* Scene info overlay */}
            <div style={{position:"relative",textAlign:"center",padding:40,maxWidth:800}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:T.accent,
                letterSpacing:"0.3em",textTransform:"uppercase",marginBottom:16,
                textShadow:"0 0 20px rgba(232,184,75,0.8)"}}>
                CENA {sc.number} · TAKE {tk.number}
              </div>
              {tk?.dialogue&&(
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:"#fff",
                  lineHeight:1.6,textShadow:"0 2px 20px rgba(0,0,0,0.9)",
                  borderBottom:"1px solid rgba(255,255,255,0.2)",paddingBottom:16,marginBottom:16}}>
                  "{tk.dialogue}"
                </div>
              )}
              {tk?.narration&&(
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:"#ccc",
                  fontStyle:"italic",lineHeight:1.7,textShadow:"0 2px 10px rgba(0,0,0,0.9)"}}>
                  {tk.narration}
                </div>
              )}
              {tk?.action&&!tk?.dialogue&&!tk?.narration&&(
                <div style={{fontSize:14,color:"#aaa",lineHeight:1.7,
                  textShadow:"0 2px 10px rgba(0,0,0,0.9)"}}>
                  {tk.action}
                </div>
              )}
              <div style={{marginTop:20,fontSize:10,color:"rgba(255,255,255,0.4)"}}>
                {sc.location} · {sc.timeOfDay} · {tk.framing}
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div style={{padding:"12px 24px",background:"rgba(0,0,0,0.85)",
            borderTop:"1px solid rgba(255,255,255,0.1)",
            display:"flex",alignItems:"center",gap:14}}>
            <button onClick={e=>{e.stopPropagation();goPrev();}}
              style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",
                cursor:"pointer",fontSize:20,padding:4}}>⏮</button>
            <button onClick={e=>{e.stopPropagation();setPlaying(p=>!p);}}
              style={{background:T.accent,border:"none",color:"#000",
                cursor:"pointer",fontSize:18,width:40,height:40,borderRadius:"50%",
                display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>
              {playing?"⏸":"▶"}
            </button>
            <button onClick={e=>{e.stopPropagation();goNext();}}
              style={{background:"none",border:"none",color:"rgba(255,255,255,0.6)",
                cursor:"pointer",fontSize:20,padding:4}}>⏭</button>
            <div style={{flex:1,height:3,background:"rgba(255,255,255,0.15)",borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",background:T.accent,
                width:`${progressPct}%`,transition:"width 0.3s"}}/>
            </div>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.5)",whiteSpace:"nowrap"}}>
              {playedTakes}/{totalTakes} takes
            </span>
            <button onClick={e=>{e.stopPropagation();setCinemaMode(false);}}
              style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",
                cursor:"pointer",fontSize:12,padding:4}}>✕ SAIR</button>
          </div>
        </div>

      ):(
        /* ── PRODUCTION BOARD ── */
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>

          {/* Left: scene timeline */}
          <div style={{width:220,background:T.surface,borderRight:`1px solid ${T.border}`,
            overflowY:"auto",flexShrink:0}}>
            <div style={{padding:"10px 12px",borderBottom:`1px solid ${T.border}`,
              fontSize:9,color:T.textMuted,letterSpacing:"0.15em",textTransform:"uppercase"}}>
              Storyboard Timeline
            </div>
            {proj.scenes.map((s,si)=>
              s.takes.map((t,ti)=>{
                const isCur=si===curScene&&ti===curTake;
                return(
                  <div key={`${si}-${ti}`}
                    onClick={()=>{setPlaying(false);setElapsed(0);setCurScene(si);setCurTake(ti);}}
                    style={{padding:"8px 12px",cursor:"pointer",
                      background:isCur?T.accentGlow:"transparent",
                      borderLeft:`3px solid ${isCur?T.accent:"transparent"}`,
                      transition:"all 0.15s"}}>
                    <div style={{fontSize:9,color:isCur?T.accent:T.textMuted,letterSpacing:"0.1em",marginBottom:2}}>
                      C{s.number} · T{t.number}
                    </div>
                    <div style={{fontSize:10,color:isCur?T.text:T.textMid,
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {s.title}
                    </div>
                    <div style={{fontSize:8,color:T.textMuted,marginTop:2}}>
                      {t.framing?.split(" (")[0]} · {t.duration}s
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Centre: preview panel */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {/* Canvas */}
            <div style={{flex:"0 0 340px",background:"#050508",position:"relative",
              display:"flex",alignItems:"center",justifyContent:"center",
              borderBottom:`1px solid ${T.border}`}}>
              <div style={{position:"absolute",inset:0,
                background:`radial-gradient(ellipse at 30% 40%, ${T.surface3}80 0%, #000 70%)`}}/>
              <div style={{position:"relative",textAlign:"center",maxWidth:500,padding:24}}>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:T.accent,
                  letterSpacing:"0.3em",textTransform:"uppercase",marginBottom:12}}>
                  CENA {sc?.number} · TAKE {tk?.number} · {tk?.framing?.split(" (")[0]}
                </div>
                {tk?.dialogue?(
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:T.text,
                    lineHeight:1.6,marginBottom:10}}>"{tk.dialogue}"</div>
                ):tk?.action?(
                  <div style={{fontSize:13,color:T.textMid,lineHeight:1.7}}>{tk.action}</div>
                ):(
                  <div style={{fontSize:12,color:T.textMuted}}>📷 {tk?.cameraMovement} · {tk?.lens}</div>
                )}
                {tk?.narration&&<div style={{fontFamily:"'Playfair Display',serif",fontSize:12,
                  color:T.textMuted,fontStyle:"italic",marginTop:8}}>{tk.narration}</div>}
              </div>
              {/* Take duration bar */}
              <div style={{position:"absolute",bottom:0,left:0,right:0,height:3,background:T.border}}>
                <div style={{height:"100%",background:T.accent,transition:"width 0.25s",
                  width:`${playing?Math.min(100,(elapsed/((dur)*1000))*100):0}%`}}/>
              </div>
            </div>

            {/* Controls */}
            <div style={{padding:"14px 20px",background:T.surface,borderBottom:`1px solid ${T.border}`,
              display:"flex",gap:12,alignItems:"center"}}>
              <button onClick={goPrev}
                style={{background:T.surface3,border:`1px solid ${T.border}`,color:T.text,
                  cursor:"pointer",fontSize:16,width:36,height:36,borderRadius:6,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>⏮</button>
              <button onClick={()=>setPlaying(p=>!p)}
                style={{background:T.accent,border:"none",color:"#000",
                  cursor:"pointer",fontSize:18,width:44,height:44,borderRadius:"50%",
                  display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>
                {playing?"⏸":"▶"}
              </button>
              <button onClick={goNext}
                style={{background:T.surface3,border:`1px solid ${T.border}`,color:T.text,
                  cursor:"pointer",fontSize:16,width:36,height:36,borderRadius:6,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>⏭</button>
              <div style={{flex:1,height:4,background:T.border,borderRadius:2,overflow:"hidden",cursor:"pointer"}}
                onClick={e=>{
                  const rect=e.currentTarget.getBoundingClientRect();
                  const pct=(e.clientX-rect.left)/rect.width;
                  const totalIdx=Math.floor(pct*totalTakes);
                  let cnt=0;
                  for(let si=0;si<proj.scenes.length;si++){
                    for(let ti=0;ti<proj.scenes[si].takes.length;ti++){
                      if(cnt===totalIdx){setCurScene(si);setCurTake(ti);setElapsed(0);return;}
                      cnt++;
                    }
                  }
                }}>
                <div style={{height:"100%",background:T.accent,transition:"width 0.25s",
                  width:`${progressPct}%`}}/>
              </div>
              <span style={{fontSize:9,color:T.textMuted,whiteSpace:"nowrap"}}>
                {playedTakes}/{totalTakes} takes · {proj.scenes.length} cenas
              </span>
            </div>

            {/* Take metadata */}
            {tk&&(
              <div style={{flex:1,overflowY:"auto",padding:"16px 20px",
                display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,alignContent:"start"}}>
                {[
                  ["📷 Ângulo",tk.cameraAngle],["🎬 Movimento",tk.cameraMovement],
                  ["🔭 Lente",tk.lens],["💡 Iluminação",tk.lighting],
                  ["🎭 Personagens",tk.characters],["⏱ Duração",`${tk.duration}s @ ${tk.fps}fps`],
                  ["🎵 Música",tk.music],["🔊 Som",tk.sound],
                ].map(([k,v])=>v&&(
                  <div key={k} style={{background:T.surface,border:`1px solid ${T.border}`,
                    borderRadius:6,padding:"8px 12px"}}>
                    <div style={{fontSize:8,color:T.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>{k}</div>
                    <div style={{fontSize:10,color:T.textMid,lineHeight:1.5}}>{v}</div>
                  </div>
                ))}
                {tk.imagePrompt&&(
                  <div style={{gridColumn:"1/-1",background:T.surface,border:`1px solid ${T.accent}30`,
                    borderRadius:6,padding:"10px 12px"}}>
                    <div style={{fontSize:8,color:T.accent,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>🖼 Prompt Imagem</div>
                    <div style={{fontSize:9,color:T.textMuted,lineHeight:1.6}}>{tk.imagePrompt.slice(0,200)}{tk.imagePrompt.length>200?"…":""}</div>
                    <button onClick={()=>navigator.clipboard.writeText(tk.imagePrompt)}
                      style={{background:"none",border:`1px solid ${T.border}`,color:T.textMuted,
                        fontSize:8,fontFamily:"'JetBrains Mono',monospace",padding:"3px 8px",
                        borderRadius:3,cursor:"pointer",marginTop:6}}>📋 Copiar</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [screen,setScreen]         = useState("auth");
  const [username,setUsername]     = useState("");
  const [projId,setProjId]         = useState(null);
  const [isGuest,setIsGuest]       = useState(false);
  const [guestProjects,setGuestProjects] = useState([]);
  const [showApiKeys,setShowApiKeys] = useState(false);

  const enterGuest=()=>{ setIsGuest(true); setGuestProjects([]); setScreen("dash"); };
  const logout=()=>{ setIsGuest(false); setGuestProjects([]); setUsername(""); setScreen("auth"); };
  const openProject=(id,dest="editor")=>{ setProjId(id); setScreen(dest); };

  return(
    <>
      {screen==="auth"&&(
        <AuthScreen
          onLogin={u=>{setIsGuest(false);setUsername(u);setScreen("dash");}}
          onGuest={enterGuest}
        />
      )}
      {screen==="dash"&&(
        <Dashboard username={username}
          onOpen={id=>openProject(id,"editor")}
          onLogout={logout}
          isGuest={isGuest}
          guestProjects={guestProjects}
          setGuestProjects={setGuestProjects}
          onGenerateAI={()=>setScreen("generator")}
          onOpenMedia={()=>setScreen("media")}
          onOpenProfile={()=>setScreen("profile")}
          onOpenAPIKeys={()=>setShowApiKeys(true)}
          onOpenProduction={id=>openProject(id,"production")}
          onOpenCredits={id=>openProject(id,"credits")}
        />
      )}
      {screen==="profile"&&(
        <ProfileScreen username={username} onBack={()=>setScreen("dash")}/>
      )}
      {screen==="media"&&(
        <MediaLibraryScreen username={username} isGuest={isGuest}
          onBack={()=>setScreen("dash")}/>
      )}
      {screen==="credits"&&(
        <CreditsIntroScreen username={username} projectId={projId}
          isGuest={isGuest} onBack={()=>setScreen("editor")}/>
      )}
      {screen==="production"&&(
        <ProductionScreen username={username} projectId={projId}
          isGuest={isGuest} guestProjects={guestProjects}
          onBack={()=>setScreen("editor")}/>
      )}
      {screen==="editor"&&(
        <Editor username={username} projectId={projId}
          onBack={()=>setScreen("dash")}
          isGuest={isGuest}
          guestProjects={guestProjects}
          setGuestProjects={setGuestProjects}
          onOpenCredits={()=>setScreen("credits")}
          onOpenProduction={()=>setScreen("production")}
          onOpenMedia={()=>setScreen("media")}
          onOpenAPIKeys={()=>setShowApiKeys(true)}
        />
      )}
      {screen==="generator"&&(
        <ScreenplayGenerator
          username={username}
          isGuest={isGuest}
          guestProjects={guestProjects}
          setGuestProjects={setGuestProjects}
          onDone={id=>{ setProjId(id); setScreen("editor"); }}
          onCancel={()=>setScreen("dash")}
        />
      )}
      {showApiKeys&&!isGuest&&(
        <APIKeysModal username={username} onClose={()=>setShowApiKeys(false)}/>
      )}
    </>
  );
}
