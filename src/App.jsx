import { useState, useCallback, useEffect } from "react";
/* ============================================================
   채움학원 — 선생님용 시험 등록 v2
   신규: 선생님 이름, 반별 인원, 오늘의 현황 대시보드
   ============================================================ */
const SHEETS_URL = "https://script.google.com/macros/s/AKfycbzablzeV_gVdLoUG-Oh4s02vNmncvteesBn3875WDF3lO176nc4YzAKj7B6zOJVECQO/exec";
const SUBJECTS=["영어","국어","수학"];
const GRADES=["초1","초2","초3","초4","초5","초6","초등","중1","중2","중3","고1","고2","고3"];
const LV_LEVELS=["SB","B","I","A","SA","전체"];
const LV_MIDDLE=["인하부중","인주중","관교중","관교여중","용현중","용현여중","남인천여중","인화여중","제물포여중"];
const LV_HIGH=["인하부고","학익고","학익여고","인성여고","인명여고","제물포고","인천고"];
const LV_CATS=[{key:"level",label:"레벨",opts:LV_LEVELS},{key:"middle",label:"중학교",opts:LV_MIDDLE},{key:"high",label:"고등학교",opts:LV_HIGH},{key:"etc",label:"기타",opts:[]}];
const EXAM_TYPES=["단어시험","문법시험","종합시험","모의고사","수학테스트","영작시험","해석시험","DAILY TEST","WEEKLY TEST","MONTHLY TEST","기타"];
// ★ v12.1: 시험 종류 4분류 (정규/주기/영역별/기타)
const EXAM_TYPE_CATS=[
  {key:"정규",label:"정규 시험",types:["단어시험","문법시험","종합시험","모의고사"]},
  {key:"주기",label:"주기 테스트",types:["DAILY TEST","WEEKLY TEST","MONTHLY TEST"]},
  {key:"영역별",label:"영역별",types:["영작시험","해석시험","수학테스트"]},
  {key:"기타",label:"기타",types:["기타"]}  // 직접입력
];
const LS_KEY="chaeum_teacher";
function lsGet(){try{return JSON.parse(localStorage.getItem(LS_KEY)||"{}");}catch(e){return{};}}
function lsSet(o){try{const cur=lsGet();localStorage.setItem(LS_KEY,JSON.stringify({...cur,...o}));}catch(e){}}
// ============================================================
// [공통 유틸] 정답 데이터 정규화 — 배열/객체/JSON문자열/이중인코딩 → {"1":v,...}
// (앱스크립트 normalizeAnswerData 와 동일 로직, 클라이언트 fallback용)
// ============================================================
function normalizeAnswerData(raw){
  if(raw===null||raw===undefined||raw==="")return{};
  let v=raw;
  for(let a=0;a<2;a++){
    if(typeof v!=="string")break;
    const s=v.trim();if(!s)return{};
    try{v=JSON.parse(s);}catch(e){return{};}
  }
  if(v===null||v===undefined)return{};
  const out={};
  if(Array.isArray(v)){v.forEach((x,i)=>{out[String(i+1)]=x;});return out;}
  if(typeof v==="object"){
    const keys=Object.keys(v);
    const allNum=keys.length>0&&keys.every(k=>/^\d+$/.test(k));
    if(allNum){
      const nums=keys.map(k=>parseInt(k,10)).sort((a,b)=>a-b);
      const shift=(nums[0]===0)?1:0;
      keys.forEach(k=>{out[String(parseInt(k,10)+shift)]=v[k];});
      return out;
    }
    for(const k in v)out[k]=v[k];
    return out;
  }
  return{"1":v};
}
// 이중 인코딩 JSON 문서 안전 파싱 (sets/questions 등 포함한 전체 문서)
function parseAnswerDoc(raw){
  if(raw===null||raw===undefined||raw==="")return null;
  let v=raw;
  for(let a=0;a<3;a++){
    if(typeof v!=="string")break;
    const s=v.trim();if(!s)return null;
    try{v=JSON.parse(s);}catch(e){return null;}
  }
  return v;
}
const T={gold:"#D4A017",goldDark:"#B8860B",goldDeep:"#8B6914",goldLight:"#FFF3D0",goldPale:"#FFFBF0",goldMuted:"#F5E6B8",bg:"#FAFAF7",text:"#1A1A1A",textSub:"#5C5C5C",textMuted:"#999999",border:"#E8E4DA",borderLight:"#F0EDE4",accent:"#2E7D32",accentLight:"#E8F5E9",danger:"#C62828",dangerLight:"#FFEBEE",white:"#FFFFFF",blue:"#1E40AF",blueLight:"#DBEAFE"};
function Chip({label,req,opts,val,onChange,custom:allowC}){
  const[c,setC]=useState(false);const[cv,setCv]=useState("");
  const h=o=>{if(o==="기타"&&allowC){setC(true);onChange("");}else{setC(false);setCv("");onChange(val===o?"":o);}};
  return(<div style={{marginBottom:14}}>
    <div style={S.label}>{label} {req&&<span style={{color:T.danger}}>*</span>}</div>
    <div style={S.cw}>{opts.map(o=>{const a=(!c&&val===o)||(c&&o==="기타");return(<button key={o} onClick={()=>h(o)} style={{...S.ch,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,borderColor:a?T.goldDark:T.border,fontWeight:a?700:500}}>{o}</button>);})}</div>
    {c&&allowC&&<input style={{...S.inp,marginTop:6}} placeholder="직접 입력" value={cv} onChange={e=>{setCv(e.target.value);onChange(e.target.value);}}/>}
  </div>);
}
// ★ v12.1: 시험 종류 4분류 선택기 (정규/주기/영역별/기타)
function ExamTypeSelect({val,onChange}){
  // 현재 val이 어느 카테고리에 속하는지 자동 감지, 없으면 "기타"
  const findCat=(v)=>{
    for(let i=0;i<EXAM_TYPE_CATS.length-1;i++){
      if(EXAM_TYPE_CATS[i].types.includes(v))return EXAM_TYPE_CATS[i].key;
    }
    return "기타";
  };
  const [activeCat,setActiveCat]=useState(()=>val?findCat(val):"정규");
  const [customVal,setCustomVal]=useState(()=>{
    // 기타 카테고리면서 val이 있으면 직접입력 상태
    if(val&&findCat(val)==="기타"&&val!=="기타")return val;
    return "";
  });
  const currentCat=EXAM_TYPE_CATS.find(c=>c.key===activeCat);
  const isCustom=activeCat==="기타";
  return(<div style={{marginBottom:14}}>
    <div style={S.label}>시험 종류 <span style={{color:T.danger}}>*</span></div>
    {/* 카테고리 탭 */}
    <div style={{display:"flex",gap:4,marginBottom:8}}>
      {EXAM_TYPE_CATS.map(c=>(
        <button key={c.key} onClick={()=>{setActiveCat(c.key);if(c.key!=="기타"&&!c.types.includes(val))onChange("");}} style={{flex:1,padding:"7px 4px",fontSize:11,fontWeight:700,borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",background:activeCat===c.key?T.goldDark:T.white,color:activeCat===c.key?T.white:T.textSub,boxShadow:activeCat===c.key?"none":`inset 0 0 0 1.2px ${T.border}`}}>{c.label}</button>
      ))}
    </div>
    {/* 카테고리별 옵션 */}
    {!isCustom&&(
      <div style={S.cw}>
        {currentCat.types.map(o=>{
          const a=val===o;
          return(<button key={o} onClick={()=>onChange(val===o?"":o)} style={{...S.ch,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,borderColor:a?T.goldDark:T.border,fontWeight:a?700:500}}>{o}</button>);
        })}
      </div>
    )}
    {isCustom&&(
      <input style={{...S.inp}} placeholder="직접 입력 (예: 단원평가, 쪽지시험 등)" value={customVal||val||""} onChange={e=>{setCustomVal(e.target.value);onChange(e.target.value);}}/>
    )}
  </div>);
}
function FileUploadMulti({label,req,files,onFilesChange,accept}){
  const[drag,setDrag]=useState(false);
  const add=nf=>{const arr=Array.from(nf);const ex=files.map(f=>f.name);const fil=arr.filter(f=>!ex.includes(f.name));if(fil.length>0)onFilesChange([...files,...fil]);};
  const hChange=e=>{if(e.target.files)add(e.target.files);e.target.value="";};
  const hRemove=i=>onFilesChange(files.filter((_,idx)=>idx!==i));
  return(<div style={{marginBottom:16}}>
    <div style={S.label}>{label} {req&&<span style={{color:T.danger}}>*</span>} <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:4}}>여러 파일 가능</span></div>
    <label style={{...S.uploadBox,borderColor:drag?T.gold:T.border,background:drag?T.goldLight:T.bg}}
      onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={e=>{e.preventDefault();setDrag(false);}}
      onDrop={e=>{e.preventDefault();setDrag(false);if(e.dataTransfer.files)add(e.dataTransfer.files);}}>
      <input type="file" accept={accept} onChange={hChange} multiple style={{display:"none"}}/>
      <div style={{fontSize:28,marginBottom:6}}>{drag?"📥":"📄"}</div>
      <div style={{fontSize:13,fontWeight:600,color:drag?T.goldDark:T.textSub}}>{drag?"여기에 놓으세요!":"파일을 드래그하거나 클릭하세요"}</div>
      <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>PDF, DOCX, JPG, PNG</div>
    </label>
    {files.length>0&&<div style={{marginTop:8,display:"flex",flexDirection:"column",gap:6}}>
      {files.map((f,i)=>(<div key={i} style={S.fileCard}><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:T.text}}>{f.name}</div><div style={{fontSize:11,color:T.textMuted}}>{(f.size/1024).toFixed(0)}KB</div></div>
        <button onClick={()=>hRemove(i)} style={S.rmBtn}>✕</button></div>))}
    </div>}
  </div>);
}
function fileToBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});}
/* ═══ 일괄 프린트 탭 ═══ */
function PrintTab({sheetsUrl, T, S}){
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;});
  const load = useCallback(async()=>{
    setLoading(true);
    try{
      const r = await fetch(`${sheetsUrl}?action=list_print_jobs&date=${encodeURIComponent(date)}`);
      const j = await r.json();
      setJobs(j.jobs || []);
    }catch(e){ setJobs([]); }
    setLoading(false);
  }, [date, sheetsUrl]);
  useEffect(()=>{ load(); }, [load]);
  const dlFile = async(id, name)=>{
    try{
      const r = await fetch(`${sheetsUrl}?action=download_file&id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if(j.result !== "ok"){ alert("다운로드 실패: "+(j.message||"")); return; }
      const bin = atob(j.data);
      const bytes = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {type: j.mimeType||"application/octet-stream"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    }catch(e){ alert("다운로드 오류: "+e); }
  };
  const dlAll = async(job)=>{ for(const f of job.files){ await dlFile(f.id, f.name); await new Promise(r=>setTimeout(r,300)); } };
  const dlAllJobs = async()=>{ for(const job of jobs){ await dlAll(job); } };
  const totalCopies = jobs.reduce((s,j)=>s+(j.count||0)*(j.files.length||0), 0);
  const totalFiles = jobs.reduce((s,j)=>s+(j.files.length||0), 0);
  return (<div style={S.wrap} className="fade-up">
    <div style={{textAlign:"center",padding:"20px 0 12px"}}>
      <div style={{fontSize:36,marginBottom:4}}>🖨️</div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text}}>일괄 프린트</h1>
      <p style={{fontSize:13,color:T.textMuted}}>오늘 프린트할 시험지를 한 번에 다운받으세요</p>
    </div>
    <div style={S.card}>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{...S.inp, width:"auto", flex:1}}/>
        <button onClick={load} style={{...S.btnO, padding:"10px 14px"}}>🔄 새로고침</button>
      </div>
      <div style={{fontSize:13,color:T.textSub,marginBottom:6}}>
        📋 시험 {jobs.length}건 · 파일 {totalFiles}개 · 예상 출력 <b style={{color:T.goldDark}}>{totalCopies}매</b>
      </div>
      {jobs.length>0 && <button onClick={dlAllJobs} style={{...S.btnG, width:"100%", background:T.blue}}>📥 전체 다운로드 ({totalFiles}개 파일)</button>}
    </div>
    {loading ? <div style={{textAlign:"center",padding:30,color:T.textMuted}}>로딩 중…</div> :
     jobs.length === 0 ? <div style={{textAlign:"center",padding:30,color:T.textMuted}}>오늘 프린트할 시험지가 없습니다.</div> :
     jobs.map((job, i) => (
      <div key={i} style={{...S.card, marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8}}>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:T.text}}>{job.subject} {job.grade} {job.level} · {job.examType}{job.round?` (${job.round})`:""}</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2}}>👤 {job.teacher} · 예상 <b style={{color:T.goldDark}}>{job.count}명</b> · 파일 {job.files.length}개 → <b>{job.count * job.files.length}매</b></div>
          </div>
          <button onClick={()=>dlAll(job)} style={{padding:"6px 12px",fontSize:12,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer"}}>📥 전체</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {job.files.map((f, fi) => (
            <div key={fi} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:T.bg,borderRadius:6,fontSize:12}}>
              <span style={{color:T.textSub,flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>📄 {f.name}</span>
              <button onClick={()=>dlFile(f.id, f.name)} style={{padding:"2px 8px",fontSize:11,border:`1px solid ${T.border}`,background:T.white,borderRadius:4,cursor:"pointer"}}>⬇</button>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>);
}
/* ═══ 📚 문제 생성기 탭 ═══ */
function GeneratorTab({sheetsUrl, T, S, teacherList: _tl}){
  // ── 상태 ──
  const[step,setStep]=useState(1); // 1:설정, 2:확인, 3:결과
  const[textbook,setTextbook]=useState("");
  const[rangeType,setRangeType]=useState("chapter"); // chapter | page
  const[chapters,setChapters]=useState([]); // 선택된 챕터 인덱스 배열
  const[pageFrom,setPageFrom]=useState("");
  const[pageTo,setPageTo]=useState("");
  const[testType,setTestType]=useState("grammar"); // grammar | vocab
  const[questionCount,setQuestionCount]=useState(20);
  const[diffEasy,setDiffEasy]=useState(30);
  const[diffMed,setDiffMed]=useState(50);
  const[diffHard,setDiffHard]=useState(20);
  // 반 선택 (시험등록과 동일 방식)
  const[genSubject,setGenSubject]=useState("");
  const[genGrade,setGenGrade]=useState("");
  const[genLevel,setGenLevel]=useState("");
  const[genLevelCustom,setGenLevelCustom]=useState("");
  const[genLevelCat,setGenLevelCat]=useState("level");
  const[genLevelMulti,setGenLevelMulti]=useState([]); // ★ 다중선택 (레벨/중/고)
  const[genClasses,setGenClasses]=useState([]); // [{subject,grade,level,name}]
  // ★ 문제 생성 — 시험 구분 (이론편/실전편/혼합)
  const[genSetType,setGenSetType]=useState("");
  const GEN_SET_TYPES=["이론편","실전편","혼합"];
  const[targetTeacher,setTargetTeacher]=useState("");
  const[mcRatio,setMcRatio]=useState(100); // 객관식 비율 (0~100), 기본 100%
  const[customQCount,setCustomQCount]=useState(""); // 직접입력 문제수
  const[memo,setMemo]=useState("");
  const[sending,setSending]=useState(false);
  const[sentOk,setSentOk]=useState(false);
  // 교재 목록 (서버에서 동적 로딩)
  const[textbookList,setTextbookList]=useState([]);
  const[tbLoading,setTbLoading]=useState(false);
  const[tbError,setTbError]=useState("");
  const[uploading,setUploading]=useState(false);
  // 히스토리 (생성 요청 목록)
  const[history,setHistory]=useState([]);
  const[histLoading,setHistLoading]=useState(false);
  // 미리보기 (3세트: A/B/C)
  const[preview,setPreview]=useState(null); // {detail, sets:[{questions},..]}
  const[prevLoading,setPrevLoading]=useState(false);
  const[prevRow,setPrevRow]=useState(null);
  const[selectedSet,setSelectedSet]=useState(0); // 0=A, 1=B, 2=C
  // ★ v15: 검수 결과 모달 (verification 상세)
  const[verifyModal,setVerifyModal]=useState(null); // null | {row, verification, startNumber, totalQuestions}
  // 반 추가 핸들러 — 다중학교 지원
  const addGenClass=()=>{
    if(!genSubject)return alert("과목을 선택하세요.");
    if(!genGrade)return alert("학년을 선택하세요.");
    if(/^(초|중|고)$/.test(genGrade))return alert("학년을 선택하세요. (예: 1학년, 2학년…)");
    let lv, displayName;
    if((genLevelCat==="middle"||genLevelCat==="high"||genLevelCat==="level")&&genLevelMulti.length>0){
      lv=genLevelMulti.join(",");
      displayName=genLevelMulti.join("+");
    }else{
      const single=genLevelCat==="etc"?genLevelCustom:"";
      if(!single)return alert("레벨/학교를 선택하세요.");
      lv=single;displayName=single;
    }
    const name=`${genSubject} ${genGrade} ${displayName}반`;
    if(genClasses.some(c=>c.name===name))return alert("이미 추가된 반입니다.");
    if(genLevelMulti.length>=2){
      const ok=window.confirm(`다음 ${genLevelMulti.length}개를 하나의 반으로 등록합니다:\n\n  ${genLevelMulti.join(" + ")}\n\n⚠ 반드시 **같은 시험지**를 공유할 때만 사용하세요.\n\n계속하시겠습니까?`);
      if(!ok)return;
    }
    setGenClasses(p=>[...p,{subject:genSubject,grade:genGrade,level:lv,name}]);
    setGenLevel("");setGenLevelCustom("");setGenLevelMulti([]);
  };
  // ── 교재 목록 (서버에서 동적 로딩) ──
  const loadTextbooks=useCallback(()=>{
    setTbLoading(true);setTbError("");
    fetch(sheetsUrl+"?action=list_textbooks")
      .then(r=>r.json())
      .then(d=>{
        if(d.result==="ok"&&Array.isArray(d.textbooks)){
          setTextbookList(d.textbooks);
        }else{
          setTbError(d.message||"교재 목록 로딩 실패");
        }
      })
      .catch(e=>setTbError("네트워크 오류: "+String(e)))
      .finally(()=>setTbLoading(false));
  },[sheetsUrl]);
  useEffect(()=>{loadTextbooks();},[loadTextbooks]);
  // 교재 업로드 핸들러
  const handleUploadTextbook=(e)=>{
    const file=e.target.files&&e.target.files[0];
    if(!file)return;
    if(!file.name.toLowerCase().endsWith(".pdf")){alert("PDF 파일만 업로드할 수 있습니다.");return;}
    if(file.size>50*1024*1024){alert("파일이 너무 큽니다 (최대 50MB).");return;}
    setUploading(true);
    const reader=new FileReader();
    reader.onload=()=>{
      const base64=reader.result.split(",")[1];
      fetch(sheetsUrl,{method:"POST",headers:{"Content-Type":"text/plain"},
        body:JSON.stringify({action:"upload_textbook",fileName:file.name,fileData:base64,name:file.name.replace(/\.pdf$/i,"").replace(/_/g," ")})
      }).then(r=>r.json()).then(d=>{
        if(d.result==="ok"){
          alert("교재가 등록되었습니다: "+d.textbook.name);
          loadTextbooks();
        }else{alert("업로드 실패: "+(d.message||"알 수 없는 오류"));}
      }).catch(err=>alert("업로드 오류: "+String(err)))
        .finally(()=>setUploading(false));
    };
    reader.readAsDataURL(file);
    e.target.value=""; // reset input
  };
  const TEXTBOOKS=textbookList;
  const selBook=TEXTBOOKS.find(b=>b.id===textbook);
  // 챕터 토글
  const toggleCh=(idx)=>setChapters(p=>p.includes(idx)?p.filter(i=>i!==idx):[...p,idx].sort((a,b)=>a-b));
  // 난이도 슬라이더 핸들러 (합계 100% 유지)
  const adjustDiff=(type,val)=>{
    val=Math.max(0,Math.min(100,val));
    if(type==="easy"){
      const remain=100-val;
      const ratio=diffMed+diffHard>0?diffMed/(diffMed+diffHard):0.5;
      setDiffEasy(val);setDiffMed(Math.round(remain*ratio));setDiffHard(remain-Math.round(remain*ratio));
    }else if(type==="med"){
      const remain=100-val;
      const ratio=diffEasy+diffHard>0?diffEasy/(diffEasy+diffHard):0.5;
      setDiffMed(val);setDiffEasy(Math.round(remain*ratio));setDiffHard(remain-Math.round(remain*ratio));
    }else{
      const remain=100-val;
      const ratio=diffEasy+diffMed>0?diffEasy/(diffEasy+diffMed):0.5;
      setDiffHard(val);setDiffEasy(Math.round(remain*ratio));setDiffMed(remain-Math.round(remain*ratio));
    }
  };
  // 생성 요청
  const submit=async()=>{
    if(!textbook)return alert("교재를 선택하세요.");
    const hasChapters=selBook&&selBook.chapters&&selBook.chapters.length>0;
    if(rangeType==="chapter"&&hasChapters&&chapters.length===0)return alert("챕터를 1개 이상 선택하세요.");
    if((rangeType==="page"||!hasChapters)&&(!pageFrom||!pageTo))return alert("페이지 범위를 입력하세요.");
    if(!targetTeacher)return alert("선생님 이름을 선택하세요.");
    if(genClasses.length===0)return alert("대상 반을 1개 이상 추가하세요.");
    setSending(true);
    try{
      const effectiveRange=hasChapters?rangeType:"page";
      const rangeDesc=effectiveRange==="chapter"
        ?(selBook.chapters||[]).filter((_,i)=>chapters.includes(i)).join(", ")
        :`p.${pageFrom}~${pageTo}`;
      const body={
        action:"request_exam_gen",
        textbook:selBook.name,
        textbookId:textbook,
        textbookFileId:selBook.fileId||"",
        rangeType,
        rangeDesc,
        chapters:rangeType==="chapter"?(selBook.chapters||[]).filter((_,i)=>chapters.includes(i)):[],
        pageFrom:rangeType==="page"?pageFrom:"",
        pageTo:rangeType==="page"?pageTo:"",
        testType,
        questionCount,
        difficulty:{easy:diffEasy,medium:diffMed,hard:diffHard},
        mcRatio,
        targetClass:genClasses.map(c=>c.name).join(", "),
        teacher:targetTeacher,
        setType:genSetType||"",   // ★ 이론편 / 실전편 / 혼합 (선택)
        memo,
      };
      await fetch(sheetsUrl,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      setSentOk(true);setStep(3);
    }catch(e){alert("요청 실패: "+e);}
    setSending(false);
  };
  // 미리보기 로드 (Drive 파일 + 시트 정답데이터 두 경로 지원)
  const loadPreview=async(rowIndex)=>{
    setPrevLoading(true);setPrevRow(rowIndex);setSelectedSet(0);
    try{
      const r=await fetch(`${sheetsUrl}?action=get_exam_gen_detail&rowIndex=${rowIndex}`);
      const d=await r.json();
      if(d.result==="ok"&&d.detail){
        let sets=[];
        const det=d.detail;
        // type 정규화: "multiple_choice" → "mc"
        const normT=(t)=>t==="multiple_choice"||t==="mc"||t==="obj"?"mc":"sub";
        const normSet=(s,i)=>({
          style:s.style||s.setName||`스타일 ${["A","B","C"][i]}`,
          questions:(s.questions||[]).map(q=>({...q,type:normT(q.type||"mc")}))
        });
        // 경로 1: Drive 파일에서 전체 문제 로드 (questions 필드)
        if(det.questions){
          // ★ parseAnswerDoc 으로 이중 인코딩 한 번에 처리
          const raw=typeof det.questions==="string"?parseAnswerDoc(det.questions):det.questions;
          if(raw&&raw.sets&&Array.isArray(raw.sets)){
            sets=raw.sets.map(normSet);
          }else if(raw&&raw.sets&&typeof raw.sets==="object"&&!Array.isArray(raw.sets)){
            sets=Object.values(raw.sets).map(normSet);
          }else if(raw&&raw.questions&&Array.isArray(raw.questions)){
            sets=[normSet(raw,0)];
          }else if(Array.isArray(raw)){
            sets=raw.map(normSet);
          }
        }
        // 경로 2: 시트에 저장된 정답데이터 (answerData 필드) — Drive 실패 시 fallback
        if(sets.length===0&&det.answerData){
          // ★ parseAnswerDoc 으로 이중 인코딩 한 번에 처리
          let ad=typeof det.answerData==="string"?parseAnswerDoc(det.answerData):det.answerData;
          if(!ad)ad={};
          const makeQs=(answers,types,qCount)=>(answers||[]).map((ans,qi)=>({
            number:qi+1,
            difficulty:qi<(qCount||20)*0.3?"easy":qi<(qCount||20)*0.7?"medium":"hard",
            type:(types||[])[qi]==="sub"?"sub":"mc",
            question:`문제 ${qi+1}`,
            choices:(types||[])[qi]==="sub"?[]:["①","②","③","④","⑤"],
            answer:ans,
            explanation:""
          }));
          // type 정규화: "multiple_choice" → "mc", "subjective" → "sub"
          const normType=(t)=>t==="multiple_choice"||t==="mc"||t==="obj"?"mc":"sub";
          // sets 배열에서 questions 객체를 가져오는 공통 함수
          const extractSets=(setsArr)=>setsArr.map((s,i)=>{
            // 포맷 A: {questions:[{number,answer,type,question,choices,...}]} — 스케줄 태스크가 보내는 형식
            if(s.questions&&Array.isArray(s.questions)&&s.questions.length>0){
              return{style:s.style||s.setName||`스타일 ${["A","B","C"][i]}`,questions:s.questions.map(q=>({
                ...q,type:normType(q.type||"mc")
              }))};
            }
            // 포맷 B: {answers:[], types:[]} — 간략 정답 데이터
            if(s.answers&&Array.isArray(s.answers)){
              return{style:s.style||s.setName||`스타일 ${["A","B","C"][i]}`,questions:makeQs(s.answers,s.types,det.questionCount)};
            }
            return{style:s.style||s.setName||`스타일 ${["A","B","C"][i]}`,questions:[]};
          });
          // 포맷 1: {sets: [...]} — 배열
          if(ad.sets&&Array.isArray(ad.sets)){
            sets=extractSets(ad.sets);
          }
          // 포맷 2: {sets: {A:{...}, B:{...}, ...}} — 객체
          else if(ad.sets&&typeof ad.sets==="object"&&!Array.isArray(ad.sets)){
            sets=extractSets(Object.values(ad.sets));
          }
          // 포맷 3: 루트가 배열 [{questions,...}, ...]
          else if(Array.isArray(ad)){
            sets=extractSets(ad);
          }
          // 포맷 4: flat — {answers:[], types:[]} 단일 세트
          else if(ad.answers&&Array.isArray(ad.answers)){
            sets=[{style:"A",questions:makeQs(ad.answers,ad.types,det.questionCount)}];
          }
          // 포맷 5: questions 배열 직접 포함 — {questions:[{number,answer,...},...]}
          else if(ad.questions&&Array.isArray(ad.questions)){
            sets=[{style:"A",questions:ad.questions.map(q=>({...q,type:normType(q.type||"mc")}))}];
          }
        }
        setPreview({...det, sets, _source:det.questionsSource||"none", _error:det.questionsError||"", answerDataInfo:det.answerDataInfo||null, answerDataRaw:det.answerDataRaw||""});
        setStep(4);
      }else{alert("상세 조회 실패: "+(d.message||""));}
    }catch(e){alert("조회 오류: "+e);}
    setPrevLoading(false);
  };
  // 문제 다시 내기 (재생성 요청)
  const requestRegenerate=async(rowIndex)=>{
    if(!confirm("이 시험 문제를 새로 만들까요?\n(기존 문제는 사라지고 약 10분 후 새 문제가 생성됩니다)"))return;
    setSending(true);
    try{
      await fetch(`${sheetsUrl}?action=update_exam_gen_status&rowIndex=${rowIndex}&status=대기`);
      alert("재생성 요청 완료! 약 10분 후 새 문제가 만들어집니다.");
      setStep(1);setPreview(null);loadHistory();
    }catch(e){alert("요청 실패: "+e);}
    setSending(false);
  };
  // ★ 학생앱 자동 등록 (완료된 시험을 정답목록에 등록)
  const autoRegisterForStudents=async(rowIndex)=>{
    try{
      const r=await fetch(`${sheetsUrl}?action=auto_register_exam_gen&rowIndex=${rowIndex}`);
      const d=await r.json();
      if(d.result==="ok"){alert("✅ 학생앱에 등록 완료! 학생들이 시험을 찾을 수 있어요.");}
      else{alert("등록 실패: "+(d.message||""));}
    }catch(e){alert("등록 오류: "+e);}
  };
  // ★ v14: A세트 ↔ B세트 교체 (백업 세트로 swap)
  const swapExamSet=async(rowIndex,activeNow)=>{
    const targetLabel=activeNow==="A"?"B":"A";
    if(!confirm(`현재 ${activeNow}세트가 학생앱에 노출 중입니다.\n${targetLabel}세트로 교체하시겠습니까?\n\n학생들이 보는 시험 문제가 즉시 바뀝니다.`))return;
    try{
      const r=await fetch(sheetsUrl,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"swap_exam_set",rowIndex})});
      // no-cors라 응답 못 읽음 → 낙관적 처리 + 새로고침
      alert(`✅ ${targetLabel}세트로 교체 요청을 보냈습니다.\n잠시 후 새로고침하면 바뀐 결과가 보입니다.`);
      setTimeout(loadHistory,1500);
    }catch(e){alert("교체 오류: "+e);}
  };
  // 생성 요청 삭제
  const deleteExamGen=async(rowIndex)=>{
    if(!confirm("이 생성 요청을 삭제하시겠습니까?\n(삭제 후 복구할 수 없습니다)"))return;
    try{
      const r=await fetch(`${sheetsUrl}?action=delete_exam_gen&rowIndex=${rowIndex}`);
      const d=await r.json();
      if(d.result==="ok"){loadHistory();}
      else{alert("삭제 실패: "+(d.message||""));}
    }catch(e){alert("삭제 오류: "+e);}
  };
  // OMR 시험 등록 (선택한 세트의 문제를 정답목록에 저장)
  const registerExam=async()=>{
    if(!preview||!preview.sets||preview.sets.length===0)return alert("문제 데이터가 없습니다.");
    const chosenSet=preview.sets[selectedSet];
    if(!chosenSet)return alert("세트를 선택하세요.");
    const qs=chosenSet.questions||[];
    if(qs.length===0)return alert("문제가 없습니다.");
    // ★ 정답을 객체 형태로 변환 (1-based 키) — 학생앱 채점 호환
    const answersObj={};const typesObj={};
    qs.forEach((q,i)=>{
      const qNum=String(q.number||(i+1));
      answersObj[qNum]=q.type==="mc"?q.answer:String(q.answer||"");
      typesObj[qNum]=q.type==="mc"?"obj":"sub";
    });
    setSending(true);
    try{
      // targetClass에서 과목/학년/레벨 추출 (예: "영어 중3 A반" → subject="영어", grade="중3", level="A")
      const tcParts=(preview.targetClass||"").split(/\s+/);
      const regSubject=tcParts[0]||"영어";
      const regGrade=tcParts[1]||"";
      const regLevel=(tcParts[2]||"").replace(/반$/,"");
      // 문제생성기 경로: setType(이론편/실전편/혼합)이 있으면 우선 사용, 없으면 세트 A/B/C 라벨
      const _pgSetType=(preview.setType||"").trim();
      await fetch(sheetsUrl,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:"save_answer_key",
          subject:regSubject,
          grade:regGrade,
          level:regLevel,
          examType:"문제생성기",
          setType:_pgSetType,
          round:_pgSetType||`세트${["A","B","C"][selectedSet]}`,
          totalQuestions:qs.length,
          answers:answersObj,
          types:typesObj,
          teacher:preview.teacher||"",
          studentCount:0,
          className:preview.targetClass||"",
          date:new Date().toISOString().split("T")[0].replace(/-/g,".")
        })});
      alert(`${_pgSetType||("세트 "+["A","B","C"][selectedSet])}로 시험이 등록되었습니다! 학생들이 선택할 수 있어요.`);
      setStep(1);setPreview(null);loadHistory();
    }catch(e){alert("등록 실패: "+e);}
    setSending(false);
  };
  // 히스토리 로드
  const loadHistory=useCallback(async()=>{
    setHistLoading(true);
    try{
      const r=await fetch(`${sheetsUrl}?action=list_exam_gen`);
      const d=await r.json();
      setHistory(d.requests||[]);
    }catch(e){setHistory([]);}
    setHistLoading(false);
  },[sheetsUrl]);
  useEffect(()=>{loadHistory();},[loadHistory]);
  // 난이도 바 컴포넌트
  const DiffBar=()=>{
    const eQ=Math.round(questionCount*diffEasy/100);
    const mQ=Math.round(questionCount*diffMed/100);
    const hQ=questionCount-eQ-mQ;
    return(<div style={{marginTop:8}}>
      <div style={{display:"flex",height:28,borderRadius:8,overflow:"hidden",border:`1px solid ${T.border}`}}>
        <div style={{width:`${diffEasy}%`,background:"#81C784",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",minWidth:diffEasy>8?30:0,transition:"width .2s"}}>{diffEasy>8?`쉬움 ${eQ}`:""}</div>
        <div style={{width:`${diffMed}%`,background:"#FFB74D",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",minWidth:diffMed>8?30:0,transition:"width .2s"}}>{diffMed>8?`보통 ${mQ}`:""}</div>
        <div style={{width:`${diffHard}%`,background:"#E57373",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",minWidth:diffHard>8?30:0,transition:"width .2s"}}>{diffHard>8?`어려움 ${hQ}`:""}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:10}}>
        {[{label:"★☆☆ 쉬움",color:"#4CAF50",val:diffEasy,set:v=>adjustDiff("easy",v)},
          {label:"★★☆ 보통",color:"#FF9800",val:diffMed,set:v=>adjustDiff("med",v)},
          {label:"★★★ 어려움",color:"#F44336",val:diffHard,set:v=>adjustDiff("hard",v)}
        ].map((d,i)=>(<div key={i} style={{textAlign:"center"}}>
          <div style={{fontSize:11,fontWeight:600,color:d.color,marginBottom:4}}>{d.label}</div>
          <input type="range" min={0} max={100} step={5} value={d.val}
            onChange={e=>d.set(parseInt(e.target.value))}
            style={{width:"100%",accentColor:d.color}}/>
          <div style={{fontSize:13,fontWeight:700,color:d.color}}>{d.val}% ({Math.round(questionCount*d.val/100)}문제)</div>
        </div>))}
      </div>
    </div>);
  };
  // ── Step 1: 설정 화면 ──
  if(step===1) return(<div style={S.wrap} className="fade-up">
    <div style={{textAlign:"center",padding:"20px 0 12px"}}>
      <div style={{fontSize:36,marginBottom:4}}>📚</div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text}}>문제 생성기</h1>
      <p style={{fontSize:13,color:T.textMuted}}>교재에서 자동으로 시험 문제를 만듭니다</p>
    </div>
    {/* 교재 선택 */}
    <div style={S.card}>
      <div style={S.secLabel}>교재 선택</div>
      {tbLoading?(<div style={{fontSize:13,color:T.textMuted,padding:"12px 0"}}>교재 목록 불러오는 중...</div>)
      :tbError?(<div style={{fontSize:13,color:T.danger,padding:"12px 0"}}>{tbError} <button onClick={loadTextbooks} style={{fontSize:12,color:T.blue,border:"none",background:"none",cursor:"pointer",textDecoration:"underline"}}>다시 시도</button></div>)
      :(<>
        <select style={S.inp} value={textbook} onChange={e=>{
          const val=e.target.value;setTextbook(val);setChapters([]);
          const bk=TEXTBOOKS.find(b=>b.id===val);
          if(bk&&(!bk.chapters||bk.chapters.length===0))setRangeType("page");
        }}>
          <option value="">-- 교재를 선택하세요 ({TEXTBOOKS.length}권) --</option>
          {TEXTBOOKS.map(b=><option key={b.id} value={b.id}>{b.name}{b.totalPages?` (${b.totalPages}쪽)`:""}</option>)}
        </select>
        {TEXTBOOKS.length===0&&<div style={{fontSize:12,color:T.textMuted,marginTop:6}}>등록된 교재가 없습니다. 아래에서 PDF를 업로드하거나, Google Drive의 "채움학원 시험자료/교재" 폴더에 PDF를 넣어주세요.</div>}
      </>)}
      {/* 교재 추가 영역 */}
      <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${T.borderLight}`}}>
        <div style={{fontSize:12,fontWeight:600,color:T.textSub,marginBottom:8}}>교재 추가하기</div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <label style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",fontSize:13,fontWeight:600,borderRadius:10,border:`1.5px solid ${T.goldDark}`,background:T.goldLight,color:T.goldDark,cursor:uploading?"wait":"pointer"}}>
            {uploading?"업로드 중...":"📤 PDF 업로드"}
            <input type="file" accept=".pdf" onChange={handleUploadTextbook} disabled={uploading} style={{display:"none"}} />
          </label>
          <span style={{fontSize:11,color:T.textMuted}}>또는 Google Drive "채움학원 시험자료/교재" 폴더에 직접 넣으면 자동 감지됩니다</span>
        </div>
        {TEXTBOOKS.length>0&&!tbLoading&&<button onClick={loadTextbooks} style={{marginTop:8,fontSize:11,color:T.blue,border:"none",background:"none",cursor:"pointer",textDecoration:"underline",padding:0}}>🔄 교재 목록 새로고침</button>}
      </div>
    </div>
    {/* 범위 설정 */}
    {textbook&&selBook&&<div style={S.card}>
      <div style={S.secLabel}>범위 설정</div>
      {selBook.chapters&&selBook.chapters.length>0?(
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[{k:"chapter",label:"📖 챕터로 선택"},{k:"page",label:"📄 페이지로 선택"}].map(r=>(
          <button key={r.k} onClick={()=>setRangeType(r.k)} style={{flex:1,padding:"10px",fontSize:13,fontWeight:rangeType===r.k?700:500,borderRadius:10,border:`1.5px solid ${rangeType===r.k?T.goldDark:T.border}`,background:rangeType===r.k?T.goldDark:T.white,color:rangeType===r.k?T.white:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>{r.label}</button>
        ))}
      </div>
      ):(<div style={{marginBottom:8}}>
        <div style={{fontSize:12,color:T.textMuted,marginBottom:8}}>이 교재는 아직 챕터 정보가 없습니다. 아래 버튼으로 챕터를 분석하거나 페이지 범위로 선택하세요.</div>
        <button onClick={async()=>{
          if(!selBook)return;
          const chStr=prompt("챕터 목록을 입력하세요.\n각 챕터를 || 로 구분 (예: Chapter1.동사(p.4)||Chapter2.명사(p.6))\n\n또는 Claude Cowork에서 교재 분석 후 자동 등록됩니다.");
          if(!chStr||!chStr.trim())return;
          try{
            const r=await fetch(`${sheetsUrl}?action=update_textbook_chapters&textbookId=${encodeURIComponent(selBook.id)}&chapters=${encodeURIComponent(chStr.trim())}`);
            const d=await r.json();
            if(d.result==="ok"){alert("챕터 등록 완료! 목록을 새로고침합니다.");loadTextbooks();}
            else alert("챕터 등록 실패: "+(d.message||""));
          }catch(e){alert("오류: "+e);}
        }} style={{padding:"8px 14px",fontSize:12,fontWeight:600,borderRadius:10,border:`1.5px solid ${T.goldDark}`,background:T.goldLight,color:T.goldDark,cursor:"pointer",fontFamily:"inherit",marginBottom:8}}>📖 챕터 직접 등록하기</button>
      </div>)}
      {rangeType==="chapter"&&selBook.chapters&&selBook.chapters.length>0?(<div>
        <div style={{fontSize:12,color:T.textMuted,marginBottom:8}}>챕터를 선택하세요 (여러 개 가능)</div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {selBook.chapters.map((ch,i)=>{
            const sel=chapters.includes(i);
            return(<button key={i} onClick={()=>toggleCh(i)} style={{
              padding:"10px 14px",fontSize:13,fontWeight:sel?700:500,borderRadius:10,
              border:`1.5px solid ${sel?T.goldDark:T.border}`,background:sel?T.goldLight:T.white,
              color:sel?T.goldDeep:T.textSub,cursor:"pointer",fontFamily:"inherit",textAlign:"left",
              transition:"all .12s"
            }}>{sel?"✅ ":"　"}{ch}</button>);
          })}
        </div>
        {chapters.length>0&&<div style={{marginTop:8,fontSize:12,fontWeight:600,color:T.goldDark}}>
          선택: {chapters.length}개 챕터
        </div>}
      </div>):(<div>
        <div style={{fontSize:12,color:T.textMuted,marginBottom:8}}>페이지 범위를 입력하세요{selBook.totalPages?` (1~${selBook.totalPages})`:""}</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input style={{...S.inp,maxWidth:100,textAlign:"center"}} placeholder="시작" value={pageFrom}
            onChange={e=>setPageFrom(e.target.value.replace(/[^0-9]/g,""))} inputMode="numeric"/>
          <span style={{fontSize:14,color:T.textMuted,fontWeight:600}}>~</span>
          <input style={{...S.inp,maxWidth:100,textAlign:"center"}} placeholder="끝" value={pageTo}
            onChange={e=>setPageTo(e.target.value.replace(/[^0-9]/g,""))} inputMode="numeric"/>
          <span style={{fontSize:12,color:T.textMuted}}>쪽</span>
        </div>
      </div>)}
    </div>}
    {/* 유형 설정 */}
    {textbook&&<div style={S.card}>
      <div style={S.secLabel}>시험 유형</div>
      <div style={{display:"flex",gap:6}}>
        {[{k:"grammar",icon:"📝",label:"문법/독해",desc:"객관식+주관식 혼합"},
          {k:"vocab",icon:"🔤",label:"단어 테스트",desc:"단답형 (주관식)"}
        ].map(t=>{
          const sel=testType===t.k;
          return(<button key={t.k} onClick={()=>setTestType(t.k)} style={{
            flex:1,padding:"14px 10px",borderRadius:12,
            border:`1.5px solid ${sel?T.goldDark:T.border}`,background:sel?T.goldLight:T.white,
            cursor:"pointer",fontFamily:"inherit",textAlign:"center",transition:"all .12s"
          }}>
            <div style={{fontSize:24,marginBottom:4}}>{t.icon}</div>
            <div style={{fontSize:13,fontWeight:sel?700:600,color:sel?T.goldDeep:T.text}}>{t.label}</div>
            <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>{t.desc}</div>
          </button>);
        })}
      </div>
    </div>}
    {/* 문제 수 + 난이도 + 객관식/서술형 */}
    {textbook&&<div style={S.card}>
      <div style={S.secLabel}>문제 수 · 난이도</div>
      <div style={S.label}>문제 수</div>
      <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        {[10,15,20,25,30,35,40].map(n=>{
          const sel=questionCount===n&&!customQCount;
          return(<button key={n} onClick={()=>{setQuestionCount(n);setCustomQCount("");}} style={{
            padding:"8px 14px",borderRadius:20,border:`1.5px solid ${sel?T.goldDark:T.border}`,
            background:sel?T.goldDark:T.white,color:sel?T.white:T.textSub,
            fontWeight:sel?700:500,fontSize:14,cursor:"pointer",fontFamily:"inherit"
          }}>{n}문제</button>);
        })}
        {(()=>{const sel=!!customQCount;return(<button onClick={()=>{if(!customQCount)setCustomQCount(String(questionCount));}} style={{
          padding:"8px 14px",borderRadius:20,border:`1.5px solid ${sel?T.goldDark:T.border}`,
          background:sel?T.goldDark:T.white,color:sel?T.white:T.textSub,
          fontWeight:sel?700:500,fontSize:14,cursor:"pointer",fontFamily:"inherit"
        }}>✏️ 직접입력</button>);})()}
      </div>
      {customQCount!==undefined&&customQCount!==""&&<div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16}}>
        <input style={{...S.inp,maxWidth:100,textAlign:"center",fontSize:16,fontWeight:700}} value={customQCount} inputMode="numeric"
          onChange={e=>{const v=e.target.value.replace(/[^0-9]/g,"");setCustomQCount(v);if(v&&parseInt(v)>0)setQuestionCount(parseInt(v));}}
          placeholder="문제수"/>
        <span style={{fontSize:13,color:T.textMuted,fontWeight:600}}>문제</span>
        {parseInt(customQCount)>50&&<span style={{fontSize:11,color:T.danger}}>⚠️ 50문제 이상은 생성 시간이 오래 걸릴 수 있어요</span>}
      </div>}
      <div style={S.label}>객관식 / 서술형 비율</div>
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",height:28,borderRadius:8,overflow:"hidden",border:`1px solid ${T.border}`,marginBottom:8}}>
          <div style={{width:`${mcRatio}%`,background:"#1E88E5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",minWidth:mcRatio>10?40:0,transition:"width .2s"}}>{mcRatio>10?`객관식 ${Math.round(questionCount*mcRatio/100)}`:""}</div>
          <div style={{width:`${100-mcRatio}%`,background:"#AB47BC",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",minWidth:(100-mcRatio)>10?40:0,transition:"width .2s"}}>{(100-mcRatio)>10?`서술형 ${questionCount-Math.round(questionCount*mcRatio/100)}`:""}</div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
          {[{v:100,label:"전체 객관식"},{v:80,label:"객관식 80%"},{v:60,label:"객관식 60%"},{v:50,label:"반반"},{v:0,label:"전체 서술형"}].map(o=>{
            const sel=mcRatio===o.v;
            return(<button key={o.v} onClick={()=>setMcRatio(o.v)} style={{
              padding:"6px 12px",borderRadius:16,border:`1.5px solid ${sel?"#1E88E5":T.border}`,
              background:sel?"#1E88E5":T.white,color:sel?T.white:T.textSub,
              fontWeight:sel?700:500,fontSize:12,cursor:"pointer",fontFamily:"inherit"
            }}>{o.label}</button>);
          })}
        </div>
        <input type="range" min={0} max={100} step={10} value={mcRatio}
          onChange={e=>setMcRatio(parseInt(e.target.value))}
          style={{width:"100%",accentColor:"#1E88E5"}}/>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:T.textMuted,marginTop:4}}>
          <span>객관식 {mcRatio}% ({Math.round(questionCount*mcRatio/100)}문제)</span>
          <span>서술형 {100-mcRatio}% ({questionCount-Math.round(questionCount*mcRatio/100)}문제)</span>
        </div>
      </div>
      <div style={S.label}>난이도 배분</div>
      <DiffBar/>
    </div>}
    {/* 대상 반 + 선생님 */}
    {textbook&&<div style={S.card}>
      <div style={S.secLabel}>대상 정보</div>
      {/* 선생님 드롭다운 (시험등록과 동일) */}
      <div style={{marginBottom:14}}>
        <div style={S.label}>선생님 이름 <span style={{color:T.danger}}>*</span></div>
        {_tl&&_tl.length>0?(
          <select style={S.inp} value={targetTeacher} onChange={e=>setTargetTeacher(e.target.value)}>
            <option value="">-- 선생님 선택 --</option>
            {["국어","영어","수학","과학","사회"].map(sub=>{
              const subT=_tl.filter(t=>t.subject===sub);
              if(subT.length===0)return null;
              return(<optgroup key={sub} label={sub+"과"}>{subT.map(t=>(<option key={t.name} value={t.name}>{t.name}</option>))}</optgroup>);
            })}
            {_tl.filter(t=>!["국어","영어","수학","과학","사회"].includes(t.subject)).length>0&&(
              <optgroup label="기타">{_tl.filter(t=>!["국어","영어","수학","과학","사회"].includes(t.subject)).map(t=>(<option key={t.name} value={t.name}>{t.name}</option>))}</optgroup>
            )}
          </select>
        ):(<input style={S.inp} placeholder="예: 김선생 (목록 로딩 중…)" value={targetTeacher} onChange={e=>setTargetTeacher(e.target.value)}/>)}
      </div>
      {/* 반 추가 (시험등록과 동일 방식) */}
      <div style={{marginBottom:14}}>
        <div style={S.label}>과목 <span style={{color:T.danger}}>*</span></div>
        <div style={S.cw}>{SUBJECTS.map(o=>{const a=genSubject===o;return(<button key={o} onClick={()=>setGenSubject(genSubject===o?"":o)} style={{...S.ch,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,borderColor:a?T.goldDark:T.border,fontWeight:a?700:500}}>{o}</button>);})}</div>
      </div>
      {/* 학년 — 2단 드롭다운 */}
      <div style={{marginBottom:14}}>
        <div style={S.label}>학년 <span style={{color:T.danger}}>*</span></div>
        <div style={{display:"flex",gap:8}}>
          <select style={{...S.inp,flex:"1 1 50%",cursor:"pointer"}} value={genGrade==="초등"?"초등":((genGrade.match(/^(초|중|고)/)||[""])[0]||"")} onChange={e=>{
            const sch=e.target.value;
            if(!sch){setGenGrade("");return;}
            if(sch==="초등"){setGenGrade("초등");return;}
            const curNum=(genGrade.match(/\d+/)||[""])[0];
            const maxN=sch==="초"?6:3;
            setGenGrade(curNum&&parseInt(curNum)<=maxN?sch+curNum:sch);
          }}>
            <option value="">학교급 선택</option>
            <option value="초">초등학교</option>
            <option value="초등">초등 (학년 무관)</option>
            <option value="중">중학교</option>
            <option value="고">고등학교</option>
          </select>
          <select style={{...S.inp,flex:"1 1 50%",cursor:"pointer"}} value={(genGrade.match(/\d+/)||[""])[0]||""} disabled={!genGrade||genGrade==="초등"} onChange={e=>{
            const n=e.target.value;
            const sch=(genGrade.match(/^(초|중|고)/)||[""])[0];
            if(!sch)return;
            setGenGrade(n?sch+n:sch);
          }}>
            <option value="">학년 선택</option>
            {(genGrade.startsWith("초")&&genGrade!=="초등"?[1,2,3,4,5,6]:genGrade?[1,2,3]:[]).map(n=>(<option key={n} value={String(n)}>{n}학년</option>))}
          </select>
        </div>
      </div>
      {/* 레벨 / 학교 — 다중선택 */}
      <div style={{marginBottom:14}}>
        <div style={S.label}>레벨 / 학교 <span style={{color:T.danger}}>*</span></div>
        <div style={{display:"flex",gap:5,marginBottom:8}}>{LV_CATS.map(c=>{const a=genLevelCat===c.key;return(<button key={c.key} onClick={()=>{setGenLevelCat(c.key);setGenLevel("");setGenLevelCustom("");setGenLevelMulti([]);}} style={{padding:"6px 12px",fontSize:12,fontWeight:a?700:500,borderRadius:8,border:`1.5px solid ${a?T.goldDark:T.border}`,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>{c.label}</button>);})}</div>
        {(genLevelCat==="middle"||genLevelCat==="high"||genLevelCat==="level")?(<>
          <div style={S.cw}>{(LV_CATS.find(c=>c.key===genLevelCat)?.opts||[]).map(o=>{const a=genLevelMulti.includes(o);return(<button key={o} onClick={()=>setGenLevelMulti(p=>p.includes(o)?p.filter(x=>x!==o):[...p,o])} style={{...S.ch,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,borderColor:a?T.goldDark:T.border,fontWeight:a?700:500,fontSize:12,padding:"7px 12px"}}>{a?"☑ ":"☐ "}{o}</button>);})}</div>
          {genLevelMulti.length>0&&(<div style={{marginTop:6}}>
            <button onClick={()=>setGenLevelMulti([])} style={{padding:"4px 10px",fontSize:11,fontWeight:600,borderRadius:6,border:`1px solid ${T.border}`,background:T.white,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>초기화</button>
          </div>)}
          {genLevelMulti.length>=2&&(<div style={{marginTop:8,padding:"8px 10px",background:"#FFF8E6",border:`1px solid ${T.goldMuted||"#E8D8A0"}`,borderRadius:8,fontSize:11,color:T.textSub,lineHeight:1.5}}>
            ⚠ <b>{genLevelMulti.length}개를 하나의 반으로 등록</b>합니다. 반드시 <b>같은 시험지</b>를 공유할 때만 사용하세요.
          </div>)}
        </>):(<input style={{...S.inp,marginTop:4}} placeholder="직접 입력 (예: 특별반)" value={genLevelCustom} onChange={e=>{setGenLevelCustom(e.target.value);setGenLevel(e.target.value);}}/>)}
      </div>
      {genSubject&&genGrade&&(((genLevelCat==="middle"||genLevelCat==="high"||genLevelCat==="level")&&genLevelMulti.length>0)||(genLevelCat==="etc"&&genLevelCustom))&&(<div style={S.addRow}>
        <div style={{fontSize:14,fontWeight:700,color:T.goldDark}}>{genSubject} {genGrade} {(genLevelCat==="middle"||genLevelCat==="high"||genLevelCat==="level")?genLevelMulti.join("+"):genLevelCustom}반</div>
        <button onClick={addGenClass} style={S.addBtn}>+ 반 추가</button>
      </div>)}
      {genClasses.length>0&&(<div style={{marginTop:12,marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:600,color:T.textMuted,marginBottom:6}}>추가된 반 ({genClasses.length}개)</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{genClasses.map((c,i)=>(<div key={i} style={S.tag}><span>{c.name}</span><button onClick={()=>setGenClasses(p=>p.filter((_,j)=>j!==i))} style={S.tagX}>×</button></div>))}</div>
      </div>)}
      {/* ★ 시험 구분 (이론편/실전편/혼합) — Claude에게 문제 유형 지시 */}
      <div style={{marginBottom:14,padding:"12px 14px",border:`1.5px solid ${T.goldMuted}`,borderRadius:10,background:T.goldPale}}>
        <div style={{fontSize:13,fontWeight:700,color:T.goldDeep,marginBottom:8}}>📚 시험 구분 (선택) — Claude에게 문제 유형 지시</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {GEN_SET_TYPES.map(st=>{
            const a=genSetType===st;
            const emj=st==="이론편"?"📘":st==="실전편"?"📕":"📗";
            const desc=st==="이론편"?"개념·기본 확인 위주":st==="실전편"?"실전 문제 풀이 중심":"이론+실전 섞음";
            return(<button key={st} onClick={()=>setGenSetType(genSetType===st?"":st)} style={{padding:"10px 14px",fontSize:12,fontWeight:a?700:500,borderRadius:8,border:`1.5px solid ${a?T.goldDark:T.border}`,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",alignItems:"flex-start",gap:2,minWidth:110}}>
              <span>{emj} {st}</span><span style={{fontSize:10,fontWeight:400,opacity:.8}}>{desc}</span>
            </button>);
          })}
        </div>
        <div style={{fontSize:11,color:T.textMuted,marginTop:6,lineHeight:1.5}}>선택하면 Claude가 해당 유형에 맞춰 문제를 생성합니다. 비워두면 기본(혼합) 유형.</div>
      </div>
      <div style={S.label}>메모 (선택)</div>
      <input style={S.inp} placeholder="추가 요청사항 (예: 서술형 포함)" value={memo}
        onChange={e=>setMemo(e.target.value)}/>
    </div>}
    {/* 확인 버튼 */}
    {textbook&&<button style={{...S.btnG,opacity:sending?0.5:1}} disabled={sending}
      onClick={()=>{
        if(!textbook)return alert("교재를 선택하세요.");
        const _hasChap=selBook&&selBook.chapters&&selBook.chapters.length>0;
        if(rangeType==="chapter"&&_hasChap&&chapters.length===0)return alert("챕터를 1개 이상 선택하세요.");
        if((rangeType==="page"||!_hasChap)&&(!pageFrom||!pageTo))return alert("페이지 범위를 입력하세요.");
        if(!targetTeacher)return alert("선생님 이름을 선택하세요.");
        if(genClasses.length===0)return alert("대상 반을 1개 이상 추가하세요.");
        setStep(2);
      }}>
      다음: 생성 요청 확인 →
    </button>}
    {/* 히스토리 */}
    <div style={{marginTop:24}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text}}>📋 생성 요청 내역</div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={async()=>{
            try{
              const r=await fetch(`${sheetsUrl}?action=scan_exam_gen_results`);
              const d=await r.json();
              if(d.result==="ok"){alert("✅ Drive 스캔 완료 — 학생앱에서 검색 가능합니다.\n(자동처리로그 시트에서 상세 확인)");loadHistory();}
              else alert("스캔 실패: "+(d.message||""));
            }catch(e){alert("스캔 실패: "+String(e));}
          }} style={{fontSize:11,color:T.accent,fontWeight:700,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>📂 Drive 결과 스캔</button>
          <button onClick={loadHistory} style={{fontSize:11,color:T.goldDark,fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>🔄 새로고침</button>
        </div>
      </div>
      {histLoading?<div style={{textAlign:"center",padding:20,color:T.textMuted,fontSize:13}}>로딩 중…</div>:
       history.length===0?<div style={{textAlign:"center",padding:20,color:T.textMuted,fontSize:13}}>아직 생성 요청이 없습니다</div>:
       history.map((h,i)=>{
         const statusColor=h.status==="완료"?T.accent:h.status==="생성중"?"#FF9800":h.status==="실패"?T.danger:T.textMuted;
         const statusBg=h.status==="완료"?T.accentLight:h.status==="생성중"?"#FFF3E0":h.status==="실패"?T.dangerLight:T.bg;
         return(<div key={i} style={{...S.card,marginBottom:8}}>
           <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:6}}>
             <div style={{flex:1}}>
               <div style={{fontSize:14,fontWeight:700,color:T.text}}>{h.textbook}</div>
               <div style={{fontSize:12,color:T.textSub,marginTop:2}}>{h.rangeDesc} · {h.testType==="vocab"?"단어":"문법/독해"} · {h.questionCount}문제{h.mcRatio!=null&&h.mcRatio<100?` · 객${h.mcRatio}%`:""}</div>
               <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>👤 {h.teacher} · {h.targetClass} · {h.requestedAt||""}</div>
             </div>
             <div style={{display:"flex",alignItems:"center",gap:6}}>
               {/* ★ v15: 검수 뱃지 — 정답 PDF 분석 검증 결과 */}
               {h.status==="완료"&&h.verification&&(()=>{
                 const vs=String(h.verificationStatus||h.verification.status||"").toLowerCase();
                 const wn=(h.verification.warnings||[]).length;
                 const isErr=vs==="error";
                 const isWarn=vs==="warning"||wn>0;
                 const ok=!isErr&&!isWarn;
                 const color=ok?"#2E7D32":isErr?"#C62828":"#E65100";
                 const bg=ok?"#E8F5E9":isErr?"#FFEBEE":"#FFF3E0";
                 const ic=ok?"✅":isErr?"❌":"⚠️";
                 const txt=ok?"검증":isErr?`오류${wn?` ${wn}`:""}`:`경고${wn?` ${wn}`:""}`;
                 return(<button onClick={(ev)=>{ev.stopPropagation();setVerifyModal({row:h.rowIndex,verification:h.verification,startNumber:h.startNumber||1,totalQuestions:h.questionCount||h.totalQuestions||0,textbook:h.textbook,targetClass:h.targetClass});}}
                   title="검수 상세 보기" style={{padding:"4px 8px",borderRadius:12,background:bg,color:color,fontSize:11,fontWeight:700,border:"none",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{ic} {txt}</button>);
               })()}
               <span style={{padding:"4px 10px",borderRadius:20,background:statusBg,color:statusColor,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{h.status||"대기"}</span>
               <button onClick={(ev)=>{ev.stopPropagation();deleteExamGen(h.rowIndex);}}
                 title="삭제" style={{width:24,height:24,borderRadius:"50%",border:`1px solid ${T.border}`,background:T.bg,color:T.textMuted,fontSize:14,lineHeight:"22px",textAlign:"center",cursor:"pointer",padding:0,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
             </div>
           </div>
           {h.status==="완료"&&<div>
             {/* ★ v14: 활성 세트 뱃지 + B세트 보유 여부 안내 */}
             {(h.resultFileIdB||h.activeSet)&&<div style={{display:"flex",alignItems:"center",gap:6,marginTop:4,fontSize:11}}>
               <span style={{padding:"2px 8px",borderRadius:10,background:(h.activeSet||"A")==="A"?"#E8F5E9":"#E3F2FD",color:(h.activeSet||"A")==="A"?"#2E7D32":"#1565C0",fontWeight:700}}>
                 현재 노출: {h.activeSet||"A"}세트
               </span>
               {h.resultFileIdB?<span style={{color:T.textMuted}}>· B세트 백업 있음</span>:<span style={{color:T.textMuted}}>· 백업 없음(단일 세트)</span>}
             </div>}
             <div style={{display:"flex",gap:6,marginTop:6}}>
               <button onClick={()=>loadPreview(h.rowIndex)} disabled={prevLoading&&prevRow===h.rowIndex}
                 style={{flex:1,padding:"8px",fontSize:12,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer",fontFamily:"inherit"}}>
                 {prevLoading&&prevRow===h.rowIndex?"로딩…":"👁️ 미리보기"}
               </button>
               <button onClick={()=>autoRegisterForStudents(h.rowIndex)}
                 style={{flex:1,padding:"8px",fontSize:12,fontWeight:600,borderRadius:8,border:"none",background:T.accent,color:T.white,cursor:"pointer",fontFamily:"inherit"}}>📱 학생앱 등록</button>
               {h.resultFileIdB&&<button onClick={()=>swapExamSet(h.rowIndex,h.activeSet||"A")}
                 title={`현재 ${h.activeSet||"A"}세트가 노출 중 — ${(h.activeSet||"A")==="A"?"B":"A"}세트로 교체`}
                 style={{flex:1,padding:"8px",fontSize:12,fontWeight:700,borderRadius:8,border:"none",background:"#FFB300",color:T.white,cursor:"pointer",fontFamily:"inherit"}}>
                 🔄 {(h.activeSet||"A")==="A"?"B":"A"}세트로 교체
               </button>}
             </div>
           </div>}
           {h.status==="생성중"&&<div style={{padding:"6px 10px",borderRadius:8,background:"#FFF3E0",fontSize:12,color:"#E65100",fontWeight:600,textAlign:"center",marginTop:6}}>
             ⏳ Claude가 문제를 만들고 있어요… (약 10분)
           </div>}
         </div>);
       })}
    </div>
    {/* ★ v15: 검수 결과 상세 모달 */}
    {verifyModal&&(()=>{
      const v=verifyModal.verification||{};
      const ws=v.warnings||[];
      const sc=v.subjectiveCount||{};
      const ma=v.multipleAnswerQuestions||[];
      const sq=v.subjectiveQuestions||[];
      const status=String(v.status||(v.crossCheckPassed?"ok":"warning")).toLowerCase();
      const isOk=status==="ok"&&ws.length===0;
      const headerColor=isOk?"#2E7D32":status==="error"?"#C62828":"#E65100";
      const headerBg=isOk?"#E8F5E9":status==="error"?"#FFEBEE":"#FFF3E0";
      const headerIc=isOk?"✅":status==="error"?"❌":"⚠️";
      return(<div onClick={()=>setVerifyModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}}>
        <div onClick={(e)=>e.stopPropagation()} style={{background:T.white,borderRadius:14,maxWidth:480,width:"100%",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 8px 32px rgba(0,0,0,.22)"}}>
          <div style={{padding:"14px 16px",background:headerBg,borderRadius:"14px 14px 0 0",borderBottom:`1px solid ${T.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:15,fontWeight:800,color:headerColor}}>{headerIc} 검수 결과</div>
              <button onClick={()=>setVerifyModal(null)} style={{border:"none",background:"none",fontSize:18,cursor:"pointer",color:T.textMuted,padding:4}}>✕</button>
            </div>
            <div style={{fontSize:12,color:T.textSub,marginTop:4}}>{verifyModal.textbook} · {verifyModal.targetClass}</div>
          </div>
          <div style={{padding:"14px 16px"}}>
            <div style={{fontSize:12,fontWeight:700,color:T.textSub,marginBottom:6}}>📋 문제 수 검증</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
              <div style={{padding:8,borderRadius:8,background:T.bg,textAlign:"center"}}><div style={{fontSize:10,color:T.textMuted}}>시험지</div><div style={{fontSize:18,fontWeight:700,color:T.text}}>{v.examQuestionCount??"-"}</div></div>
              <div style={{padding:8,borderRadius:8,background:T.bg,textAlign:"center"}}><div style={{fontSize:10,color:T.textMuted}}>정답지</div><div style={{fontSize:18,fontWeight:700,color:T.text}}>{v.answerCount??verifyModal.totalQuestions}</div></div>
              <div style={{padding:8,borderRadius:8,background:T.bg,textAlign:"center"}}><div style={{fontSize:10,color:T.textMuted}}>정보파일</div><div style={{fontSize:18,fontWeight:700,color:T.text}}>{v.infoQuestionCount??"-"}</div></div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:T.textSub,marginBottom:6}}>✏️ 주관식 검증</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
              <div style={{padding:8,borderRadius:8,background:T.bg,textAlign:"center"}}><div style={{fontSize:10,color:T.textMuted}}>시험지</div><div style={{fontSize:16,fontWeight:700,color:T.accent}}>{sc.exam??"-"}</div></div>
              <div style={{padding:8,borderRadius:8,background:T.bg,textAlign:"center"}}><div style={{fontSize:10,color:T.textMuted}}>정답지</div><div style={{fontSize:16,fontWeight:700,color:T.accent}}>{sc.answer??"-"}</div></div>
              <div style={{padding:8,borderRadius:8,background:T.bg,textAlign:"center"}}><div style={{fontSize:10,color:T.textMuted}}>정보파일</div><div style={{fontSize:16,fontWeight:700,color:T.accent}}>{sc.info??"-"}</div></div>
            </div>
            <div style={{padding:"8px 12px",borderRadius:8,background:T.bg,marginBottom:10,fontSize:13}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{color:T.textMuted}}>시작번호</span><span style={{fontWeight:700,color:T.text}}>{verifyModal.startNumber}번부터</span></div>
              {sq.length>0&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{color:T.textMuted}}>주관식 문항</span><span style={{fontWeight:600,color:T.text,fontSize:11}}>{sq.join(", ")}</span></div>}
              {ma.length>0&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{color:T.textMuted}}>복수정답 문항</span><span style={{fontWeight:600,color:T.text,fontSize:11}}>{ma.join(", ")}</span></div>}
              {v.processedAt&&<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:T.textMuted}}>처리시각</span><span style={{fontWeight:500,color:T.textSub,fontSize:11}}>{String(v.processedAt).replace("T"," ").replace("Z","")}</span></div>}
            </div>
            {ws.length>0&&<div style={{marginTop:10}}>
              <div style={{fontSize:12,fontWeight:700,color:"#E65100",marginBottom:6}}>⚠️ 경고 ({ws.length}개)</div>
              {ws.map((w,wi)=><div key={wi} style={{padding:"6px 10px",borderRadius:6,background:"#FFF3E0",color:"#BF360C",fontSize:12,marginBottom:4}}>{String(w)}</div>)}
            </div>}
            {isOk&&<div style={{padding:10,borderRadius:8,background:"#E8F5E9",color:"#1B5E20",fontSize:12,fontWeight:600,textAlign:"center",marginTop:10}}>
              ✅ 모든 검증을 통과했습니다
            </div>}
          </div>
        </div>
      </div>);
    })()}
  </div>);
  // ── Step 2: 확인 화면 ──
  if(step===2){
    if(!selBook){setStep(1);return null;}
    const rangeDesc=rangeType==="chapter"
      ?chapters.map(i=>(selBook.chapters||[])[i]||`챕터${i+1}`).join("\n")
      :`p.${pageFrom} ~ p.${pageTo}`;
    const eQ=Math.round(questionCount*diffEasy/100);
    const mQ=Math.round(questionCount*diffMed/100);
    const hQ=questionCount-eQ-mQ;
    return(<div style={S.wrap} className="fade-up">
      <div style={{textAlign:"center",padding:"20px 0 12px"}}>
        <div style={{fontSize:36,marginBottom:4}}>📋</div>
        <h1 style={{fontSize:24,fontWeight:800,color:T.text}}>생성 요청 확인</h1>
        <p style={{fontSize:13,color:T.textMuted}}>아래 내용으로 문제를 생성합니다</p>
      </div>
      <div style={S.card}>
        <div style={S.resRow}><span>📚 교재</span><span style={{fontWeight:600}}>{selBook?.name}</span></div>
        <div style={S.resRow}><span>📖 범위</span><span style={{fontWeight:600,textAlign:"right",maxWidth:"60%",whiteSpace:"pre-line",fontSize:12}}>{rangeDesc}</span></div>
        <div style={S.resRow}><span>📝 유형</span><span style={{fontWeight:600}}>{testType==="vocab"?"단어 테스트 (단답형)":"문법/독해 (혼합)"}</span></div>
        <div style={S.resRow}><span>🔢 문제 수</span><span style={{fontWeight:600}}>{questionCount}문제</span></div>
        <div style={S.resRow}><span>📊 난이도</span><span style={{fontWeight:600,fontSize:12}}>쉬움 {eQ} · 보통 {mQ} · 어려움 {hQ}</span></div>
        <div style={S.resRow}><span>📝 출제형태</span><span style={{fontWeight:600,fontSize:12}}>객관식 {mcRatio}% ({Math.round(questionCount*mcRatio/100)}문제) · 서술형 {100-mcRatio}% ({questionCount-Math.round(questionCount*mcRatio/100)}문제)</span></div>
        <div style={S.resRow}><span>👤 선생님</span><span style={{fontWeight:600}}>{targetTeacher}</span></div>
        <div style={S.resRow}><span>🏫 대상 반</span><span style={{fontWeight:600}}>{genClasses.map(c=>c.name).join(", ")}</span></div>
        {memo&&<div style={S.resRow}><span>💬 메모</span><span style={{fontWeight:600,fontSize:12}}>{memo}</span></div>}
      </div>
      <div style={{padding:"12px 14px",borderRadius:10,background:"#FFF8E1",fontSize:13,color:"#F57F17",fontWeight:600,textAlign:"center",marginBottom:16}}>
        ⏱️ 생성에 약 10분 소요됩니다. Slack으로 완료 알림을 보내드려요!
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>setStep(1)} style={{...S.btnO,flex:1}}>← 수정</button>
        <button onClick={submit} disabled={sending} style={{...S.btnG,flex:2,opacity:sending?0.5:1}}>
          {sending?"요청 중…":"🚀 생성 요청!"}
        </button>
      </div>
    </div>);
  }
  // ── Step 3: 완료 ──
  if(step===3) return(<div style={S.wrap} className="fade-up">
    <div style={{textAlign:"center",padding:"40px 0 20px"}}>
      <div style={{fontSize:56,marginBottom:12}}>🎉</div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:8}}>생성 요청 완료!</h1>
      <p style={{fontSize:14,color:T.textSub,lineHeight:1.6}}>
        Claude가 교재를 분석해서 문제를 만들고 있어요.<br/>
        약 <b>10분 후</b> Slack으로 알림이 갑니다.
      </p>
      <div style={{marginTop:16,padding:"14px",borderRadius:12,background:"#E8F5E9",fontSize:13,color:T.accent,fontWeight:600}}>
        💡 기다리는 동안 다른 일을 하셔도 됩니다!<br/>
        완료되면 앱에서 문제를 확인하고 등록할 수 있어요.
      </div>
    </div>
    <button onClick={()=>{setStep(1);setSentOk(false);loadHistory();}} style={S.btnG}>
      📚 새로운 문제 생성하기
    </button>
    <button onClick={()=>{setStep(1);setSentOk(false);loadHistory();}} style={{...S.btnO,width:"100%",marginTop:8}}>
      📋 생성 내역 확인
    </button>
  </div>);
  // ── Step 4: 미리보기 (3세트 탭 전환 + 재생성) ──
  if(step===4&&preview){
    const sets=preview.sets||[];
    const setLabels=["A","B","C"];
    const setColors=["#1E88E5","#43A047","#FB8C00"];
    const curSet=sets[selectedSet];
    const qs=curSet?.questions||[];
    const diffColors={easy:"#4CAF50",medium:"#FF9800",hard:"#F44336"};
    const diffLabels={easy:"★☆☆ 쉬움",medium:"★★☆ 보통",hard:"★★★ 어려움"};
    const grouped={easy:[],medium:[],hard:[]};
    qs.forEach(q=>{if(grouped[q.difficulty])grouped[q.difficulty].push(q);else grouped.medium.push(q);});
    return(<div style={S.wrap} className="fade-up">
      <div style={{textAlign:"center",padding:"20px 0 12px"}}>
        <div style={{fontSize:36,marginBottom:4}}>👁️</div>
        <h1 style={{fontSize:24,fontWeight:800,color:T.text}}>문제 미리보기</h1>
        <p style={{fontSize:13,color:T.textMuted}}>{preview.textbook} · {preview.rangeDesc}</p>
      </div>
      {/* 3세트 탭 */}
      {sets.length>1&&<div style={{display:"flex",gap:6,marginBottom:16}}>
        {sets.map((s,i)=>{
          const active=selectedSet===i;
          const label=`세트 ${setLabels[i]}`;
          const desc=s.style||`스타일 ${i+1}`;
          return(<button key={i} onClick={()=>setSelectedSet(i)} style={{
            flex:1,padding:"12px 8px",borderRadius:12,
            border:`2px solid ${active?setColors[i]:T.border}`,
            background:active?setColors[i]+"15":T.white,
            cursor:"pointer",fontFamily:"inherit",textAlign:"center",transition:"all .15s"
          }}>
            <div style={{fontSize:14,fontWeight:active?800:600,color:active?setColors[i]:T.textSub}}>{label}</div>
            <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>{desc}</div>
            <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>{(s.questions||[]).length}문제</div>
          </button>);
        })}
      </div>}
      {/* 선택된 세트 표시 */}
      {sets.length>1&&<div style={{padding:"8px 14px",borderRadius:10,background:setColors[selectedSet]+"15",border:`1.5px solid ${setColors[selectedSet]}`,fontSize:13,fontWeight:700,color:setColors[selectedSet],textAlign:"center",marginBottom:12}}>
        현재 보고 있는 시험지: 세트 {setLabels[selectedSet]}
      </div>}
      {/* 요약 카드 */}
      <div style={{...S.card,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,textAlign:"center"}}>
        <div><div style={{fontSize:11,color:T.textMuted}}>문제 수</div><div style={{fontSize:18,fontWeight:800,color:T.text}}>{qs.length}</div></div>
        <div><div style={{fontSize:11,color:T.textMuted}}>유형</div><div style={{fontSize:18,fontWeight:800,color:T.text}}>{preview.testType==="vocab"?"단어":"문법"}</div></div>
        <div><div style={{fontSize:11,color:T.textMuted}}>선생님</div><div style={{fontSize:14,fontWeight:700,color:T.text}}>{preview.teacher}</div></div>
      </div>
      {/* 데이터 소스 표시 */}
      {preview._source==="sheet"&&<div style={{padding:"6px 12px",borderRadius:8,background:"#E3F2FD",fontSize:11,color:"#1565C0",marginBottom:8,textAlign:"center"}}>
        📋 시트 정답데이터에서 로드됨 (간략 미리보기)
      </div>}
      {preview._error&&<div style={{padding:"8px 12px",borderRadius:8,background:"#FFF3E0",border:"1px solid #FFB74D",fontSize:11,color:"#E65100",marginBottom:8}}>
        ⚠️ {preview._error}
      </div>}
      {/* 디버그: answerData 구조 정보 (문제 0개일 때만 표시) */}
      {qs.length===0&&preview.answerDataInfo&&<div style={{padding:"6px 12px",borderRadius:8,background:"#F3E5F5",fontSize:10,color:"#6A1B9A",marginBottom:8}}>
        🔍 answerData 구조: type={preview.answerDataInfo.type}, isArray={String(preview.answerDataInfo.isArray)}, keys=[{(preview.answerDataInfo.keys||[]).join(",")}], sets={preview.answerDataInfo.setsType}
      </div>}
      {qs.length===0&&preview.answerDataRaw&&<div style={{padding:"6px 12px",borderRadius:8,background:"#FCE4EC",fontSize:10,color:"#880E4F",marginBottom:8,wordBreak:"break-all"}}>
        📄 원본 데이터(200자): {preview.answerDataRaw}
      </div>}
      {/* 난이도별 문제 */}
      {qs.length===0?<div style={{textAlign:"center",padding:30,color:T.textMuted}}>
        {preview._error?"⚠️ 문제 데이터를 불러올 수 없습니다.\nApps Script를 최신 버전(v10)으로 배포해주세요.":"이 세트에 문제가 없습니다."}
      </div>:
      ["easy","medium","hard"].map(diff=>{
        const items=grouped[diff];
        if(items.length===0)return null;
        return(<div key={diff} style={{marginBottom:16}}>
          <div style={{fontSize:14,fontWeight:700,color:diffColors[diff],marginBottom:8,padding:"6px 12px",background:diff==="easy"?"#E8F5E9":diff==="medium"?"#FFF3E0":"#FFEBEE",borderRadius:8,display:"inline-block"}}>
            {diffLabels[diff]} ({items.length}문제)
          </div>
          {items.map((q,qi)=>(<div key={qi} style={{...S.card,marginBottom:8,borderLeft:`4px solid ${diffColors[diff]}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:6}}>
              <span style={{fontSize:12,fontWeight:700,color:T.white,background:diffColors[diff],padding:"2px 8px",borderRadius:10}}>{q.number}번</span>
              <span style={{fontSize:11,color:T.textMuted,padding:"2px 8px",borderRadius:10,background:T.bg}}>{q.type==="mc"?"객관식":"주관식"}</span>
            </div>
            <div style={{fontSize:14,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap",marginBottom:8}}>{q.question}</div>
            {q.choices&&q.choices.length>0&&(<div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
              {q.choices.map((c,ci)=>{
                const isAns=(ci+1)===q.answer;
                return(<div key={ci} style={{padding:"8px 12px",borderRadius:8,fontSize:13,
                  background:isAns?"#E8F5E9":T.bg,
                  border:`1px solid ${isAns?"#4CAF50":T.border}`,
                  color:isAns?T.accent:T.text,
                  fontWeight:isAns?700:400
                }}>{isAns&&"✅ "}{c}</div>);
              })}
            </div>)}
            {q.type==="sub"&&(<div style={{padding:"8px 12px",borderRadius:8,background:"#E8F5E9",border:`1px solid #4CAF50`,fontSize:13,color:T.accent,fontWeight:600}}>
              💡 정답: {q.answer}
            </div>)}
            {q.explanation&&(<div style={{marginTop:6,padding:"8px 12px",borderRadius:8,background:"#F3E5F5",fontSize:12,color:"#7B1FA2",lineHeight:1.5}}>
              📖 {q.explanation}
            </div>)}
          </div>))}
        </div>);
      })}
      {/* 하단 액션 */}
      <div style={{position:"sticky",bottom:0,background:T.white,padding:"12px 0",borderTop:`1px solid ${T.border}`}}>
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <button onClick={()=>{setStep(1);setPreview(null);}} style={{...S.btnO,flex:1,padding:"10px"}}>← 돌아가기</button>
          <button onClick={()=>requestRegenerate(prevRow)} disabled={sending}
            style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,borderRadius:12,border:`1.5px solid ${T.danger}`,background:T.white,color:T.danger,cursor:"pointer",fontFamily:"inherit"}}>
            🔄 문제 다시 내기
          </button>
        </div>
        <button onClick={registerExam} disabled={sending} style={{...S.btnG,opacity:sending?0.5:1}}>
          {sending?"등록 중…":`✅ 세트 ${setLabels[selectedSet]}로 시험 등록`}
        </button>
      </div>
    </div>);
  }
  // fallback
  return null;
}
/* ═══ 오답 통계 탭 ═══ */
function StatsTab({sheetsUrl, T, S}){
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const load = useCallback(async()=>{
    setLoading(true);
    try{
      const params = new URLSearchParams({action:"wrong_stats"});
      if(date) params.set("date", date);
      if(subject) params.set("subject", subject);
      if(grade) params.set("grade", grade);
      const r = await fetch(`${sheetsUrl}?${params.toString()}`);
      const j = await r.json();
      setStats(j.stats || []);
    }catch(e){ setStats([]); }
    setLoading(false);
  }, [date, subject, grade, sheetsUrl]);
  useEffect(()=>{ load(); }, [load]);
  return (<div style={S.wrap} className="fade-up">
    <div style={{textAlign:"center",padding:"20px 0 12px"}}>
      <div style={{fontSize:36,marginBottom:4}}>📈</div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text}}>반별 오답 통계</h1>
      <p style={{fontSize:13,color:T.textMuted}}>시험별 평균점수 · 어려운 문항 Top 5</p>
    </div>
    <div style={S.card}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={S.inp} placeholder="날짜"/>
        <select value={subject} onChange={e=>setSubject(e.target.value)} style={S.inp}>
          <option value="">전체 과목</option><option>영어</option><option>국어</option><option>수학</option>
        </select>
        <select value={grade} onChange={e=>setGrade(e.target.value)} style={S.inp}>
          <option value="">전체 학년</option>
          {["초3","초4","초5","초6","중1","중2","중3","고1","고2","고3"].map(g=><option key={g}>{g}</option>)}
        </select>
        <button onClick={load} style={S.btnG}>🔍 조회</button>
      </div>
    </div>
    {loading ? <div style={{textAlign:"center",padding:30,color:T.textMuted}}>로딩 중…</div> :
     stats.length === 0 ? <div style={{textAlign:"center",padding:30,color:T.textMuted}}>데이터 없음</div> :
     stats.map((s, i) => (
      <div key={i} style={{...S.card, marginBottom:10}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>{s.subject} {s.grade} {s.level} · {s.examType}</div>
        <div style={{fontSize:12,color:T.textSub,marginBottom:8}}>응시 <b>{s.total}명</b> · 평균 <b style={{color:s.avg>=70?T.accent:s.avg>=50?T.goldDark:T.danger}}>{s.avg}점</b></div>
        {s.hardest && s.hardest.length>0 && <div>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>어려운 문항 Top {s.hardest.length}</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {s.hardest.map((h, hi) => (
              <div key={hi} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:h.pct>=70?T.dangerLight:T.bg,borderRadius:6,fontSize:12}}>
                <span style={{fontWeight:600}}>{h.q}번</span>
                <span style={{color:T.textSub}}>틀림 {h.wrong}명 ({h.pct}%)</span>
              </div>
            ))}
          </div>
        </div>}
      </div>
    ))}
  </div>);
}
/* ═══ 시험 스케줄 탭 ═══
   요일별 반복 시험 스케줄 관리 — 독립된 상태 · API만 사용하므로 분리.
   App과 공유할 필요 있는 건 teacherList 뿐.
   */
function ScheduleTab({sheetsUrl, T, S, teacherList}){
  const [schedule, setSchedule] = useState([]);
  const [schLoading, setSchLoading] = useState(false);
  const [schForm, setSchForm] = useState({rowIndex:0,day:"월",subject:"",grade:"",level:"",examType:"",teacher:"",time:"",memo:"",active:true});
  const loadSchedule = useCallback(()=>{
    setSchLoading(true);
    fetch(`${sheetsUrl}?action=list_schedule`)
      .then(r=>r.json())
      .then(d=>{ if(d.result==="ok") setSchedule(d.schedule||[]); setSchLoading(false); })
      .catch(()=>setSchLoading(false));
  }, [sheetsUrl]);
  useEffect(()=>{ loadSchedule(); }, [loadSchedule]);
  const saveSchedule = async()=>{
    const f = schForm;
    if(!f.day||!f.subject||!f.grade||!f.teacher) return alert("요일/과목/학년/선생님은 필수입니다.");
    const params = new URLSearchParams({action:"save_schedule",rowIndex:String(f.rowIndex||0),day:f.day,subject:f.subject,grade:f.grade,level:f.level||"",examType:f.examType||"",teacher:f.teacher,time:f.time||"",memo:f.memo||"",active:f.active?"true":"false"});
    const res = await fetch(`${sheetsUrl}?${params.toString()}`);
    const d = await res.json();
    if(d.result==="ok"){
      setSchForm({rowIndex:0,day:f.day,subject:"",grade:"",level:"",examType:"",teacher:"",time:"",memo:"",active:true});
      loadSchedule();
    } else alert("저장 실패: "+(d.message||""));
  };
  const deleteScheduleRow = async(rowIndex)=>{
    if(!confirm("삭제하시겠습니까?")) return;
    const res = await fetch(`${sheetsUrl}?action=delete_schedule&rowIndex=${rowIndex}`);
    const d = await res.json();
    if(d.result==="ok") loadSchedule();
  };
  return (<div style={S.wrap} className="fade-up">
    <div style={{textAlign:"center",padding:"20px 0 12px"}}>
      <div style={{fontSize:36,marginBottom:4}}>🗓️</div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:4}}>시험 스케줄 관리</h1>
      <p style={{fontSize:13,color:T.textMuted}}>요일별 반복 시험을 등록 · 매일 20시 #시험지준비 채널 리마인드</p>
    </div>
    {/* 등록 폼 */}
    <div style={S.card}>
      <div style={S.secLabel}>{schForm.rowIndex?"스케줄 수정":"새 스케줄 등록"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div>
          <div style={S.label}>요일 *</div>
          <select style={S.inp} value={schForm.day} onChange={e=>setSchForm({...schForm,day:e.target.value})}>
            {["월","화","수","목","금","토","일"].map(d=>(<option key={d} value={d}>{d}</option>))}
          </select>
        </div>
        <div>
          <div style={S.label}>과목 *</div>
          <select style={S.inp} value={schForm.subject} onChange={e=>setSchForm({...schForm,subject:e.target.value})}>
            <option value="">-- 선택 --</option>
            {["국어","영어","수학","과학","사회"].map(s=>(<option key={s} value={s}>{s}</option>))}
          </select>
        </div>
        <div>
          <div style={S.label}>학년 *</div>
          <select style={S.inp} value={schForm.grade} onChange={e=>setSchForm({...schForm,grade:e.target.value})}>
            <option value="">-- 선택 --</option>
            {["초5","초6","중1","중2","중3","고1","고2","고3"].map(g=>(<option key={g} value={g}>{g}</option>))}
          </select>
        </div>
        <div>
          <div style={S.label}>레벨</div>
          <input style={S.inp} placeholder="예: A반" value={schForm.level} onChange={e=>setSchForm({...schForm,level:e.target.value})}/>
        </div>
        <div>
          <div style={S.label}>시험 종류</div>
          <input style={S.inp} placeholder="예: 단원평가" value={schForm.examType} onChange={e=>setSchForm({...schForm,examType:e.target.value})}/>
        </div>
        <div>
          <div style={S.label}>선생님 *</div>
          <select style={S.inp} value={schForm.teacher} onChange={e=>setSchForm({...schForm,teacher:e.target.value})}>
            <option value="">-- 선택 --</option>
            {(teacherList||[]).filter(t=>!schForm.subject||t.subject===schForm.subject).map(t=>(<option key={t.name} value={t.name}>{t.name} ({t.subject})</option>))}
          </select>
        </div>
        <div>
          <div style={S.label}>시험 시간</div>
          <input type="time" style={S.inp} value={schForm.time} onChange={e=>setSchForm({...schForm,time:e.target.value})}/>
        </div>
        <div>
          <div style={S.label}>활성</div>
          <select style={S.inp} value={schForm.active?"true":"false"} onChange={e=>setSchForm({...schForm,active:e.target.value==="true"})}>
            <option value="true">활성 (리마인드 발송)</option>
            <option value="false">비활성</option>
          </select>
        </div>
      </div>
      <div style={{marginBottom:10}}>
        <div style={S.label}>비고</div>
        <input style={S.inp} placeholder="메모" value={schForm.memo} onChange={e=>setSchForm({...schForm,memo:e.target.value})}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button style={{...S.btnG,flex:1}} onClick={saveSchedule}>{schForm.rowIndex?"수정 저장":"+ 등록"}</button>
        {schForm.rowIndex?(<button style={{padding:"12px 18px",borderRadius:10,border:`1.5px solid ${T.border}`,background:T.white,cursor:"pointer",fontWeight:700}} onClick={()=>setSchForm({rowIndex:0,day:"월",subject:"",grade:"",level:"",examType:"",teacher:"",time:"",memo:"",active:true})}>취소</button>):null}
      </div>
    </div>
    {/* 스케줄 목록 (요일별 그룹) */}
    <div style={S.card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={S.secLabel}>등록된 스케줄 ({schedule.length}개)</div>
        <button onClick={loadSchedule} style={{padding:"6px 12px",fontSize:12,borderRadius:8,border:`1.5px solid ${T.border}`,background:T.white,cursor:"pointer"}}>🔄 새로고침</button>
      </div>
      {schLoading?(<div style={{padding:20,textAlign:"center",color:T.textMuted}}>불러오는 중…</div>):
        schedule.length===0?(<div style={{padding:20,textAlign:"center",color:T.textMuted,fontSize:13}}>등록된 스케줄이 없습니다.</div>):(
          ["월","화","수","목","금","토","일"].map(day=>{
            const list=schedule.filter(s=>s.day===day);
            if(list.length===0)return null;
            return(<div key={day} style={{marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:800,color:T.goldDark,marginBottom:6,paddingBottom:4,borderBottom:`1.5px solid ${T.goldLight}`}}>{day}요일 ({list.length}건)</div>
              {list.map(s=>(<div key={s.rowIndex} style={{padding:10,marginBottom:6,background:s.active?T.white:"#f5f5f5",border:`1px solid ${T.border}`,borderRadius:8,opacity:s.active?1:0.6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{flex:1,fontSize:13,lineHeight:1.5}}>
                    <div style={{fontWeight:700,color:T.text}}>{s.subject} {s.grade} {s.level} · {s.examType}</div>
                    <div style={{color:T.textSub,fontSize:12}}>👤 {s.teacher} · 🕐 {s.time||"미정"} {s.memo?" · "+s.memo:""} {!s.active?" · ⏸ 비활성":""}</div>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>setSchForm({rowIndex:s.rowIndex,day:s.day,subject:s.subject,grade:s.grade,level:s.level||"",examType:s.examType||"",teacher:s.teacher,time:s.time||"",memo:s.memo||"",active:s.active})} style={{padding:"4px 10px",fontSize:11,borderRadius:6,border:`1px solid ${T.border}`,background:T.white,cursor:"pointer"}}>수정</button>
                    <button onClick={()=>deleteScheduleRow(s.rowIndex)} style={{padding:"4px 10px",fontSize:11,borderRadius:6,border:`1px solid ${T.danger}`,background:T.white,color:T.danger,cursor:"pointer"}}>삭제</button>
                  </div>
                </div>
              </div>))}
            </div>);
          })
        )
      }
    </div>
  </div>);
}

/* ═══ 선생님 관리 탭 — 카테고리별(관리자/국어/영어/수학) CRUD ═══ */
function TeachersTab({sheetsUrl, T, S, onChanged}){
  // ★ v12.2: 폼 단순화 — 이름만 입력, 과목/슬랙ID/비고 제거
  // ★ 한글 인코딩 이슈 방지 — 카테고리를 영문 키로 전송 (서버가 한글로 변환)
  const TEACHER_CATS=["관리자","국어","영어","수학","기타"];
  const CAT_KEY={관리자:"admin",국어:"korean",영어:"english",수학:"math",기타:"other"};
  const [teachers,setTeachers]=useState([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [activeCat,setActiveCat]=useState("관리자");
  const [form,setForm]=useState({rowIndex:0,category:"관리자",name:""});
  const load=useCallback(()=>{
    setLoading(true);
    fetch(`${sheetsUrl}?action=list_teachers`)
      .then(r=>r.json()).then(d=>{
        if(d.result==="ok"){setTeachers(d.teachers||[]);onChanged&&onChanged(d.teachers||[]);}
        setLoading(false);
      }).catch(()=>setLoading(false));
  },[sheetsUrl,onChanged]);
  useEffect(()=>{load();},[load]);
  const save=async()=>{
    if(!form.name.trim())return alert("이름을 입력하세요.");
    if(saving)return;
    setSaving(true);
    try{
      // ★ POST + JSON body + 영문 카테고리 키 — 한글 인코딩 이슈 완전 회피
      //   Apps Script doPost 에서 "save_teacher" action 을 라우팅
      //   v12.4: categoryKey + category(한글) 둘 다 전송 — 구 배포에서도 동작
      const payload={
        action:"save_teacher",
        rowIndex:form.rowIndex||0,
        categoryKey:CAT_KEY[form.category]||"other",
        category:form.category,  // 한글 카테고리 (backup)
        name:form.name.trim()
      };
      const d=await fetch(sheetsUrl,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)}).then(r=>r.json());
      if(d.result==="ok"){
        // ★ 서버가 반환한 카테고리와 요청한 카테고리가 다르면 경고 (Apps Script 구버전 의심)
        if(d.category && d.category!==form.category){
          alert(`⚠️ 카테고리가 '${form.category}' 로 전송됐으나 서버는 '${d.category}' 로 저장했습니다.\nApps Script를 v12.4로 재배포 해주세요.`);
        }
        setForm({rowIndex:0,category:form.category,name:""});
        load();
      }else alert("저장 실패: "+(d.message||"알 수 없는 오류"));
    }catch(err){
      alert("저장 실패: "+String(err));
    }finally{setSaving(false);}
  };
  const edit=(t)=>{
    const cat=t.category&&TEACHER_CATS.includes(t.category)?t.category:"기타";
    setForm({rowIndex:t.rowIndex,category:cat,name:t.name||""});
  };
  const reset=()=>setForm({rowIndex:0,category:activeCat,name:""});
  const remove=async(t)=>{
    if(!confirm(`[${t.category||"기타"}] ${t.name} 선생님을 삭제하시겠습니까?`))return;
    // POST 로 통일 (한글 이름 인코딩 이슈 회피)
    const d=await fetch(sheetsUrl,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify({action:"delete_teacher",rowIndex:t.rowIndex})}).then(r=>r.json());
    if(d.result==="ok")load();
  };
  const filtered=teachers.filter(t=>(t.category||"기타")===activeCat);
  return(<div style={S.wrap} className="fade-up">
    <div style={{textAlign:"center",padding:"20px 0 12px"}}>
      <div style={{fontSize:36,marginBottom:4}}>👥</div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:4}}>선생님 관리</h1>
      <p style={{fontSize:13,color:T.textMuted}}>카테고리(관리자/국어/영어/수학)별로 선생님을 간단히 추가·삭제</p>
      {/* ★ v13: 진단 + 재분류 + 시드 재주입 도구 */}
      <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:10,flexWrap:"wrap"}}>
        <button onClick={async()=>{
          try{
            const r=await fetch(`${sheetsUrl}?action=diag_teachers`);
            const d=await r.json();
            if(d.result!=="ok"){alert("진단 실패: "+(d.message||""));return;}
            const lines=[];
            lines.push(`[버전: ${d._v||"구버전"}]`);
            lines.push(`시트: ${d.sheetName}  /  행: ${d.lastRow}  /  열: ${d.lastCol}`);
            lines.push(`헤더: [${(d.header||[]).join(" | ")}]`);
            lines.push(`--- 데이터 ${d.rows.length}행 ---`);
            (d.rows||[]).forEach(r=>{
              lines.push(`행${r.sheetRow}: [${r.col1_category||"(빈값)"}] ${r.col2_name}`);
            });
            if(d._v!=="v13"){
              lines.push("\n⚠️ Apps Script가 아직 v13으로 배포되지 않았습니다.");
            }
            alert(lines.join("\n"));
          }catch(err){alert("진단 오류: "+String(err));}
        }} style={{padding:"6px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:`1px solid ${T.border}`,background:T.white,color:T.textSub,cursor:"pointer"}}>🔍 진단</button>
        <button onClick={async()=>{
          if(!confirm("⚙️ 강제 재분류\n\n이름 기준으로 카테고리를 자동 덮어씁니다.\n(김우림=영어, 이강억=수학 등)\n\n계속할까요?"))return;
          try{
            const r=await fetch(`${sheetsUrl}?action=reclassify_teachers`);
            const d=await r.json();
            if(d.result==="ok"){
              const msg=`✅ 재분류 완료: ${d.updated}명 변경 (${d._v||"?"})\n\n`+
                (d.details||[]).slice(0,30).map(x=>`행${x.row} ${x.name}: ${x.was} → ${x.now}`).join("\n");
              alert(msg); load();
            }else alert("재분류 실패: "+(d.message||""));
          }catch(err){alert("재분류 오류: "+String(err));}
        }} style={{padding:"6px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:"none",background:T.goldDark,color:T.white,cursor:"pointer"}}>⚙️ 재분류</button>
        <button onClick={async()=>{
          if(!confirm("🌱 시드 재주입\n\n선생님 시트를 비우고 기본 명단(12명)을 다시 채웁니다.\n수동으로 추가했던 선생님은 사라집니다.\n\n계속할까요?"))return;
          try{
            const r=await fetch(`${sheetsUrl}?action=reseed_teachers`);
            const d=await r.json();
            if(d.result==="ok"){
              alert(`✅ 시드 재주입 완료: ${d.seeded}명 (${d._v||"?"})`); load();
            }else alert("재주입 실패: "+(d.message||""));
          }catch(err){alert("재주입 오류: "+String(err));}
        }} style={{padding:"6px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:"none",background:"#7B5E2D",color:T.white,cursor:"pointer"}}>🌱 시드 재주입</button>
      </div>
    </div>
    {/* 카테고리 탭 */}
    <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
      {TEACHER_CATS.map(c=>{
        const cnt=teachers.filter(t=>(t.category||"기타")===c).length;
        return(<button key={c} onClick={()=>{setActiveCat(c);setForm(f=>({...f,category:c}));}} style={{flex:"1 1 80px",padding:"10px 6px",fontSize:12,fontWeight:700,borderRadius:10,border:"none",cursor:"pointer",fontFamily:"inherit",background:activeCat===c?T.goldDark:T.white,color:activeCat===c?T.white:T.textSub,boxShadow:activeCat===c?"none":`inset 0 0 0 1.5px ${T.border}`}}>{c} <span style={{opacity:0.7,fontSize:11}}>({cnt})</span></button>);
      })}
    </div>
    {/* 폼 — 이름만 입력 */}
    <div style={S.card}>
      <div style={S.secLabel}>{form.rowIndex?"선생님 수정":"새 선생님 추가"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:8,marginBottom:8}}>
        <div>
          <div style={S.label}>카테고리 *</div>
          <select style={S.inp} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>
            {TEACHER_CATS.map(c=>(<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
        <div>
          <div style={S.label}>이름 *</div>
          <input style={S.inp} placeholder="예: 김원장, 박실장, 김선생" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")save();}}/>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={save} disabled={saving} style={{...S.btn,flex:1,opacity:saving?0.5:1}}>{saving?"저장 중…":(form.rowIndex?"수정 저장":"추가")}</button>
        {form.rowIndex>0&&(<button onClick={reset} style={{...S.btn,flex:"0 0 auto",background:T.white,color:T.textSub,boxShadow:`inset 0 0 0 1.5px ${T.border}`}}>취소</button>)}
      </div>
    </div>
    {/* 리스트 */}
    <div style={S.card}>
      <div style={S.secLabel}>[{activeCat}] 선생님 목록 {loading&&<span style={{fontSize:11,color:T.textMuted,fontWeight:400}}>로딩 중…</span>}</div>
      {filtered.length===0?(
        <div style={{padding:"24px 0",textAlign:"center",color:T.textMuted,fontSize:13}}>등록된 선생님이 없습니다.</div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filtered.map(t=>(
            <div key={t.rowIndex} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",background:T.white,borderRadius:8,border:`1px solid ${T.border}`}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:T.text}}>{t.name}</div>
              </div>
              <button onClick={()=>edit(t)} style={{padding:"6px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:"none",cursor:"pointer",background:T.goldLight||"#F4E9C5",color:T.text}}>수정</button>
              <button onClick={()=>remove(t)} style={{padding:"6px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:"none",cursor:"pointer",background:"#FBE9E7",color:T.danger||"#C62828"}}>삭제</button>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>);
}

/* ═══ 오늘의 현황 대시보드 탭 (과목→학년→선생님 계층) ═══
   독립된 상태(dashDate, dashData, schStatus, activeSubj, openFiles)를 내부로 캡슐화.
   App 에서는 teacherList, 파일 프록시 함수들만 props로 전달.
   */
function DashboardTab({sheetsUrl, T, S, teacherList, proxyDownload, proxyPreview}){
  const todayIsoStr=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
  const [dashDate, setDashDate] = useState(todayIsoStr());
  const [dashData, setDashData] = useState(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashErr, setDashErr] = useState("");
  const [schStatus, setSchStatus] = useState(null);
  const [activeSubj, setActiveSubj] = useState(null);
  const [openFiles, setOpenFiles] = useState({}); // {exam_i_j: bool}
  const toggleFiles = (k)=>setOpenFiles(p=>({...p,[k]:!p[k]}));
  const loadDashboard = useCallback((dateOverride)=>{
    const d=dateOverride||dashDate;
    setDashLoading(true); setDashErr(""); setDashData(null);
    fetch(`${sheetsUrl}?action=teacher_dashboard&date=${encodeURIComponent(d)}`)
      .then(r=>r.json()).then(d2=>{if(d2.result==="ok"){setDashData(d2);}else{setDashErr(d2.message||"조회 실패");}setDashLoading(false);})
      .catch(()=>{setDashErr("네트워크 오류");setDashLoading(false);});
    fetch(`${sheetsUrl}?action=schedule_status&date=${encodeURIComponent(d)}`)
      .then(r=>r.json()).then(d3=>{if(d3.result==="ok")setSchStatus(d3);else setSchStatus(null);}).catch(()=>setSchStatus(null));
  }, [dashDate, sheetsUrl]);
  useEffect(()=>{ loadDashboard(); }, [loadDashboard]);

  const isDashToday=dashDate===todayIsoStr();
  const dashDateLabel=(()=>{const m=dashDate.match(/(\d{4})-(\d{2})-(\d{2})/);return m?`${parseInt(m[2])}/${parseInt(m[3])}`:"";})();

  return(<div style={S.wrap} className="fade-up">
    <div style={{textAlign:"center",padding:"20px 0 12px"}}><div style={{fontSize:36,marginBottom:4}}>📊</div><h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:4}}>{isDashToday?"오늘의 현황":`${dashDateLabel} 시험 현황`}</h1><p style={{fontSize:13,color:T.textMuted}}>{isDashToday?"오늘":dashDateLabel} 시험 · 과목 · 학년 · 선생님별 분류</p></div>
    {/* 날짜 선택 + 새로고침 */}
    <div style={{...S.card,padding:"12px 14px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:700,color:T.textSub}}>📅 날짜</span>
        <input type="date" value={dashDate} onChange={e=>setDashDate(e.target.value||todayIsoStr())} style={{padding:"6px 10px",fontSize:13,border:`1.5px solid ${T.border}`,borderRadius:8,fontFamily:"inherit",background:T.white,color:T.text}}/>
        <button onClick={()=>setDashDate(todayIsoStr())} style={{padding:"6px 12px",fontSize:11,fontWeight:700,borderRadius:8,border:`1.5px solid ${isDashToday?T.goldDark:T.border}`,background:isDashToday?T.goldLight:T.white,color:isDashToday?T.goldDeep:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>오늘</button>
        <button onClick={()=>{const d=new Date(dashDate);d.setDate(d.getDate()-1);setDashDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);}} style={{padding:"6px 10px",fontSize:11,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.border}`,background:T.white,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>← 이전</button>
        <button onClick={()=>{const d=new Date(dashDate);d.setDate(d.getDate()+1);setDashDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);}} style={{padding:"6px 10px",fontSize:11,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.border}`,background:T.white,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>다음 →</button>
        <button onClick={()=>loadDashboard()} style={{...S.btnO,padding:"6px 12px",fontSize:11,marginLeft:"auto"}}>🔄 새로고침</button>
      </div>
    </div>
    {/* 스케줄 vs 실제 업로드 비교 */}
    {schStatus&&schStatus.hasSchedules&&schStatus.schedule&&schStatus.schedule.length>0&&(()=>{
      const cnt={done:0,waiting:0,none:0,extra:0};
      schStatus.schedule.forEach(s=>{
        if(s.status==="✅ 완료")cnt.done++;
        else if(s.status==="⏳ 처리대기")cnt.waiting++;
        else if(s.status==="📤 파일없음")cnt.none++;
        else if(s.status==="➕ 스케줄 외")cnt.extra++;
      });
      return(<div style={{...S.card,padding:"12px 14px",marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text}}>📋 스케줄 vs 실제 업로드 ({schStatus.day}요일)</div>
          <div style={{fontSize:11,color:T.textMuted}}>완료 {cnt.done} · 대기 {cnt.waiting} · 누락 {cnt.none}{cnt.extra?` · 추가 ${cnt.extra}`:""}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {schStatus.schedule.map((s,i)=>{
            const bg=s.status==="✅ 완료"?"#e8f7ec":s.status==="⏳ 처리대기"?"#fff8e1":s.status==="📤 파일없음"?"#ffebee":"#f3e5f5";
            return(<div key={i} style={{padding:"7px 9px",fontSize:11,background:bg,borderRadius:6,lineHeight:1.4}}>
              <div style={{fontWeight:700}}>{s.status}</div>
              <div style={{color:T.textSub}}>{s.subject} {s.grade} {s.level} {s.examType?"· "+s.examType:""}</div>
              <div style={{color:T.textMuted,fontSize:10}}>👤 {s.teacher} {s.time?"· "+s.time:""}</div>
            </div>);
          })}
        </div>
      </div>);
    })()}
    {dashLoading&&<div style={{textAlign:"center",padding:40,color:T.textMuted}}>불러오는 중...</div>}
    {dashErr&&<div style={{padding:14,background:T.dangerLight,borderRadius:10,color:T.danger,fontSize:13,fontWeight:600,textAlign:"center"}}>{dashErr}</div>}
    {dashData&&!dashLoading&&(()=>{
      const allExams=dashData.exams||[];
      const expTot=dashData.expectedTotal||dashData.summary?.totalExpected||0;
      const subTot=dashData.submissionTotal||dashData.summary?.totalSubmitted||0;
      const tree={};
      const subjOrder=["영어","수학","국어","과학","사회"];
      const gradeOrder=["초1","초2","초3","초4","초5","초6","초등","중1","중2","중3","고1","고2","고3"];
      allExams.forEach(ex=>{
        const guessSubj=(ex)=>{
          if(ex.subject&&["영어","국어","수학","과학","사회"].includes(ex.subject))return ex.subject;
          const keys=["영어","국어","수학","과학","사회"];
          const sources=[ex.examType,ex.className,ex.examName].filter(Boolean).join(" ");
          for(const k of keys){if(sources.indexOf(k)>=0)return k;}
          if(ex.teacher&&teacherList&&teacherList.length){
            const t=teacherList.find(x=>(x.name||x["이름"])===ex.teacher);
            if(t){
              const ts=String(t.subject||t["과목"]||"");
              const mm=ts.match(/(영어|국어|수학|과학|사회)/);
              if(mm)return mm[1];
            }
          }
          return ex.subject||"기타";
        };
        const s=guessSubj(ex);const g=ex.grade||"기타";const t=ex.teacher||"미지정";
        if(!tree[s])tree[s]={};
        if(!tree[s][g])tree[s][g]={};
        if(!tree[s][g][t])tree[s][g][t]=[];
        tree[s][g][t].push(ex);
      });
      const subjKeys=Object.keys(tree).sort((a,b)=>{
        const ia=subjOrder.indexOf(a),ib=subjOrder.indexOf(b);
        return (ia<0?99:ia)-(ib<0?99:ib);
      });
      return(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
          <div style={S.sumCard}><div style={{fontSize:11,color:T.textMuted}}>등록 시험</div><div style={{fontSize:22,fontWeight:800,color:T.goldDark}}>{allExams.length}</div></div>
          <div style={S.sumCard}><div style={{fontSize:11,color:T.textMuted}}>예상 인원</div><div style={{fontSize:22,fontWeight:800,color:T.blue}}>{expTot}</div></div>
          <div style={S.sumCard}><div style={{fontSize:11,color:T.textMuted}}>제출 수</div><div style={{fontSize:22,fontWeight:800,color:T.accent}}>{subTot}</div></div>
        </div>
        {expTot>0&&(<div style={{padding:"12px 14px",borderRadius:10,background:T.blueLight,border:`1px solid ${T.blue}30`,marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:T.blue,marginBottom:4}}>🖨️ 실장님 프린트 참고</div>
          <div style={{fontSize:12,color:T.textSub,lineHeight:1.6}}>오늘 총 <b style={{color:T.blue}}>{expTot}장</b>의 시험지가 필요합니다.</div>
        </div>)}
        {allExams.length===0?(
          <div style={{padding:24,background:T.borderLight,borderRadius:10,color:T.textMuted,fontSize:13,textAlign:"center"}}>오늘 등록된 시험이 없습니다.</div>
        ):(()=>{
          const subjSummary=subjKeys.map(s=>{
            const list=[];Object.values(tree[s]).forEach(g=>Object.values(g).forEach(t=>t.forEach(e=>list.push(e))));
            const exp=list.reduce((a,e)=>a+(e.studentCount||0),0);
            const sub=list.reduce((a,e)=>a+(e.submitted||0),0);
            const files=list.reduce((a,e)=>({exam:a.exam+(e.hasExamFile?1:0),ans:a.ans+(e.hasAnswerFile?1:0)}),{exam:0,ans:0});
            return{subj:s,count:list.length,exp,sub,files};
          });
          const curSubj=activeSubj&&subjKeys.includes(activeSubj)?activeSubj:subjKeys[0];
          return(<>
            <div style={{display:"flex",gap:4,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
              {subjSummary.map(ss=>{
                const isAct=ss.subj===curSubj;
                const emj=ss.subj==="영어"?"🇬🇧":ss.subj==="수학"?"🔢":ss.subj==="국어"?"📖":ss.subj==="과학"?"🔬":ss.subj==="사회"?"🌏":"📚";
                return(<button key={ss.subj} onClick={()=>setActiveSubj(ss.subj)} style={{flex:"1 0 auto",minWidth:110,padding:"8px 10px",borderRadius:10,border:isAct?`2px solid ${T.goldDark}`:`1.5px solid ${T.border}`,background:isAct?T.goldLight:T.white,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                  <div style={{fontSize:13,fontWeight:800,color:isAct?T.goldDark:T.text,marginBottom:2}}>{emj} {ss.subj}과 · {ss.count}</div>
                  <div style={{fontSize:10,color:T.textMuted,lineHeight:1.5}}>예상 {ss.exp}명 · 제출 {ss.sub}명<br/>📄 {ss.files.exam}/{ss.count} · 🔑 {ss.files.ans}/{ss.count}</div>
                </button>);
              })}
            </div>
          {[curSubj].map(subj=>{
            const subjExams=[];Object.values(tree[subj]).forEach(g=>Object.values(g).forEach(t=>t.forEach(e=>subjExams.push(e))));
            const subjExp=subjExams.reduce((s,e)=>s+(e.studentCount||0),0);
            const subjSub=subjExams.reduce((s,e)=>s+(e.submitted||0),0);
            const subjEmoji=subj==="영어"?"🇬🇧":subj==="수학"?"🔢":subj==="국어"?"📖":subj==="과학"?"🔬":subj==="사회"?"🌏":"📚";
            const gradeKeys=Object.keys(tree[subj]).sort((a,b)=>{
              const ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);
              return (ia<0?99:ia)-(ib<0?99:ib);
            });
            return(<div key={subj} style={{marginBottom:18,border:`2px solid ${T.goldMuted}`,borderRadius:12,overflow:"hidden",background:T.white}}>
              <div style={{padding:"12px 14px",background:T.goldDark,color:T.white,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:16,fontWeight:800}}>{subjEmoji} {subj}과</div>
                <div style={{fontSize:11,opacity:.9}}>시험 {subjExams.length}개 · 예상 {subjExp}명 · 제출 {subjSub}명</div>
              </div>
              {gradeKeys.map(gr=>{
              const gradeTeachers=tree[subj][gr];
              const teachers=Object.keys(gradeTeachers).sort();
              const gradeExams=[];teachers.forEach(t=>gradeTeachers[t].forEach(e=>gradeExams.push(e)));
              const gradeExp=gradeExams.reduce((s,e)=>s+(e.studentCount||0),0);
              return(<div key={gr} style={{borderTop:`1px solid ${T.borderLight}`}}>
                <div style={{padding:"8px 14px",background:T.goldPale,fontSize:13,fontWeight:700,color:T.goldDeep,display:"flex",justifyContent:"space-between"}}>
                  <span>🎓 {gr}</span>
                  <span style={{fontSize:11,fontWeight:500,color:T.textMuted}}>{gradeExams.length}개 · {gradeExp}명</span>
                </div>
                {teachers.map(tch=>{
                  const tExams=gradeTeachers[tch].slice().sort((a,b)=>(a.examTime||"").localeCompare(b.examTime||""));
                  return(<div key={tch} style={{padding:"6px 10px 10px"}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.textSub,padding:"6px 4px",display:"flex",alignItems:"center",gap:6}}>
                      <span style={{padding:"2px 8px",borderRadius:10,background:T.blueLight,color:T.blue,fontSize:10}}>👤 {tch}</span>
                      <span style={{color:T.textMuted,fontWeight:500}}>{tExams.length}개</span>
                    </div>
                    {tExams.map((ex,i)=>{
                      const timeLabel=ex.examTime||"-";
                      const lvLabel=ex.level?(ex.level==="전체"?"전체":ex.level+"반"):"";
                      const title=`${ex.examType}${ex.round?" · "+ex.round:""}${lvLabel?" ("+lvLabel+")":""}`;
                      const hasFile=ex.hasExamFile||ex.hasAnswerFile;
                      const fileStatus=ex.hasExamFile&&ex.hasAnswerFile?{t:"시험지·정답지 업로드 완료",c:T.accent,bg:T.accentLight}
                        :ex.hasAnswerFile?{t:"정답지만 업로드",c:T.goldDark,bg:T.goldLight}
                        :ex.hasExamFile?{t:"시험지만 업로드",c:T.goldDark,bg:T.goldLight}
                        :{t:"파일 없음",c:T.danger,bg:T.dangerLight};
                      const expected=ex.studentCount||0;
                      const submitted=ex.submitted||0;
                      const pct=expected>0?Math.min(100,(submitted/expected)*100):0;
                      return(<div key={i} style={{padding:"10px 12px",marginBottom:6,background:T.bg,border:`1px solid ${T.borderLight}`,borderRadius:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4,gap:6}}>
                          <div style={{fontSize:13,fontWeight:700,color:T.text,flex:1}}>{title}</div>
                          <div style={{fontSize:11,fontWeight:700,color:T.blue,whiteSpace:"nowrap"}}>🕐 {timeLabel}</div>
                        </div>
                        {ex.className&&<div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>{ex.className}</div>}
                        {/* ★ v12.1: 업로드 메모 표시 (실장님/교사 참고용) */}
                        {ex.memo&&(
                          <div style={{fontSize:11,color:T.goldDeep,background:T.goldPale,borderLeft:`3px solid ${T.goldDark}`,padding:"6px 8px",borderRadius:4,marginBottom:6,lineHeight:1.4}}>
                            💬 <span style={{fontWeight:600}}>메모</span>: {ex.memo}
                          </div>
                        )}
                        <div style={{display:"flex",gap:4,flexWrap:"wrap",fontSize:10,marginBottom:6}}>
                          <span style={S.pill}>📝 {ex.totalQuestions||0}문항</span>
                          <span style={S.pillBlue}>👥 예상 {expected}명</span>
                          <span style={S.pillGreen}>✅ 제출 {submitted}명</span>
                          <span style={{padding:"2px 8px",borderRadius:10,fontWeight:600,background:fileStatus.bg,color:fileStatus.c}}>{hasFile?"📎":"⚠️"} {fileStatus.t}</span>
                        </div>
                        {expected>0&&(<div style={{height:5,background:T.borderLight,borderRadius:3,overflow:"hidden",marginBottom:6}}><div style={{height:"100%",width:`${pct}%`,background:submitted>=expected?T.accent:T.gold,transition:"width .3s"}}/></div>)}
                        {(ex.files||[]).length>0&&(()=>{
                          const fkey=`${subj}_${gr}_${tch}_${i}`;
                          const isOpen=!!openFiles[fkey];
                          return(<div style={{marginTop:6,paddingTop:6,borderTop:`1px dashed ${T.border}`}}>
                          <button onClick={()=>toggleFiles(fkey)} style={{display:"flex",alignItems:"center",gap:6,fontSize:10,fontWeight:700,color:T.textSub,background:"none",border:"none",cursor:"pointer",padding:"2px 0",fontFamily:"inherit",width:"100%",justifyContent:"space-between"}}>
                            <span>📎 첨부 파일 {ex.files.length}개</span>
                            <span style={{fontSize:10,color:T.goldDark}}>{isOpen?"▲ 접기":"▼ 펼치기"}</span>
                          </button>
                          {isOpen&&(<div style={{display:"flex",flexDirection:"column",gap:3,marginTop:4}}>
                            {ex.files.map((fl,fi)=>(<div key={fi} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:T.white,borderRadius:6,border:`1px solid ${T.borderLight}`}}>
                              <span style={{fontSize:11}}>{fl.kind==="answer"?"🔑":"📄"}</span>
                              <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                                <div style={{fontSize:11,fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fl.name}</div>
                                <div style={{fontSize:9,color:T.textMuted}}>{fl.kind==="answer"?"정답지":"시험지"} · {fl.size?Math.round(fl.size/1024)+"KB":""}</div>
                              </div>
                              <button onClick={()=>proxyDownload(fl.id,fl.name)} style={{padding:"3px 8px",fontSize:10,fontWeight:700,background:T.goldDark,color:T.white,borderRadius:5,border:"none",cursor:"pointer",fontFamily:"inherit"}}>⬇ 다운</button>
                              <button onClick={()=>proxyPreview(fl.id,fl.name)} style={{padding:"3px 8px",fontSize:10,fontWeight:700,background:T.white,color:T.blue,border:`1px solid ${T.blue}`,borderRadius:5,cursor:"pointer",fontFamily:"inherit"}}>👁 보기</button>
                            </div>))}
                          </div>)}
                        </div>);
                        })()}
                        {ex.folderLink&&<a href={ex.folderLink} target="_blank" rel="noreferrer" style={{fontSize:10,color:T.blue,textDecoration:"none",fontWeight:600,display:"inline-block",marginTop:6}}>📁 Drive 폴더 열기 →</a>}
                      </div>);
                    })}
                  </div>);
                })}
              </div>);
            })}
          </div>);
          })}
        </>);
        })()}
      </>);
    })()}
  </div>);
}

export default function App(){
  // 상단 탭 (등록 / 오늘의 현황)
  const[tab,setTab]=useState("register");
  // (대시보드 관련 상태·함수는 DashboardTab 컴포넌트 내부로 이동)
  // 화면 상태
  const[screen,setScreen]=useState("home"); // home, modeSelect, directSetup, direct, upload, done
  // 선생님 정보 (localStorage)
  const _ls=lsGet();
  const[teacher,setTeacher]=useState(_ls.teacher||"");
  // 반 추가
  const[ts,setTs]=useState("");const[tg,setTg]=useState("");const[tl,setTl]=useState("");const[tcl,setTcl]=useState("");const[tlCat,setTlCat]=useState("level");
  // ★ 학교 다중선택 — 같은 시험지를 공유하는 여러 학교를 한 번에 등록
  const[tlMulti,setTlMulti]=useState([]); // 중/고등학교 카테고리에서만 사용
  const[tcount,setTcount]=useState(""); // 반별 예상 인원
  const[classes,setClasses]=useState([]);
  // 시험 정보
  const[examType,setExamType]=useState(_ls.lastExamType||""); // 직전 시험 종류 기억
  const[examDate,setExamDate]=useState(()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;});
  const[examTime,setExamTime]=useState(()=>{const d=new Date();return`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;});
  // ★ (레거시 호환용) setType 은 더 이상 사용하지 않음. 차수는 rounds[i].label 로 관리.
  // 직접입력 모드
  const[totalQ,setTotalQ]=useState(50);const[customQ,setCustomQ]=useState("");
  const qc=customQ?parseInt(customQ)||50:totalQ;
  const[startNum,setStartNum]=useState(1); // ★ 시작번호 (1이 아닌 경우 OMR에 180(1) 표시)
  const[answers,setAnswers]=useState([]);
  const[types,setTypes]=useState([]);
  const[subAns,setSubAns]=useState({});
  // 파일업로드 모드
  const[examFiles,setExamFiles]=useState([]);
  const[answerFiles,setAnswerFiles]=useState([]);
  // ★ 같은 시험지 / 다른 시험지 선택 (반이 2개 이상일 때)
  const[sameExam,setSameExam]=useState(true); // true=전체 같은 시험, false=반별 다른 시험
  // ★ 업로드 폴더 그룹 — 개념적으로는 1개(이론편/실전편/혼합) 만 사용.
  //   내부 구조는 하위호환 위해 "rounds" 이름 유지 (GS의 기존 upload_exam 플로우와 호환).
  //   label 은 빈 문자열로 두고 저장 시 최상위 setType 값이 사용됨.
  const[rounds,setRounds]=useState([
    {label:"",examFiles:[],answerFiles:[]},
  ]);
  const updateRound=(i,key,val)=>setRounds(p=>{const n=[...p];n[i]={...n[i],[key]:val};return n;});
  // ★ 반별 업로드 그룹 (다른 시험지일 때)
  const[classRounds,setClassRounds]=useState({});
  const initClassRounds=(clsList)=>{const m={};clsList.forEach(c=>{if(!m[c.name])m[c.name]=[{label:"",examFiles:[],answerFiles:[]}];});setClassRounds(m);};
  const updateClassRound=(clsName,i,key,val)=>setClassRounds(p=>{const arr=[...(p[clsName]||[])];arr[i]={...arr[i],[key]:val};return{...p,[clsName]:arr};});
  const[memo,setMemo]=useState("");
  // 주관식 힌트 (업로드 모드)
  const[subjMode,setSubjMode]=useState("none"); // none | mixed | all
  const[subjRanges,setSubjRanges]=useState(""); // "21-30, 45, 50-55"
  const[objRanges,setObjRanges]=useState("");   // "1-20, 31-44"
  // 상태
  const[saving,setSaving]=useState(false);const[done,setDone]=useState(false);const[error,setError]=useState("");
  // (대시보드 상태는 DashboardTab 컴포넌트 내부로 이동됨)
  // 선생님 목록 (드롭다운용)
  const[teacherList,setTeacherList]=useState([]);
  useEffect(()=>{fetch(`${SHEETS_URL}?action=list_teachers`).then(r=>r.json()).then(d=>{if(d.result==="ok")setTeacherList(d.teachers||[]);}).catch(()=>{});},[]);
  // (스케줄 관리 상태·함수는 ScheduleTab 컴포넌트 내부로 이동)
  const dateStr=examDate.replace(/-/g,".")+" "+examTime;
  const totalStudents=classes.reduce((s,c)=>s+(parseInt(c.count)||0),0);
  // 선생님 이름 저장
  useEffect(()=>{if(teacher)lsSet({teacher});},[teacher]);
  // 시험 종류 기억 (다음 등록 시 자동 채움)
  useEffect(()=>{if(examType)lsSet({lastExamType:examType});},[examType]);
  // 반 추가
  const addClass=()=>{
    if(!teacher.trim())return alert("먼저 선생님 이름을 입력하세요.");
    if(!ts)return alert("과목을 선택하세요.");
    if(!tg)return alert("학년을 선택하세요.");
    // 학교급만 선택되고 학년 미선택이면 거절 (초등 전체는 허용)
    if(/^(초|중|고)$/.test(tg))return alert("학년을 선택하세요. (예: 1학년, 2학년…)");
    // ★ 학교 다중선택 지원: 중/고등학교 카테고리에서는 tlMulti 배열 사용
    //   - 2개 이상 선택 시: level="관교여중,관교중", 반이름="영어 중2 관교여중+관교중반"
    //   - 1개 선택 시: 기존과 동일
    //   - 기타/레벨 카테고리: tl 또는 tcl 그대로 사용
    let lv, displayName;
    if((tlCat==="middle"||tlCat==="high"||tlCat==="level")&&tlMulti.length>0){
      lv=tlMulti.join(",");
      displayName=tlMulti.join("+");
    }else{
      const single=tlCat==="etc"?tcl:"";
      if(!single)return alert("레벨/학교를 선택하세요.");
      lv=single;displayName=single;
    }
    if(!lv)return alert("레벨/학교를 선택하세요.");
    const name=`${ts} ${tg} ${displayName}반`;
    if(classes.some(c=>c.name===name))return alert("이미 추가된 반입니다.");
    // ★ 예상 인원 필수 — 실장님 프린트 매수 산출에 필요
    const cnt=parseInt(tcount)||0;
    if(!cnt||cnt<=0)return alert("예상 인원을 입력하세요.\n(실장님이 시험지를 몇 장 프린트해야 할지 계산하기 위해 필수입니다.)");
    // 다중선택 시 최종 확인 — 같은 시험지가 맞는지 재확인
    if(tlMulti.length>=2){
      const ok=window.confirm(`다음 ${tlMulti.length}개 학교를 하나의 반으로 등록합니다:\n\n  ${tlMulti.join(" + ")}\n\n⚠ 반드시 **같은 시험지**를 공유할 때만 사용하세요.\n시험지가 다르면 [취소] 후 학교를 1개씩 등록해주세요.\n\n계속하시겠습니까?`);
      if(!ok)return;
    }
    const newClasses=[...classes,{subject:ts,grade:tg,level:lv,name,count:cnt}];
    setClasses(newClasses);
    setClassRounds(p=>({...p,[name]:[{label:"",examFiles:[],answerFiles:[]}]}));
    setTl("");setTcl("");setTcount("");setTlMulti([]);
  };
  // 시험정보 확인 → 모드 선택
  const goToMode=()=>{
    if(!teacher.trim())return alert("선생님 이름을 입력하세요.");
    if(classes.length===0)return alert("반을 1개 이상 추가하세요.");
    if(!examType)return alert("시험 종류를 선택하세요.");
    setScreen("modeSelect");
  };
  // 직접입력 시작
  const startDirect=()=>{setAnswers(Array(qc).fill(null));setTypes(Array(qc).fill("obj"));setSubAns({});setScreen("direct");};
  // 답 입력
  // 객관식 버튼: 복수정답 토글(동일 클릭 해제 / 다른 숫자 클릭 시 추가)
  const hAns=useCallback((i,v)=>{setAnswers(p=>{
    const n=[...p];
    const cur=n[i];
    if(cur===null||cur===undefined||cur===""){n[i]=v;}
    else if(Array.isArray(cur)){
      if(cur.includes(v)){
        const nx=cur.filter(x=>x!==v);
        n[i]=nx.length===0?null:(nx.length===1?nx[0]:nx);
      }else{n[i]=[...cur,v].sort((a,b)=>a-b);}
    }else{
      if(cur===v){n[i]=null;}
      else{n[i]=[cur,v].sort((a,b)=>a-b);}
    }
    return n;
  });},[]);
  const hType=useCallback(i=>{setTypes(p=>{const n=[...p];n[i]=p[i]==="obj"?"sub":"obj";return n;});setAnswers(p=>{const n=[...p];n[i]=null;return n;});setSubAns(p=>{const n={...p};delete n[i];return n;});},[]);
  const hSub=useCallback((i,v)=>{setSubAns(p=>({...p,[i]:v}));setAnswers(p=>{const n=[...p];n[i]=v;return n;});},[]);
  const _isFilled=a=>{if(a===null||a===undefined||a==="")return false;if(Array.isArray(a))return a.length>0;return true;};
  const filled=answers.filter(a=>_isFilled(a)).length;
  // 직접입력 저장
  const saveDirect=async()=>{
    if(saving)return; // ★ 중복 제출 방지: 이미 저장 중이면 무시
    if(filled===0)return alert("최소 1문항 이상 정답을 입력하세요.");
    setSaving(true);setError("");
    try{
      // 복수정답 배열은 "2,3" 형태 문자열로 직렬화 → 그 뒤 {"1":v,...} 객체로 정규화
      const answersSer=answers.map(v=>Array.isArray(v)?v.join(","):v);
      const answersObj=normalizeAnswerData(answersSer);
      const typesObj=normalizeAnswerData(types);
      // 1) 정답 데이터 시트 저장 (반별) — 시험 구분(setType) 포함
      for(const cls of classes){
        await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"save_answer_key",subject:cls.subject,grade:cls.grade,level:cls.level,examType,setType:"",round:"",totalQuestions:qc,answers:answersObj,types:typesObj,teacher,studentCount:cls.count,date:dateStr,className:cls.name,startNumber:startNum})});
      }
      // 2) 파일(시험지/정답지)이 있으면 Drive에도 업로드 — 반별 개별 업로드
      if(examFiles.length>0||answerFiles.length>0){
        const aData=await Promise.all(answerFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
        const eData=await Promise.all(examFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
        for(const cls of classes){
          await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({action:"upload_exam",classes:[{subject:cls.subject,grade:cls.grade,level:cls.level,count:cls.count}],classNames:cls.name,examType,setType:"",round:"",date:dateStr,memo:"(직접 입력 모드 · 시험지/정답지 업로드)",teacher,studentCount:cls.count,subjMode:"direct",subjRanges:"",objRanges:"",answerFiles:aData,examFiles:eData})});
        }
      }
      setDone(true);setScreen("done");
    }catch(e){setError("저장 실패. 다시 시도해주세요.");}
    setSaving(false);
  };
  // 파일업로드 저장 (차수별)
  const saveUpload=async()=>{
    if(saving)return; // ★ 중복 제출 방지: 이미 저장 중이면 무시
    // 같은 시험지 모드 vs 반별 다른 시험지 모드
    if(sameExam||classes.length<=1){
      // ── 같은 시험지: 기존 rounds 사용 ──
      const active=rounds.filter(r=>r.answerFiles.length>0||r.examFiles.length>0);
      if(active.length===0)return alert("시험지·정답지 파일을 최소 1개 이상 올려주세요.");
      const missingAns=active.find(r=>r.answerFiles.length===0);
      if(missingAns)return alert(`정답지가 없습니다.\n정답지를 올려주세요 (Claude 분석 필수).`);
      // 주관식 번호 범위 경고
      if(subjMode==="mixed" && subjRanges){
        const maxNum=Math.max(...subjRanges.match(/\d+/g)?.map(Number)||[0]);
        if(maxNum>200){if(!confirm(`주관식 번호에 ${maxNum}번이 포함되어 있습니다. 문항수를 초과한 것 아닌가요?\n그래도 진행하시겠습니까?`))return;}
      }
      // 파일명 휴리스틱
      for(const rd of active){
        const suspAns=rd.answerFiles.find(f=>/(시험지|문제지|problem|question|quiz)/i.test(f.name)&&!/(정답|답지|답안|해설|풀이|answer|solution|key)/i.test(f.name));
        if(suspAns){if(!confirm(`⚠️ 정답지로 올린 파일 "${suspAns.name}"이 시험지처럼 보입니다.\n시험지·답지를 바꿔 올리신 건 아닌가요?\n그대로 진행하시겠습니까?`))return;}
        const suspExam=rd.examFiles.find(f=>/(정답|답지|답안|해설|풀이|answer|solution|key)/i.test(f.name));
        if(suspExam){if(!confirm(`⚠️ 시험지로 올린 파일 "${suspExam.name}"이 답지처럼 보입니다.\n시험지·답지를 바꿔 올리신 건 아닌가요?\n그대로 진행하시겠습니까?`))return;}
      }
      setSaving(true);setError("");
      try{
        for(const rd of active){
          const aData=await Promise.all(rd.answerFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
          const eData=await Promise.all(rd.examFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
          for(const cls of classes){
            await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({action:"upload_exam",classes:[{subject:cls.subject,grade:cls.grade,level:cls.level,count:cls.count}],classNames:cls.name,examType,setType:rd.label||"",round:rd.label||"",date:dateStr,memo,teacher,studentCount:cls.count,subjMode,subjRanges,objRanges,answerFiles:aData,examFiles:eData})});
          }
        }
        setDone(true);setScreen("done");
      }catch(e){setError("업로드 실패. 다시 시도해주세요.");}
      setSaving(false);
    }else{
      // ── 반별 다른 시험지: classRounds 사용 ──
      for(const cls of classes){
        const cRds=classRounds[cls.name]||[];
        const active=cRds.filter(r=>r.answerFiles.length>0||r.examFiles.length>0);
        if(active.length===0)return alert(`"${cls.name}" 반에 최소 1개의 시험지·정답지를 업로드하세요.`);
        const missingAns=active.find(r=>r.answerFiles.length===0);
        if(missingAns)return alert(`"${cls.name}"에 정답지가 없습니다.`);
      }
      if(subjMode==="mixed" && subjRanges){
        const maxNum=Math.max(...subjRanges.match(/\d+/g)?.map(Number)||[0]);
        if(maxNum>200){if(!confirm(`주관식 번호에 ${maxNum}번이 포함되어 있습니다. 문항수를 초과한 것 아닌가요?\n그래도 진행하시겠습니까?`))return;}
      }
      setSaving(true);setError("");
      try{
        for(const cls of classes){
          const cRds=(classRounds[cls.name]||[]).filter(r=>r.answerFiles.length>0||r.examFiles.length>0);
          for(const rd of cRds){
            const aData=await Promise.all(rd.answerFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
            const eData=await Promise.all(rd.examFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
            await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({action:"upload_exam",classes:[{subject:cls.subject,grade:cls.grade,level:cls.level,count:cls.count}],classNames:cls.name,examType,setType:rd.label||"",round:rd.label||"",date:dateStr,memo,teacher,studentCount:cls.count,subjMode,subjRanges,objRanges,answerFiles:aData,examFiles:eData})});
          }
        }
        setDone(true);setScreen("done");
      }catch(e){setError("업로드 실패. 다시 시도해주세요.");}
      setSaving(false);
    }
  };
  // 대시보드 조회
  // 프록시 다운로드 — Apps Script가 base64로 파일을 서빙 → blob으로 변환해서 저장
  // 다른 구글 계정(권한 없는 선생님)도 다운 가능
  // 파일을 base64로 받아서 Blob URL로 변환하는 공통 함수
  const fetchFileBlob=async(fileId)=>{
    const res=await fetch(`${SHEETS_URL}?action=download_file&id=${encodeURIComponent(fileId)}`);
    const d=await res.json();
    if(d.result!=="ok")throw new Error(d.message||"파일 접근 실패");
    const bin=atob(d.data);const u8=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
    const blob=new Blob([u8],{type:d.mimeType||"application/octet-stream"});
    return{blob,mimeType:d.mimeType||"",name:d.name||""};
  };
  // 다운로드 (구글 계정 없이도 가능 — Apps Script 프록시)
  const proxyDownload=async(fileId,fileName)=>{
    try{
      const{blob,name}=await fetchFileBlob(fileId);
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=fileName||name||"download";
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(err){alert("다운로드 실패: "+(err.message||err));}
  };
  // 미리보기 (구글 계정 없이도 가능 — Blob URL로 새 탭 열기)
  const proxyPreview=async(fileId,fileName)=>{
    try{
      const{blob,mimeType}=await fetchFileBlob(fileId);
      // PDF·이미지는 브라우저에서 바로 표시
      const previewable=["application/pdf","image/png","image/jpeg","image/gif","image/webp"];
      const url=URL.createObjectURL(blob);
      if(previewable.includes(mimeType)){
        const w=window.open("","_blank");
        if(w){
          if(mimeType==="application/pdf"){
            w.document.write(`<html><body style="margin:0"><iframe src="${url}" style="width:100%;height:100vh;border:none"></iframe></body></html>`);
          } else {
            w.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${url}" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>`);
          }
          setTimeout(()=>URL.revokeObjectURL(url),60000);
        }
      } else {
        // PDF·이미지 아닌 파일(HWP, DOCX 등)은 다운로드로 대체
        const a=document.createElement("a");a.href=url;a.download=fileName||"download";
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        alert("이 파일 형식은 미리보기가 지원되지 않아 다운로드됩니다.\n(PDF·이미지 형식만 미리보기 가능)");
      }
    }catch(err){alert("미리보기 실패: "+(err.message||err));}
  };
  // (loadDashboard, schStatus, 대시보드 useEffect는 DashboardTab 컴포넌트 내부로 이동됨)
  const reset=()=>{setScreen("home");setTs("");setTg("");setTl("");setTcl("");setTlCat("level");setTlMulti([]);setTcount("");setClasses([]);setExamType("");setExamFiles([]);setAnswerFiles([]);setRounds([{label:"",examFiles:[],answerFiles:[]}]);setSameExam(true);setClassRounds({});setMemo("");setAnswers([]);setTypes([]);setSubAns({});setDone(false);setError("");setTotalQ(50);setCustomQ("");setStartNum(1);setSubjMode("none");setSubjRanges("");setObjRanges("");
    const d=new Date();setExamDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);setExamTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`);};
  return(
    <div style={S.app} className="app-shell">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}body{font-family:'Noto Sans KR',-apple-system,sans-serif;background:${T.bg}}input:focus,textarea:focus{outline:none;border-color:${T.gold}!important;box-shadow:0 0 0 3px ${T.goldLight}!important}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes spin{to{transform:rotate(360deg)}}.fade-up{animation:fadeUp .3s ease-out}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
/* ── 반응형: 모바일 스타일 유지 (좌우폭 480px 고정) ── */
`}</style>
      <header style={S.hdr}><div style={S.hdrIn} className="hdr-inner"><div style={S.logoR}><div style={S.logoM}>채움</div><div><div style={S.hdrT}>채움학원</div><div style={S.hdrS}>시험 등록 (선생님용)</div></div></div>{teacher&&<div style={S.hdrB}>👤 {teacher}</div>}</div></header>
      {/* ═══ 상단 탭 (home 에서만 표시) ═══ */}
      {screen==="home"&&(<div style={{display:"flex",flexWrap:"wrap",gap:6,padding:"10px 14px 0"}}>
        {[
          {k:"register",label:"📋 시험 등록"},
          {k:"dashboard",label:"📊 오늘의 현황"},
          {k:"schedule",label:"🗓️ 스케줄"},
          {k:"print",label:"🖨️ 일괄 프린트"},
          {k:"stats",label:"📈 오답 통계"},
          {k:"generator",label:"📚 문제 생성"},
          {k:"teachers",label:"👥 선생님 관리"}
        ].map(tb=>(
          <button key={tb.k} onClick={()=>setTab(tb.k)} style={{flex:"1 1 100px",minWidth:100,padding:"10px",fontSize:12,fontWeight:700,borderRadius:10,border:"none",cursor:"pointer",fontFamily:"inherit",background:tab===tb.k?T.goldDark:T.white,color:tab===tb.k?T.white:T.textSub,boxShadow:tab===tb.k?"none":`inset 0 0 0 1.5px ${T.border}`}}>{tb.label}</button>
        ))}
      </div>)}
      {/* ═══ 일괄 프린트 탭 ═══ */}
      {screen==="home"&&tab==="print"&&(<PrintTab sheetsUrl={SHEETS_URL} T={T} S={S}/>)}
      {/* ═══ 오답 통계 탭 ═══ */}
      {screen==="home"&&tab==="stats"&&(<StatsTab sheetsUrl={SHEETS_URL} T={T} S={S}/>)}
      {/* ═══ 문제 생성기 탭 ═══ */}
      {screen==="home"&&tab==="generator"&&(<GeneratorTab sheetsUrl={SHEETS_URL} T={T} S={S} teacherList={teacherList}/>)}
      {/* ═══ 홈: 시험 정보 설정 ═══ */}
      {screen==="home"&&tab==="register"&&(<div style={S.wrap} className="fade-up">
        <div style={{textAlign:"center",padding:"20px 0 12px"}}><div style={{fontSize:36,marginBottom:4}}>📋</div><h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:4}}>시험 등록</h1><p style={{fontSize:13,color:T.textMuted}}>시험 대상 반과 정보를 설정하세요</p></div>
        {/* 선생님 이름 */}
        <div style={S.card}>
          <div style={S.secLabel}>선생님 정보</div>
          <div style={{marginBottom:0}}>
            <div style={S.label}>선생님 이름 <span style={{color:T.danger}}>*</span><span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:6}}>(선생님목록에서 선택 · 다음부터 자동)</span></div>
            {teacherList.length>0?(
              <select style={S.inp} value={teacher} onChange={e=>setTeacher(e.target.value)}>
                <option value="">-- 선생님 선택 --</option>
                {/* ★ 카테고리(관리자/국어/영어/수학) 우선 그룹핑, fallback 과목 */}
                {["관리자","국어","영어","수학"].map(cat=>{
                  const catTeachers=teacherList.filter(t=>(t.category||t.subject)===cat);
                  if(catTeachers.length===0)return null;
                  return(<optgroup key={cat} label={cat==="관리자"?cat:cat+"과"}>{catTeachers.map(t=>(<option key={t.name} value={t.name}>{t.name}</option>))}</optgroup>);
                })}
                {teacherList.filter(t=>!["관리자","국어","영어","수학"].includes(t.category||t.subject)).length>0&&(
                  <optgroup label="기타">{teacherList.filter(t=>!["관리자","국어","영어","수학"].includes(t.category||t.subject)).map(t=>(<option key={t.name} value={t.name}>{t.name}</option>))}</optgroup>
                )}
              </select>
            ):(
              <input style={S.inp} placeholder="예: 김선생 (목록 로딩 중…)" value={teacher} onChange={e=>setTeacher(e.target.value)}/>
            )}
            {/* 선생님 목록에 없는 경우 직접 입력 옵션 */}
            <div style={{marginTop:8,fontSize:11,color:T.textMuted}}>
              📝 목록에 없는 선생님은 <span style={{color:T.goldDark,fontWeight:700,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("teachers")}>선생님 관리</span> 탭에서 추가하세요.
            </div>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.secLabel}>시험 대상 반 추가</div>
          <Chip label="과목" req opts={SUBJECTS} val={ts} onChange={setTs}/>
          {/* 학년 — 2단 드롭다운 (학교급 + 학년) */}
          <div style={{marginBottom:14}}>
            <div style={S.label}>학년 <span style={{color:T.danger}}>*</span></div>
            <div style={{display:"flex",gap:8}}>
              <select style={{...S.inp,flex:"1 1 50%",cursor:"pointer"}} value={tg==="초등"?"초등":((tg.match(/^(초|중|고)/)||[""])[0]||"")} onChange={e=>{
                const sch=e.target.value;
                if(!sch){setTg("");return;}
                if(sch==="초등"){setTg("초등");return;} // 초등 전체 (학년 무관)
                // 기존 학년이 새 학교급 범위 안이면 유지, 아니면 학교급 prefix 만 보관
                const curNum=(tg.match(/\d+/)||[""])[0];
                const maxN=sch==="초"?6:3;
                setTg(curNum&&parseInt(curNum)<=maxN?sch+curNum:sch);
              }}>
                <option value="">학교급 선택</option>
                <option value="초">초등학교</option>
                <option value="초등">초등 (학년 무관)</option>
                <option value="중">중학교</option>
                <option value="고">고등학교</option>
              </select>
              <select style={{...S.inp,flex:"1 1 50%",cursor:"pointer"}} value={(tg.match(/\d+/)||[""])[0]||""} disabled={!tg||tg==="초등"} onChange={e=>{
                const n=e.target.value;
                const sch=(tg.match(/^(초|중|고)/)||[""])[0];
                if(!sch)return;
                setTg(n?sch+n:sch);  // 학년 해제 시 학교급 prefix 유지
              }}>
                <option value="">학년 선택</option>
                {(tg.startsWith("초")&&tg!=="초등"?[1,2,3,4,5,6]:tg?[1,2,3]:[]).map(n=>(<option key={n} value={String(n)}>{n}학년</option>))}
              </select>
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <div style={S.label}>레벨 / 학교 <span style={{color:T.danger}}>*</span></div>
            <div style={{display:"flex",gap:5,marginBottom:8}}>{LV_CATS.map(c=>{const a=tlCat===c.key;return(<button key={c.key} onClick={()=>{setTlCat(c.key);setTl("");setTcl("");setTlMulti([]);}} style={{padding:"6px 12px",fontSize:12,fontWeight:a?700:500,borderRadius:8,border:`1.5px solid ${a?T.goldDark:T.border}`,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>{c.label}</button>);})}</div>
            {(tlCat==="middle"||tlCat==="high"||tlCat==="level")?(<>
              {/* 체크박스형 다중선택 — 같은 시험지를 공유할 때 여러 개 선택 */}
              <div style={S.cw}>{(LV_CATS.find(c=>c.key===tlCat)?.opts||[]).map(o=>{const a=tlMulti.includes(o);return(<button key={o} onClick={()=>setTlMulti(p=>p.includes(o)?p.filter(x=>x!==o):[...p,o])} style={{...S.ch,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,borderColor:a?T.goldDark:T.border,fontWeight:a?700:500,fontSize:12,padding:"7px 12px"}}>{a?"☑ ":"☐ "}{o}</button>);})}</div>
              {tlMulti.length>0&&(<div style={{marginTop:6,display:"flex",gap:5}}>
                <button onClick={()=>setTlMulti([])} style={{padding:"4px 10px",fontSize:11,fontWeight:600,borderRadius:6,border:`1px solid ${T.border}`,background:T.white,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>초기화</button>
              </div>)}
              {tlMulti.length>=2&&(<div style={{marginTop:8,padding:"8px 10px",background:"#FFF8E6",border:`1px solid ${T.goldMuted||"#E8D8A0"}`,borderRadius:8,fontSize:11,color:T.textSub,lineHeight:1.5}}>
                ⚠ <b>{tlMulti.length}개를 하나의 반으로 등록</b>합니다. 반드시 <b>같은 시험지</b>를 공유할 때만 사용하세요.<br/>시험지가 다르면 <b>1개씩 따로</b> 등록해주세요.
              </div>)}
            </>):(<input style={{...S.inp,marginTop:4}} placeholder="직접 입력 (예: 특별반)" value={tcl} onChange={e=>{setTcl(e.target.value);setTl(e.target.value);}}/>)}
          </div>
          {/* 인원 입력 (필수) */}
          <div style={{marginBottom:14}}>
            <div style={S.label}>예상 응시 인원 <span style={{color:T.danger}}>*</span> <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:4}}>(실장님 프린트 장수 산출)</span></div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input style={{...S.inp,maxWidth:120,borderColor:!tcount&&ts&&tg?T.danger:T.border}} placeholder="예: 12" value={tcount} onChange={e=>setTcount(e.target.value.replace(/[^0-9]/g,""))} inputMode="numeric" maxLength={3}/>
              <span style={{fontSize:13,color:T.textSub}}>명</span>
            </div>
            <div style={{fontSize:11,color:T.textMuted,marginTop:4,lineHeight:1.4}}>⚠️ 인원을 입력해야 실장님이 시험지를 몇 장 프린트할지 알 수 있습니다.</div>
          </div>
          {ts&&tg&&(((tlCat==="middle"||tlCat==="high"||tlCat==="level")&&tlMulti.length>0)||(tlCat==="etc"&&tcl))&&(<div style={S.addRow}>
            <div style={{fontSize:14,fontWeight:700,color:T.goldDark}}>{ts} {tg} {(tlCat==="middle"||tlCat==="high"||tlCat==="level")?tlMulti.join("+"):tcl}반{tcount?` · ${tcount}명`:" · (인원 미입력)"}</div>
            <button onClick={addClass} style={{...S.addBtn,opacity:!tcount?.5:1,cursor:!tcount?"not-allowed":"pointer"}} disabled={!tcount}>+ 반 추가</button>
          </div>)}
          {classes.length>0&&(<div style={{marginTop:12}}>
            <div style={{fontSize:12,fontWeight:600,color:T.textMuted,marginBottom:6}}>추가된 반 ({classes.length}개 · 총 {totalStudents}명)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{classes.map((c,i)=>(<div key={i} style={S.tag}><span>{c.name}{c.count?` ${c.count}명`:""}</span><button onClick={()=>setClasses(p=>p.filter((_,j)=>j!==i))} style={S.tagX}>×</button></div>))}</div>
          </div>)}
        </div>
        <div style={S.card}>
          <div style={S.secLabel}>시험 정보</div>
          <ExamTypeSelect val={examType} onChange={setExamType}/>
          <div style={{marginBottom:16}}>
            <div style={S.label}>시험 날짜 / 시간 <span style={{color:T.danger}}>*</span></div>
            <div style={{display:"flex",gap:8}}>
              <input type="date" style={{...S.dateInp,flex:"1 1 55%"}} value={examDate} onChange={e=>setExamDate(e.target.value)}/>
              <input type="time" style={{...S.dateInp,flex:"1 1 40%",minWidth:0}} value={examTime} onChange={e=>setExamTime(e.target.value)}/>
            </div>
          </div>
        </div>
        <button style={S.btnG} onClick={goToMode}>다음 →</button>
      </div>)}
      {/* ═══ 오늘의 현황 대시보드 — 별도 컴포넌트 ═══ */}
      {screen==="home"&&tab==="dashboard"&&(<DashboardTab sheetsUrl={SHEETS_URL} T={T} S={S} teacherList={teacherList} proxyDownload={proxyDownload} proxyPreview={proxyPreview}/>)}
      {/* ═══ 스케줄 관리 탭 — 별도 컴포넌트 ═══ */}
      {screen==="home"&&tab==="schedule"&&(<ScheduleTab sheetsUrl={SHEETS_URL} T={T} S={S} teacherList={teacherList}/>)}
      {/* ═══ 선생님 관리 탭 — 카테고리(관리자/국어/영어/수학) CRUD ═══ */}
      {screen==="home"&&tab==="teachers"&&(<TeachersTab sheetsUrl={SHEETS_URL} T={T} S={S} onChanged={setTeacherList}/>)}
      {/* ═══ 모드 선택 ═══ */}
      {screen==="modeSelect"&&(<div style={S.wrap} className="fade-up">
        <div style={{textAlign:"center",padding:"20px 0 16px"}}><h2 style={{fontSize:20,fontWeight:800,color:T.text,marginBottom:8}}>정답 등록 방식 선택</h2>
          <p style={{fontSize:13,color:T.textMuted}}>어떤 방식으로 정답을 등록할까요?</p></div>
        {/* 미리보기 */}
        <div style={{...S.card,background:T.goldPale,border:`1px solid ${T.goldMuted}`}}>
          <div style={{fontSize:12,color:T.textMuted}}>등록 대상</div>
          <div style={{fontSize:14,fontWeight:700,color:T.goldDark,marginTop:2}}>{classes.map(c=>c.name+(c.count?`(${c.count}명)`:"")).join(", ")}</div>
          <div style={{fontSize:12,color:T.textMuted,marginTop:6}}>시험 종류</div>
          <div style={{fontSize:14,fontWeight:700,color:T.goldDark,marginTop:2}}>{examType} · {dateStr}</div>
          {totalStudents>0&&<div style={{fontSize:12,color:T.blue,marginTop:6,fontWeight:600}}>🖨️ 예상 프린트 {totalStudents}장</div>}
        </div>
        {/* 모드 A: 직접 입력 */}
        <button onClick={()=>setScreen("directSetup")} style={S.modeCard}>
          <div style={{fontSize:28,marginBottom:8}}>⌨️</div>
          <div style={{fontSize:16,fontWeight:800,color:T.text,marginBottom:4}}>직접 입력</div>
          <div style={{fontSize:12,color:T.textSub,lineHeight:1.5}}>정답 번호를 하나씩 클릭해서 입력합니다. 바로 채점이 가능합니다.</div>
          <div style={{fontSize:11,color:T.accent,fontWeight:700,marginTop:8}}>✓ 즉시 채점 가능</div>
        </button>
        {/* 모드 B: 파일 업로드 */}
        <button onClick={()=>setScreen("upload")} style={S.modeCard}>
          <div style={{fontSize:28,marginBottom:8}}>📄</div>
          <div style={{fontSize:16,fontWeight:800,color:T.text,marginBottom:4}}>파일 업로드</div>
          <div style={{fontSize:12,color:T.textSub,lineHeight:1.5}}>정답지 파일을 올리면 Claude가 자동 분석합니다. Cowork 연동이 필요합니다.</div>
          <div style={{fontSize:11,color:T.goldDark,fontWeight:700,marginTop:8}}>⏳ Claude 분석 후 채점 가능</div>
        </button>
        <button style={{...S.btnO,width:"100%",marginTop:8}} onClick={()=>setScreen("home")}>← 뒤로</button>
      </div>)}
      {/* ═══ 직접입력: 문항수 설정 + 파일 업로드(선택) ═══ */}
      {screen==="directSetup"&&(<div style={S.wrap} className="fade-up">
        <div style={S.card}>
          <div style={S.secLabel}>문항 수 설정</div>
          <div style={S.cw}>
            {[30,50,72,100,200,300].map(n=>(<button key={n} onClick={()=>{setTotalQ(n);setCustomQ("");}} style={{...S.ch,background:!customQ&&totalQ===n?T.goldDark:T.white,color:!customQ&&totalQ===n?T.white:T.textSub,borderColor:!customQ&&totalQ===n?T.goldDark:T.border,fontWeight:!customQ&&totalQ===n?700:500}}>{n}</button>))}
            <input style={S.chInp} placeholder="직접" value={customQ} onChange={e=>setCustomQ(e.target.value.replace(/[^0-9]/g,""))} onFocus={()=>setTotalQ(0)}/>
          </div>
        </div>
        {/* 시작번호 설정 */}
        <div style={S.card}>
          <div style={S.secLabel}>시작 번호 <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:4}}>(시험지 첫 번호가 1이 아닌 경우)</span></div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <input type="number" min="1" value={startNum} onChange={e=>setStartNum(Math.max(1,parseInt(e.target.value)||1))} style={{...S.chInp,width:100,textAlign:"center",fontSize:16,fontWeight:700}} placeholder="1"/>
            <span style={{fontSize:12,color:T.textSub}}>번부터 시작</span>
            {startNum>1&&<span style={{fontSize:11,color:T.accent,fontWeight:600}}>→ OMR에 {startNum}(1), {startNum+1}(2)... 표시</span>}
          </div>
        </div>
        {/* 시험지/정답지 파일 업로드 (선택) — 실장님 프린트용 */}
        <div style={S.card}>
          <div style={S.secLabel}>시험지·정답지 파일 <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:4}}>(선택 · 실장님 프린트용)</span></div>
          <div style={{fontSize:12,color:T.textSub,lineHeight:1.6,marginBottom:10}}>
            파일을 올리면 구글 드라이브에 저장돼서 실장님이 바로 프린트할 수 있어요.
          </div>
          <FileUploadMulti label="시험지" files={examFiles} onFilesChange={setExamFiles} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
          <FileUploadMulti label="정답지" files={answerFiles} onFilesChange={setAnswerFiles} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
          {(examFiles.length>0||answerFiles.length>0)&&<div style={{marginTop:8,padding:"10px 12px",borderRadius:8,background:T.accentLight,fontSize:12,color:T.accent,fontWeight:600}}>✓ 저장 시 Google Drive에도 함께 업로드됩니다</div>}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button style={{...S.btnO,flex:1}} onClick={()=>setScreen("modeSelect")}>← 뒤로</button>
          <button style={{...S.btnG,flex:2}} onClick={startDirect}>정답 입력 시작 →</button>
        </div>
      </div>)}
      {/* ═══ 직접입력: 정답 입력 ═══ */}
      {screen==="direct"&&!done&&(<div className="fade-up">
        <div style={S.progA}><div style={S.progBg}><div style={{...S.progF,width:`${(filled/qc)*100}%`,background:filled===qc?T.accent:T.gold}}/></div>
          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:5}}>
            <span style={{fontWeight:700,color:T.goldDark,fontSize:13}}>{filled}</span><span style={{color:T.textMuted,fontSize:13}}>/{qc}</span>
            <span style={{marginLeft:"auto",fontSize:12,fontWeight:600,color:filled===qc?T.accent:T.textMuted}}>{filled===qc?"✓ 완료":`${qc-filled}문항 남음`}</span>
          </div></div>
        <div style={{padding:"6px 12px",background:T.goldPale,fontSize:12,color:T.goldDeep,fontWeight:600,textAlign:"center"}}>{classes.map(c=>c.name).join(", ")} · {examType}</div>
        <div style={{padding:"8px 12px",background:T.accentLight+"55",fontSize:11,color:T.accent,fontWeight:600,textAlign:"center",lineHeight:1.5}}>💡 <b>객관식 복수정답</b>: 2개 이상 버튼 눌러서 선택 · <b>주관식 여러 빈칸</b>: "solve|gathered|announced"처럼 <b>|</b>로 구분 · <b>대체답</b>: "to look/looking"처럼 <b>/</b>로 구분</div>
        <div style={{padding:"8px 10px 100px"}}>
          {Array.from({length:qc},(_,i)=>{const isObj=types[i]==="obj";const sel=answers[i];const fi=_isFilled(sel);
            const selArr=Array.isArray(sel)?sel:(fi&&typeof sel!=="string"?[Number(sel)]:[]);
            const multi=selArr.length>1;
            return(<div key={i} style={{...S.qRow,borderLeft:fi?`3px solid ${isObj?(multi?T.accent:T.gold):T.accent}`:`3px solid transparent`,background:fi?(isObj?(multi?T.accentLight+"66":T.goldPale):T.accentLight+"66"):T.white}}>
              <div style={{...S.qNum,background:fi?(isObj?(multi?T.accent:T.gold):T.accent):T.borderLight,color:fi?T.white:T.textMuted}}>{i+1}</div>
              <button onClick={()=>hType(i)} style={{padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:700,border:`1px solid ${isObj?T.border:T.accent}`,cursor:"pointer",fontFamily:"inherit",background:isObj?T.white:T.accentLight,color:isObj?T.textMuted:T.accent,flex:"0 0 auto"}}>{isObj?"객":"주"}</button>
              {isObj?(<div style={{display:"flex",gap:4,flex:1,alignItems:"center"}}>
                {[1,2,3,4,5].map(v=>{const p=selArr.includes(v);return(<button key={v} onClick={()=>hAns(i,v)} style={{...S.cBtn,background:p?T.goldDark:T.white,color:p?T.white:T.text,borderColor:p?T.goldDark:T.border,fontWeight:p?700:400}}>{v}</button>);})}
                {multi&&<span style={{fontSize:10,fontWeight:700,color:T.accent,marginLeft:4}}>복수 {selArr.join(",")}</span>}
              </div>
              ):(<input style={S.sInp} placeholder="주관식 정답" value={subAns[i]||""} onChange={e=>hSub(i,e.target.value)}/>)}
            </div>);})}
        </div>
        <div style={S.subBar}>
          <button style={{...S.btnO,flex:"0 0 auto",padding:"11px 16px"}} onClick={()=>setScreen("modeSelect")}>← 뒤로</button>
          <div style={{flex:1,textAlign:"center"}}><span style={{fontSize:13,fontWeight:600,color:T.goldDark}}>{filled}/{qc}</span></div>
          <button style={S.subBtn} onClick={saveDirect} disabled={saving}>{saving?"저장 중...":"저장하기"}</button>
        </div>
      </div>)}
      {/* ═══ 파일 업로드 ═══ */}
      {screen==="upload"&&!done&&(<div style={S.wrap} className="fade-up">
        <div style={S.card}>
          <div style={S.secLabel}>파일 업로드</div>
          {/* ★ 반이 2개 이상일 때: 같은/다른 시험지 선택 */}
          {classes.length>=2&&(<div style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:T.goldDeep,marginBottom:8}}>시험지 구분</div>
            <div style={{display:"flex",gap:8}}>
              {[{v:true,label:"같은 시험지",desc:"모든 반 동일"},{v:false,label:"반별 다른 시험지",desc:"반마다 따로 업로드"}].map(o=>{const a=sameExam===o.v;return(
                <button key={String(o.v)} onClick={()=>setSameExam(o.v)} style={{flex:1,padding:"10px",borderRadius:10,border:`1.5px solid ${a?T.goldDark:T.border}`,background:a?T.goldLight:T.white,cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:700,color:a?T.goldDeep:T.text}}>{o.label}</div>
                  <div style={{fontSize:10,color:T.textMuted,marginTop:2}}>{o.desc}</div>
                </button>
              );})}
            </div>
          </div>)}
          {/* ── 같은 시험지 모드 (또는 반 1개) ── 차수 여러 개 지원 ── */}
          {(sameExam||classes.length<=1)&&(<>
            <div style={{fontSize:12,color:T.textSub,lineHeight:1.6,marginBottom:12,padding:"10px 12px",background:T.goldPale,borderRadius:8,border:`1px solid ${T.goldMuted}`}}>
              💡 시험지·정답지 파일을 올려주세요. 차수가 여러 개면 아래 <b>+ 차수 추가</b>로 늘릴 수 있어요.
            </div>
            {rounds.map((rd,ri)=>(
              <div key={ri} style={{padding:"10px 12px",marginBottom:10,border:`2px solid ${T.goldMuted}`,borderRadius:10,background:T.goldPale,position:"relative"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <input style={{...S.inp,flex:1,margin:0,padding:"8px 10px",fontSize:13}} placeholder={`차수명 (예: 1차, 2차, 중간고사 등) — 선택`} value={rd.label||""} onChange={e=>updateRound(ri,"label",e.target.value)}/>
                  {rounds.length>1&&(<button onClick={()=>setRounds(p=>p.filter((_,j)=>j!==ri))} style={{padding:"6px 10px",fontSize:11,borderRadius:6,border:`1px solid ${T.danger}`,background:T.white,color:T.danger,cursor:"pointer"}}>✕ 삭제</button>)}
                </div>
                <FileUploadMulti label={`시험지${rd.label?" ("+rd.label+")":""}`} files={rd.examFiles} onFilesChange={v=>updateRound(ri,"examFiles",v)} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
                <FileUploadMulti label={`정답지${rd.label?" ("+rd.label+")":""}`} files={rd.answerFiles} onFilesChange={v=>updateRound(ri,"answerFiles",v)} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
              </div>
            ))}
            <button onClick={()=>setRounds(p=>[...p,{label:"",examFiles:[],answerFiles:[]}])} style={{width:"100%",padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,borderRadius:10,border:`2px dashed ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer",fontFamily:"inherit"}}>+ 차수 추가</button>
          </>)}
          {/* ── 반별 다른 시험지 모드 ── 각 반별로 차수 여러 개 지원 ── */}
          {!sameExam&&classes.length>=2&&(<>
            <div style={{fontSize:12,color:T.textSub,lineHeight:1.6,marginBottom:12,padding:"10px 12px",background:T.goldPale,borderRadius:8,border:`1px solid ${T.goldMuted}`}}>
              💡 각 반별로 시험지·정답지를 따로 올려주세요. 반별로 차수도 여러 개 추가할 수 있어요.
            </div>
            {classes.map((cls,ci)=>(
              <div key={ci} style={{marginBottom:14,border:`2px solid ${T.blue}40`,borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"10px 14px",background:T.blueLight,fontWeight:700,fontSize:13,color:T.blue}}>{cls.name}</div>
                <div style={{padding:"10px 12px"}}>
                  {(classRounds[cls.name]||[]).map((rd,ri)=>(
                    <div key={ri} style={{padding:"10px 12px",marginBottom:8,border:`1.5px solid ${T.goldMuted}`,borderRadius:10,background:T.goldPale}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                        <input style={{...S.inp,flex:1,margin:0,padding:"8px 10px",fontSize:13}} placeholder={`차수명 (예: 1차, 2차) — 선택`} value={rd.label||""} onChange={e=>updateClassRound(cls.name,ri,"label",e.target.value)}/>
                        {(classRounds[cls.name]||[]).length>1&&(<button onClick={()=>setClassRounds(p=>({...p,[cls.name]:(p[cls.name]||[]).filter((_,j)=>j!==ri)}))} style={{padding:"6px 10px",fontSize:11,borderRadius:6,border:`1px solid ${T.danger}`,background:T.white,color:T.danger,cursor:"pointer"}}>✕ 삭제</button>)}
                      </div>
                      <FileUploadMulti label={`시험지${rd.label?" ("+rd.label+")":""}`} files={rd.examFiles} onFilesChange={v=>updateClassRound(cls.name,ri,"examFiles",v)} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
                      <FileUploadMulti label={`정답지${rd.label?" ("+rd.label+")":""}`} files={rd.answerFiles} onFilesChange={v=>updateClassRound(cls.name,ri,"answerFiles",v)} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
                    </div>
                  ))}
                  <button onClick={()=>setClassRounds(p=>({...p,[cls.name]:[...(p[cls.name]||[]),{label:"",examFiles:[],answerFiles:[]}]}))} style={{width:"100%",padding:"8px 12px",fontSize:12,fontWeight:700,borderRadius:8,border:`2px dashed ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer",fontFamily:"inherit"}}>+ 차수 추가</button>
                </div>
              </div>
            ))}
          </>)}
          <div style={{padding:"12px 14px",borderRadius:10,background:T.blueLight,border:`1px solid ${T.blue}30`,marginTop:8}}>
            <div style={{fontSize:12,fontWeight:700,color:T.blue,marginBottom:4}}>💡 이렇게 처리됩니다</div>
            <div style={{fontSize:12,color:T.textSub,lineHeight:1.7}}>1. 드라이브에 저장됩니다.<br/>2. Claude가 정답지를 분석하여 정답을 추출합니다.<br/>3. 학생 앱에서 시험 선택 시 <b>차수</b>가 표시됩니다.</div>
          </div>
        </div>
        {/* 주관식 힌트 입력 */}
        <div style={S.card}>
          <div style={S.secLabel}>주관식 문항 힌트 <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:4}}>(Claude 분석 정확도↑)</span></div>
          <div style={{fontSize:12,color:T.textSub,lineHeight:1.6,marginBottom:10}}>시험에 주관식이 섞여 있으면 꼭 알려주세요. 특히 <b>수학/서술형</b>은 필수예요.</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:subjMode==="none"?0:12}}>
            {[
              {v:"none",label:"전체 객관식 (5지선다)",desc:"1~5번 중 하나 선택"},
              {v:"mixed",label:"객관식 + 주관식 혼합",desc:"일부 문항이 주관식"},
              {v:"all",label:"전체 주관식",desc:"서술형/단답형만"}
            ].map(o=>{const a=subjMode===o.v;return(
              <button key={o.v} onClick={()=>setSubjMode(o.v)} style={{padding:"12px 14px",borderRadius:10,border:`1.5px solid ${a?T.goldDark:T.border}`,background:a?T.goldLight:T.white,cursor:"pointer",fontFamily:"inherit",textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${a?T.goldDark:T.border}`,flex:"0 0 auto",display:"flex",alignItems:"center",justifyContent:"center"}}>{a&&<div style={{width:8,height:8,borderRadius:"50%",background:T.goldDark}}/>}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:a?T.goldDeep:T.text}}>{o.label}</div>
                  <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>{o.desc}</div>
                </div>
              </button>
            );})}
          </div>
          {subjMode==="mixed"&&(<div style={{padding:"12px 14px",borderRadius:10,background:T.goldPale,border:`1px solid ${T.goldMuted}`}}>
            <div style={{fontSize:12,fontWeight:700,color:T.goldDeep,marginBottom:8}}>📍 주관식 문항 번호 (선택)</div>
            <div style={{fontSize:11,color:T.textSub,lineHeight:1.6,marginBottom:10}}>
              주관식 번호만 입력하면 <b>나머지는 자동으로 객관식</b>으로 처리돼요.<br/>
              모르면 비워두셔도 OK — Claude가 정답지를 보고 추정합니다.
            </div>
            <div>
              <input style={S.inp} placeholder="예: 21-30, 41-45" value={subjRanges} onChange={e=>setSubjRanges(e.target.value)}/>
            </div>
            <div style={{fontSize:10,color:T.textMuted,marginTop:8,lineHeight:1.5}}>
              💡 쉼표 구분, 범위는 하이픈. 예: <code>21-30, 45, 50-55</code>
            </div>
          </div>)}
        </div>
        <div style={S.card}>
          <div style={S.label}>메모 (선택사항) <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:6}}>📊 오늘의 현황 대시보드에 표시됩니다 (실장님/교사 참고용)</span></div>
          <textarea style={S.textarea} placeholder="예: 시험지 인쇄 시 A4 2장, 서술형 포함, 레벨별 난이도 다름 등" value={memo} onChange={e=>setMemo(e.target.value)} rows={2}/>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button style={{...S.btnO,flex:1}} onClick={()=>setScreen("modeSelect")}>← 뒤로</button>
          <button style={{...S.btnG,flex:2}} onClick={saveUpload} disabled={saving}>{saving?"업로드 중...":"시험 등록하기"}</button>
        </div>
      </div>)}
      {/* ═══ 저장 중 ═══ */}
      {saving&&(<div style={S.overlay}><div style={S.modal}>
        <div style={{width:40,height:40,border:`3px solid ${T.borderLight}`,borderTopColor:T.gold,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 16px"}}/>
        <p style={{fontSize:15,fontWeight:700,color:T.text}}>저장 중...</p>
      </div></div>)}
      {/* ═══ 완료 ═══ */}
      {screen==="done"&&(<div style={S.wrap} className="fade-up">
        <div style={{textAlign:"center",padding:"48px 20px"}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <h2 style={{fontSize:22,fontWeight:800,color:T.text,marginBottom:12}}>시험 등록 완료!</h2>
          <div style={{...S.card,textAlign:"left"}}>
            <div style={S.resRow}><span>선생님</span><span style={{fontWeight:600}}>{teacher}</span></div>
            <div style={S.resRow}><span>대상 반</span><span style={{fontWeight:600}}>{classes.map(c=>c.name).join(", ")}</span></div>
            <div style={S.resRow}><span>시험 종류</span><span style={{fontWeight:600}}>{examType}</span></div>
            <div style={S.resRow}><span>날짜/시간</span><span style={{fontWeight:600}}>{dateStr}</span></div>
            {totalStudents>0&&<div style={S.resRow}><span>예상 인원</span><span style={{fontWeight:600}}>{totalStudents}명 (프린트 참고)</span></div>}
            {filled>0&&<div style={S.resRow}><span>정답 입력</span><span style={{fontWeight:600}}>{filled}문항</span></div>}
          </div>
          <div style={{padding:"12px 14px",borderRadius:10,background:T.accentLight,fontSize:13,fontWeight:600,color:T.accent,textAlign:"center",marginBottom:20}}>
            {filled>0?"✅ 학생들이 이 시험을 선택하면 즉시 채점됩니다!":"📄 Claude가 정답지를 분석하면 채점이 가능해집니다."}
          </div>
          <button style={{...S.btnG,maxWidth:320,margin:"0 auto"}} onClick={reset}>다른 시험 등록하기</button>
        </div>
      </div>)}
      {error&&<div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:T.dangerLight,color:T.danger,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:600,zIndex:999}}>{error}</div>}
    </div>
  );
}
const S={
  app:{fontFamily:"'Noto Sans KR',-apple-system,sans-serif",background:T.bg,minHeight:"100vh",maxWidth:480,margin:"0 auto",paddingBottom:20},
  hdr:{background:T.white,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,zIndex:100},
  hdrIn:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",maxWidth:480,margin:"0 auto"},
  // NOTE: maxWidth는 CSS 클래스(.app-shell, .hdr-inner)로 반응형 오버라이드됨
  logoR:{display:"flex",alignItems:"center",gap:10},logoM:{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${T.gold},${T.goldDark})`,color:T.white,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,letterSpacing:-1},
  hdrT:{fontSize:15,fontWeight:800,color:T.text,letterSpacing:-.3},hdrS:{fontSize:10,color:T.textMuted,fontWeight:500,marginTop:-1},
  hdrB:{fontSize:10,fontWeight:600,color:T.goldDark,background:T.goldLight,padding:"4px 10px",borderRadius:20,whiteSpace:"nowrap"},
  wrap:{padding:"16px 14px"},
  card:{background:T.white,borderRadius:14,padding:"20px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.04)",border:`1px solid ${T.borderLight}`},
  secLabel:{fontSize:14,fontWeight:800,color:T.goldDark,marginBottom:14,paddingBottom:8,borderBottom:`2px solid ${T.goldLight}`},
  label:{fontSize:13,fontWeight:600,color:T.textSub,marginBottom:6},
  inp:{width:"100%",padding:"11px 14px",fontSize:15,borderRadius:10,border:`1.5px solid ${T.border}`,background:T.bg,color:T.text,fontFamily:"inherit"},
  textarea:{width:"100%",padding:"11px 14px",fontSize:14,borderRadius:10,border:`1.5px solid ${T.border}`,background:T.bg,color:T.text,fontFamily:"inherit",resize:"vertical",lineHeight:1.5},
  dateInp:{padding:"11px 14px",fontSize:15,borderRadius:10,border:`1.5px solid ${T.border}`,background:T.bg,color:T.text,fontFamily:"inherit",cursor:"pointer"},
  cw:{display:"flex",flexWrap:"wrap",gap:6},
  ch:{padding:"8px 14px",borderRadius:20,border:"1.5px solid",fontSize:13,cursor:"pointer",fontFamily:"inherit",transition:"all .12s"},
  chInp:{padding:"8px 14px",borderRadius:20,border:`1.5px solid ${T.border}`,fontSize:13,fontFamily:"inherit",width:80,textAlign:"center"},
  addRow:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:T.goldPale,borderRadius:10,border:`1px solid ${T.goldMuted}`,marginBottom:4},
  addBtn:{padding:"8px 16px",borderRadius:10,border:"none",background:`linear-gradient(135deg,${T.gold},${T.goldDark})`,color:T.white,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"},
  tag:{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:20,background:T.accentLight,border:`1px solid ${T.accent}40`,fontSize:13,fontWeight:600,color:T.accent},
  tagX:{background:"none",border:"none",color:T.danger,fontWeight:700,fontSize:16,cursor:"pointer",padding:0,lineHeight:1},
  modeCard:{display:"block",width:"100%",background:T.white,borderRadius:14,padding:"24px 20px",marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,0.04)",border:`1px solid ${T.borderLight}`,cursor:"pointer",fontFamily:"inherit",textAlign:"center",transition:"all .15s"},
  btnG:{width:"100%",padding:"14px",fontSize:15,fontWeight:700,color:T.white,background:`linear-gradient(135deg,${T.gold},${T.goldDark})`,border:"none",borderRadius:12,cursor:"pointer",fontFamily:"inherit"},
  btnO:{padding:"12px",fontSize:14,fontWeight:600,color:T.textSub,background:T.white,border:`1.5px solid ${T.border}`,borderRadius:12,cursor:"pointer",fontFamily:"inherit"},
  uploadBox:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"28px 16px",borderRadius:12,border:`2px dashed ${T.border}`,background:T.bg,cursor:"pointer",transition:"all .2s"},
  fileCard:{display:"flex",alignItems:"center",padding:"12px 14px",borderRadius:10,background:T.accentLight,border:`1px solid ${T.accent}40`,gap:10},
  rmBtn:{width:28,height:28,borderRadius:14,border:"none",background:T.dangerLight,color:T.danger,fontSize:14,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  progA:{padding:"10px 14px 4px",background:T.white,borderBottom:`1px solid ${T.borderLight}`},
  progBg:{height:5,borderRadius:3,background:T.borderLight,overflow:"hidden"},progF:{height:"100%",borderRadius:3,transition:"width .3s,background .3s"},
  qRow:{display:"flex",alignItems:"center",gap:6,padding:"7px 6px 7px 5px",marginBottom:3,borderRadius:10,transition:"all .12s"},
  qNum:{flex:"0 0 28px",height:28,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700},
  cBtn:{flex:1,height:36,minWidth:0,borderRadius:9,border:"1.5px solid",fontSize:14,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"},
  sInp:{flex:1,padding:"8px 12px",fontSize:14,borderRadius:9,border:`1.5px solid ${T.border}`,fontFamily:"inherit",background:T.bg},
  subBar:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:T.white,borderTop:`1px solid ${T.border}`,padding:"10px 16px",paddingBottom:"max(10px,env(safe-area-inset-bottom))",display:"flex",alignItems:"center",gap:10,zIndex:200}, /* sub-bar-fix 클래스로 PC 반응형 */
  subBtn:{padding:"11px 24px",fontSize:15,fontWeight:700,color:T.white,background:`linear-gradient(135deg,${T.gold},${T.goldDark})`,border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20},
  modal:{background:T.white,borderRadius:18,padding:"40px 20px",maxWidth:320,width:"100%",textAlign:"center"},
  resRow:{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${T.borderLight}`,fontSize:13,color:T.text},
  sumCard:{background:T.white,borderRadius:12,padding:"12px 8px",border:`1px solid ${T.borderLight}`,textAlign:"center",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"},
  pill:{padding:"4px 10px",borderRadius:20,background:T.goldPale,color:T.goldDeep,fontWeight:700},
  pillBlue:{padding:"4px 10px",borderRadius:20,background:T.blueLight,color:T.blue,fontWeight:700},
  pillGreen:{padding:"4px 10px",borderRadius:20,background:T.accentLight,color:T.accent,fontWeight:700},
  pillGold:{padding:"4px 10px",borderRadius:20,background:T.goldLight,color:T.goldDark,fontWeight:700},
};