import { useState, useCallback, useEffect, useMemo } from "react";
/* ============================================================
   채움학원 — 선생님용 시험 등록 v2
   신규: 선생님 이름, 반별 인원, 오늘의 현황 대시보드
   ============================================================ */
const SHEETS_URL = "https://script.google.com/macros/s/AKfycbzablzeV_gVdLoUG-Oh4s02vNmncvteesBn3875WDF3lO176nc4YzAKj7B6zOJVECQO/exec";
// v21.3: AI 검수를 Vercel Edge Function 으로 이동 (GAS URL Fetch 한도 우회)
// - 같은 Vercel 도메인이면 상대경로 "/api/ai-extract"
// - 다른 도메인이면 절대 URL 입력 (예: "https://your-app.vercel.app/api/ai-extract")
// - 빈 문자열 ""이면 GAS 호출로 폴백
const AI_EXTRACT_URL = "/api/ai-extract";
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
  // ★ v2: 시험 날짜/시간 (문제 생성 → 구글드라이브 폴더명에 사용)
  const[examDate,setExamDate]=useState(()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;});
  const[examTime,setExamTime]=useState("19:00");
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
  // ★ v20.5: 히스토리 필터 (선생님 선택 → 본인 자료만 보기) + 페이지네이션
  const[histFilterTeacher,setHistFilterTeacher]=useState("");
  const[histVisibleCount,setHistVisibleCount]=useState(3);
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
        examDate,                 // ★ v2: 시험 날짜 (YYYY-MM-DD)
        examTime,                 // ★ v2: 시험 시간 (HH:MM)
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
  // ★ v23.7: A세트 ↔ B세트 교체 — text/plain + 응답 검증 (no-cors silent 실패 제거)
  const swapExamSet=async(rowIndex,activeNow)=>{
    const targetLabel=activeNow==="A"?"B":"A";
    if(!confirm(`현재 ${activeNow}세트가 학생앱에 노출 중입니다.\n${targetLabel}세트로 교체하시겠습니까?\n\n학생들이 보는 시험 문제가 즉시 바뀝니다.`))return;
    try{
      const r=await fetch(sheetsUrl,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({action:"swap_exam_set",rowIndex})
      });
      const text=await r.text();
      let d; try{d=JSON.parse(text);}catch(_e){d={result:"error",message:text.substring(0,100)};}
      if(d.result==="ok"||d.result==="success"){
        alert(`✅ ${targetLabel}세트로 교체 완료!\n학생앱에 즉시 반영됩니다.`);
        loadHistory();
      }else{
        alert(`❌ 교체 실패\n\n사유: ${d.message||"알 수 없는 오류"}\n\n다시 시도해주세요.`);
      }
    }catch(e){alert("네트워크 오류: "+String(e));}
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
  // ★ v23.7: OMR 시험 등록 — 안정화 (응답 검증 + 자동 재시도 + 사후 역검증)
  // ─ 이전 버그: mode:"no-cors" + application/json 으로 응답을 못 읽어 silent 실패 발생 가능
  // ─ 신뢰 패턴: text/plain (CORS simple request) → 응답 읽기 → result 검증 → 실패시 재시도
  const registerExam=async()=>{
    if(!preview||!preview.sets||preview.sets.length===0)return alert("문제 데이터가 없습니다.");
    const chosenSet=preview.sets[selectedSet];
    if(!chosenSet)return alert("세트를 선택하세요.");
    const qs=chosenSet.questions||[];
    if(qs.length===0)return alert("문제가 없습니다.");
    // ─── ① 전송 전 무결성 검증 — 빈 정답·중복 번호·문항수 불일치 차단 ───
    const answersObj={};const typesObj={};
    const emptyQs=[];const dupQs=[];
    qs.forEach((q,i)=>{
      const qNum=String(q.number||(i+1));
      if(answersObj[qNum]!==undefined)dupQs.push(qNum);
      const ans=q.type==="mc"?q.answer:String(q.answer||"");
      if(ans===undefined||ans===null||String(ans).trim()==="")emptyQs.push(qNum);
      answersObj[qNum]=ans;
      typesObj[qNum]=q.type==="mc"?"obj":"sub";
    });
    if(dupQs.length>0){
      return alert(`❌ 등록 차단 — 중복된 문항 번호: ${dupQs.join(", ")}\n\n생성기 데이터에 문제가 있어요.\n미리보기를 닫고 재생성하거나 새로고침 후 다시 시도하세요.`);
    }
    if(Object.keys(answersObj).length!==qs.length){
      return alert(`❌ 등록 차단 — 문항 수 불일치\n시도: ${qs.length}개 / 정답 등록 예정: ${Object.keys(answersObj).length}개\n\n번호가 중복되었거나 누락된 것 같아요. 재생성 권장.`);
    }
    if(emptyQs.length>0){
      if(!confirm(`⚠️ 정답이 비어있는 문항: ${emptyQs.join(", ")}\n\n이 문항은 학생이 채점받지 못합니다.\n그래도 등록할까요?`))return;
    }
    // ─── ② 메타 추출 ───
    const tcParts=(preview.targetClass||"").split(/\s+/);
    const regSubject=tcParts[0]||"영어";
    const regGrade=tcParts[1]||"";
    const regLevel=(tcParts[2]||"").replace(/반$/,"");
    const _pgSetType=(preview.setType||"").trim();
    const body={
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
    };
    setSending(true);
    // ─── ③ 신뢰 POST — text/plain (CORS simple) + 응답 검증 + 재시도 3회 ───
    const tryOnce=async()=>{
      const r=await fetch(sheetsUrl,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify(body)
      });
      const text=await r.text();
      try{return JSON.parse(text);}
      catch(_e){return{result:"error",message:"응답 파싱 실패: "+text.substring(0,80)};}
    };
    let lastResult=null;
    for(let attempt=1;attempt<=3;attempt++){
      try{
        lastResult=await tryOnce();
        if(lastResult.result==="success"||lastResult.result==="ok")break;
      }catch(e){
        lastResult={result:"error",message:String(e)};
      }
      if(attempt<3)await new Promise(r=>setTimeout(r,800*attempt));
    }
    // ─── ④ 사후 역검증 (1차) — 서버 응답의 savedAnswers / rowIndex 직접 비교 ───
    let verifyMsg="";
    if(lastResult&&(lastResult.result==="success"||lastResult.result==="ok")){
      const savedCnt=Number(lastResult.savedAnswers||0);
      const rowIdx=lastResult.rowIndex;
      if(savedCnt>0&&savedCnt===qs.length){
        verifyMsg=`✅ 서버 검증 OK — 행 #${rowIdx} 에 ${savedCnt}문항 정확히 저장됨`;
      }else if(lastResult.warning){
        verifyMsg=`⚠️ ${lastResult.warning}\n시트를 직접 확인하세요.`;
      }
      // 2차 역검증 — 학생앱과 동일한 list_exams_by_date 로 외부 시점에서도 보이는지 확인
      try{
        const today=new Date().toISOString().split("T")[0].replace(/-/g,".");
        const vr=await fetch(`${sheetsUrl}?action=admin_list_exams_by_date&date=${encodeURIComponent(today)}`);
        const vd=await vr.json();
        if(vd&&vd.result==="ok"&&Array.isArray(vd.exams)){
          const matched=vd.exams.find(x=>
            String(x.className||"").trim()===String(preview.targetClass||"").trim()&&
            String(x.examType||"")==="문제생성기"&&
            (String(x.setType||"")===_pgSetType||String(x.setType||"")===body.round)
          );
          if(!matched){
            verifyMsg+=`\n⚠️ 외부 조회에서 방금 등록한 시험을 못 찾았어요. 잠시 후 학생앱 확인 필요.`;
          }
        }
      }catch(_e){/* 2차 검증 실패는 등록 자체에 영향 X */}
    }
    setSending(false);
    if(lastResult&&(lastResult.result==="success"||lastResult.result==="ok")){
      const objCnt=Object.values(typesObj).filter(t=>t==="obj").length;
      const subCnt=Object.values(typesObj).filter(t=>t==="sub").length;
      alert(`✅ ${_pgSetType||("세트 "+["A","B","C"][selectedSet])}로 시험이 등록되었습니다!\n\n📝 ${qs.length}문항 (객관식 ${objCnt} · 주관식 ${subCnt})\n${verifyMsg||""}\n\n학생들이 선택할 수 있어요.`);
      setStep(1);setPreview(null);loadHistory();
    }else{
      alert(`❌ 등록 실패 (3회 시도)\n\n사유: ${lastResult?.message||"알 수 없는 오류"}\n\n네트워크 확인 후 다시 시도하거나, 새로고침해주세요.\n중복 등록 방지를 위해 시트의 정답목록도 한 번 확인하시는 게 좋아요.`);
    }
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
      {/* ★ v2: 시험 날짜/시간 */}
      <div style={{marginBottom:14,padding:"12px 14px",border:`1.5px solid ${T.goldMuted}`,borderRadius:10,background:T.goldPale}}>
        <div style={{fontSize:13,fontWeight:700,color:T.goldDeep,marginBottom:8}}>📅 시험 날짜 / 시간</div>
        <div style={{display:"flex",gap:8}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>시험 날짜</div>
            <input type="date" style={{...S.inp,width:"100%"}} value={examDate} onChange={e=>setExamDate(e.target.value)}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>시험 시간</div>
            <input type="time" style={{...S.inp,width:"100%"}} value={examTime} onChange={e=>setExamTime(e.target.value)}/>
          </div>
        </div>
        <div style={{fontSize:11,color:T.textMuted,marginTop:6,lineHeight:1.5}}>선택한 날짜 폴더 아래 선생님 폴더에 문제가 저장됩니다. (예: 2026.04.24 / 김선생 / …)</div>
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
      {/* ★ v20.5: 선생님 필터 — 본인 자료만 보기 */}
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8,padding:"8px 10px",background:T.bg,borderRadius:8}}>
        <span style={{fontSize:11,color:T.textMuted,whiteSpace:"nowrap"}}>👤 선생님</span>
        {_tl&&_tl.length>0?(
          <select value={histFilterTeacher} onChange={e=>{setHistFilterTeacher(e.target.value);setHistVisibleCount(3);}} style={{...S.inp,flex:1,fontSize:12,padding:"6px 8px"}}>
            <option value="">전체 선생님 ({history.length}건)</option>
            {["국어","영어","수학","과학","사회"].map(sub=>{
              const subT=_tl.filter(t=>t.subject===sub);
              if(subT.length===0)return null;
              return(<optgroup key={sub} label={sub+"과"}>{subT.map(t=>{
                const cnt=history.filter(h=>h.teacher===t.name).length;
                return(<option key={t.name} value={t.name}>{t.name} ({cnt}건)</option>);
              })}</optgroup>);
            })}
            {_tl.filter(t=>!["국어","영어","수학","과학","사회"].includes(t.subject)).length>0&&(
              <optgroup label="기타">{_tl.filter(t=>!["국어","영어","수학","과학","사회"].includes(t.subject)).map(t=>{
                const cnt=history.filter(h=>h.teacher===t.name).length;
                return(<option key={t.name} value={t.name}>{t.name} ({cnt}건)</option>);
              })}</optgroup>
            )}
          </select>
        ):(<input style={{...S.inp,flex:1,fontSize:12,padding:"6px 8px"}} placeholder="선생님 이름" value={histFilterTeacher} onChange={e=>{setHistFilterTeacher(e.target.value);setHistVisibleCount(3);}}/>)}
        {histFilterTeacher&&<button onClick={()=>{setHistFilterTeacher("");setHistVisibleCount(3);}} style={{fontSize:11,padding:"4px 8px",border:`1px solid ${T.border}`,borderRadius:6,background:T.white,color:T.textMuted,cursor:"pointer",fontFamily:"inherit"}}>초기화</button>}
      </div>
      {(()=>{
        const filteredHistory=histFilterTeacher?history.filter(h=>h.teacher===histFilterTeacher):history;
        const visible=filteredHistory.slice(0,histVisibleCount);
        if(histLoading)return<div style={{textAlign:"center",padding:20,color:T.textMuted,fontSize:13}}>로딩 중…</div>;
        if(filteredHistory.length===0)return<div style={{textAlign:"center",padding:20,color:T.textMuted,fontSize:13}}>{histFilterTeacher?`${histFilterTeacher} 선생님의 생성 요청이 없습니다`:"아직 생성 요청이 없습니다"}</div>;
        return<>{visible.map((h,i)=>{
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
             <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
               <button onClick={()=>loadPreview(h.rowIndex)} disabled={prevLoading&&prevRow===h.rowIndex}
                 style={{flex:"1 1 30%",padding:"8px",fontSize:12,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer",fontFamily:"inherit"}}>
                 {prevLoading&&prevRow===h.rowIndex?"로딩…":"👁️ 미리보기"}
               </button>
               <button onClick={()=>autoRegisterForStudents(h.rowIndex)}
                 style={{flex:"1 1 30%",padding:"8px",fontSize:12,fontWeight:600,borderRadius:8,border:"none",background:T.accent,color:T.white,cursor:"pointer",fontFamily:"inherit"}}>📱 학생앱 등록</button>
               {/* ★ v20.5: 개별 다운로드 — Drive 결과파일 직접 다운로드 */}
               {h.resultFileId&&<button onClick={()=>{
                 window.open(`https://drive.google.com/uc?export=download&id=${h.resultFileId}`,"_blank");
               }} title="결과 파일(JSON) 다운로드"
                 style={{flex:"1 1 30%",padding:"8px",fontSize:12,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.blue}`,background:T.white,color:T.blue,cursor:"pointer",fontFamily:"inherit"}}>
                 📥 다운로드{h.resultFileIdB?" (A)":""}
               </button>}
               {h.resultFileIdB&&<button onClick={()=>{
                 window.open(`https://drive.google.com/uc?export=download&id=${h.resultFileIdB}`,"_blank");
               }} title="B세트 결과 파일(JSON) 다운로드"
                 style={{flex:"1 1 30%",padding:"8px",fontSize:12,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.blue}`,background:T.white,color:T.blue,cursor:"pointer",fontFamily:"inherit"}}>
                 📥 다운로드 (B)
               </button>}
               {h.resultFileIdB&&<button onClick={()=>swapExamSet(h.rowIndex,h.activeSet||"A")}
                 title={`현재 ${h.activeSet||"A"}세트가 노출 중 — ${(h.activeSet||"A")==="A"?"B":"A"}세트로 교체`}
                 style={{flex:"1 1 30%",padding:"8px",fontSize:12,fontWeight:700,borderRadius:8,border:"none",background:"#FFB300",color:T.white,cursor:"pointer",fontFamily:"inherit"}}>
                 🔄 {(h.activeSet||"A")==="A"?"B":"A"}세트로 교체
               </button>}
             </div>
           </div>}
           {h.status==="생성중"&&<div style={{padding:"6px 10px",borderRadius:8,background:"#FFF3E0",fontSize:12,color:"#E65100",fontWeight:600,textAlign:"center",marginTop:6}}>
             ⏳ Claude가 문제를 만들고 있어요… (약 10분)
           </div>}
         </div>);
       })}
       {/* ★ v20.5: 더보기 / 접기 */}
       {filteredHistory.length>histVisibleCount&&<button onClick={()=>setHistVisibleCount(c=>c+5)}
         style={{width:"100%",padding:"10px",marginTop:4,fontSize:12,fontWeight:600,borderRadius:10,border:`1.5px solid ${T.border}`,background:T.bg,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>
         ⬇ 더보기 ({filteredHistory.length-histVisibleCount}건 더 / 총 {filteredHistory.length}건)
       </button>}
       {histVisibleCount>3&&filteredHistory.length<=histVisibleCount&&<button onClick={()=>setHistVisibleCount(3)}
         style={{width:"100%",padding:"8px",marginTop:4,fontSize:11,fontWeight:500,borderRadius:10,border:`1px dashed ${T.border}`,background:"transparent",color:T.textMuted,cursor:"pointer",fontFamily:"inherit"}}>
         ⬆ 3개만 보기
       </button>}
       </>;
      })()}
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
/* ═══ 반별 성적 탭 (v20.5) ═══
   - 필터 순서: [날짜모드: 단일/기간] [날짜] [과목] [선생님] [학년]
   - 기본 = 오늘 + 전체 과목 + 전체 선생님 + 전체 학년
   - 미달 기준 = 70점 미만 (고정)
   - 카드 정렬: 과목 > 학년 > 선생님 > 레벨 > 시험명
   - 학생별 성적: 점수 높은 순 + 틀린문제 토글 (기본 접힘)
   - 어려운 문항 Top 5
   - 전체 조회 시: 과목/학년 헤더로 그룹핑
   - 기간 모드: 학생별 누적 흐름 (반 단위로 묶음, 학생 점수 추세)
   - 카드 제목: {과목} {학년} {레벨}반 · {시험명}  (👤 {선생님})
*/
// ★ v23.5: 그룹화된 diff — 연속된 del+add 를 "replace"로 묶고, 단독 add는 "addition"으로
//   학생답 본문에는 빨간 취소선만 표시 (read flow 방해 X)
//   아래에 별도 박스로 "수정/추가 가이드" 1) X → Y  2) Y 추가 형식
function diffWordsKor(correct, student) {
  // ★ LOOSE 모드: 문장 끝 구두점 제거·아포스트로피 단어 내 유지·다중 공백 정규화
  const _prep = s => String(s||"").trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  const _tok = s => _prep(s).split(/(\s+|[,;:"])/).filter(t => t && !/^\s+$/.test(t));
  const a = _tok(correct), b = _tok(student);
  const m = a.length, n = b.length;
  const dp = Array(m+1).fill(null).map(()=>Array(n+1).fill(0));
  for (let i=1; i<=m; i++) for (let j=1; j<=n; j++) {
    if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1] + 1;
    else dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
  }
  const ops = [];
  let i=m, j=n;
  while (i>0 && j>0) {
    if (a[i-1] === b[j-1]) { ops.push({op:"keep", text:a[i-1]}); i--; j--; }
    else if (dp[i-1][j] >= dp[i][j-1]) { ops.push({op:"add", text:a[i-1]}); i--; }
    else { ops.push({op:"del", text:b[j-1]}); j--; }
  }
  while (i>0) { ops.push({op:"add", text:a[i-1]}); i--; }
  while (j>0) { ops.push({op:"del", text:b[j-1]}); j--; }
  return ops.reverse();
}

// ★ v23.5: ops를 그룹으로 묶기 — 연속된 add/del 처리
function groupDiffOps(ops) {
  const groups = []; // [{type:"keep"|"replace"|"add"|"del", from?, to?, text?}]
  let i = 0;
  while (i < ops.length) {
    const o = ops[i];
    if (o.op === "keep") {
      groups.push({type:"keep", text:o.text});
      i++;
    } else {
      // 연속된 del 모음
      const dels = [];
      while (i < ops.length && ops[i].op === "del") { dels.push(ops[i].text); i++; }
      // 연속된 add 모음
      const adds = [];
      while (i < ops.length && ops[i].op === "add") { adds.push(ops[i].text); i++; }
      // 분류
      if (dels.length > 0 && adds.length > 0) {
        groups.push({type:"replace", from: dels.join(" ").replace(/\s+([.,!?;:])/g,"$1"), to: adds.join(" ").replace(/\s+([.,!?;:])/g,"$1")});
      } else if (dels.length > 0) {
        groups.push({type:"del", text: dels.join(" ").replace(/\s+([.,!?;:])/g,"$1")});
      } else if (adds.length > 0) {
        groups.push({type:"add", text: adds.join(" ").replace(/\s+([.,!?;:])/g,"$1")});
      }
    }
  }
  return groups;
}

// ★ v23.5: 학생답 본문 (빨간 취소선만) + 별도 가이드 박스
function DiffView({correct, student, T}) {
  if (!correct && !student) return null;
  const ops = diffWordsKor(correct, student);
  const groups = groupDiffOps(ops);
  // 본문: 학생답 표시 — keep(검정) + del(빨강 취소선) + replace의 from(빨강 취소선)
  // add(추가 필요)는 본문에서 제외하고 아래 가이드로
  const guides = []; // {type:"replace"|"add", from?, to?, text?}
  groups.forEach(g=>{ if(g.type==="replace"||g.type==="add") guides.push(g); });
  return (
    <>
      <span style={{lineHeight:1.7}}>
        {groups.map((g,i)=>{
          if (g.type === "keep") return <span key={i}>{g.text} </span>;
          if (g.type === "del" || g.type === "replace") {
            const txt = g.type === "del" ? g.text : g.from;
            return <span key={i} style={{background:"#ffebee",color:"#C62828",textDecoration:"line-through",padding:"0 3px",borderRadius:3,margin:"0 1px"}} title="빼야 함">{txt} </span>;
          }
          // add는 본문에서 표시 안 함 (가이드에 표시)
          return null;
        })}
      </span>
      {guides.length > 0 && (
        <div style={{marginTop:6,padding:"6px 10px",background:"#f0f9f0",border:`1px dashed #66bb6a`,borderRadius:4,fontSize:11}}>
          <div style={{fontSize:10,fontWeight:700,color:"#2E7D32",marginBottom:3}}>🔧 수정·추가 가이드</div>
          {guides.map((g,i)=>(
            <div key={i} style={{color:"#1B5E20",lineHeight:1.6}}>
              <b>{i+1})</b>{" "}
              {g.type === "replace" ? (
                <>
                  {/* ★ v23.6: 가이드 박스는 빨간 글씨만 (가독성 우선) — 취소선 제거 */}
                  <span style={{color:"#C62828",fontWeight:600}}>{g.from}</span>
                  <span style={{margin:"0 4px"}}>→</span>
                  <b style={{color:"#2E7D32"}}>{g.to}</b>
                </>
              ) : (
                <>
                  <b style={{color:"#2E7D32"}}>{g.text}</b>
                  <span style={{marginLeft:4,fontSize:10,color:"#666"}}>(추가)</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StatsTab({sheetsUrl, T, S, teacherList, proxyDownload, proxyPreview}){
  const LOW_THRESHOLD = 70; // ★ 미달 기준 고정 (70점 미만)
  const todayStr = (()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;})();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateMode, setDateMode] = useState("single"); // "single" | "range"
  // ★ v23.1: 기간 모드 — 시험 종류까지 묶을지(false=같은 examType만), 무시할지(true=반 단위 통합)
  const [rangeIgnoreExamType, setRangeIgnoreExamType] = useState(true);
  const [date, setDate] = useState(todayStr);
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [subject, setSubject] = useState("");
  const [teacher, setTeacher] = useState("");
  const [grade, setGrade] = useState("");
  // 학생별 틀린문제 토글 — key = `${cardKey}:${studentName}`
  const [openWrongs, setOpenWrongs] = useState({});
  const toggleWrong = (k) => setOpenWrongs(p => ({...p, [k]: !p[k]}));

  const load = useCallback(async()=>{
    setLoading(true);
    try{
      const params = new URLSearchParams({action:"class_grades"});
      if(dateMode==="single"){
        if(date) params.set("date", date);
      } else {
        if(dateFrom) params.set("dateFrom", dateFrom);
        if(dateTo) params.set("dateTo", dateTo);
      }
      if(subject) params.set("subject", subject);
      if(teacher) params.set("teacher", teacher);
      if(grade) params.set("grade", grade);
      const r = await fetch(`${sheetsUrl}?${params.toString()}`);
      const j = await r.json();
      setClasses(j.classes || []);
    }catch(e){ setClasses([]); }
    setLoading(false);
  }, [dateMode, date, dateFrom, dateTo, subject, teacher, grade, sheetsUrl]);
  useEffect(()=>{ load(); }, [load]);

  // 선생님 드랍다운: 과목별 그룹핑
  const teachersBySubject = useMemo(()=>{
    const m = {};
    (teacherList||[]).forEach(t=>{
      const subj = t.category || t.subject || "기타";
      if(!m[subj]) m[subj] = [];
      m[subj].push(t.name);
    });
    Object.keys(m).forEach(k=>m[k].sort());
    return m;
  }, [teacherList]);
  const SUBJ_ORDER_ARR = ["국어","영어","수학","과학","사회","관리자","기타"];
  const sortedSubjects = Object.keys(teachersBySubject).sort((a,b)=>{
    const ia = SUBJ_ORDER_ARR.indexOf(a), ib = SUBJ_ORDER_ARR.indexOf(b);
    return (ia===-1?99:ia) - (ib===-1?99:ib);
  });

  // 클래스 정렬: 과목 > 학년 > 선생님 > 레벨 > 시험명 > 날짜
  const subjOrderRank = (s)=>{ const i=SUBJ_ORDER_ARR.indexOf(s||""); return i===-1?99:i; };
  const sortedClasses = useMemo(()=>{
    return [...classes].sort((a,b)=>{
      const aS=subjOrderRank(a.subject), bS=subjOrderRank(b.subject);
      if(aS!==bS) return aS-bS;
      if((a.subject||"")!==(b.subject||"")) return (a.subject||"")<(b.subject||"")?-1:1;
      if((a.grade||"")!==(b.grade||"")) return (a.grade||"")<(b.grade||"")?-1:1;
      if((a.teacher||"")!==(b.teacher||"")) return (a.teacher||"")<(b.teacher||"")?-1:1;
      if((a.level||"")!==(b.level||"")) return (a.level||"")<(b.level||"")?-1:1;
      if((a.examType||"")!==(b.examType||"")) return (a.examType||"")<(b.examType||"")?-1:1;
      return (a.date||"")<(b.date||"")?-1:1;
    });
  }, [classes]);

  // ★ v23.0: 진짜 CSV 다운로드 — 콤마 구분, UTF-8 BOM, Excel 정상 인식
  const downloadCsv = (c)=>{
    const csvCell = (s)=>{
      const v = s===null||s===undefined ? "" : String(s);
      if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g,'""') + '"';
      return v;
    };
    const row = (...cells)=>cells.map(csvCell).join(",");
    const sep = ()=>out.push(""); // 빈 줄 헬퍼 (그냥 줄바꿈)
    const out = [];

    // ─── 헤더 ───
    out.push(row("[채움학원 반별 성적표]"));
    out.push(row("시험 정보", `${c.subject||""} ${c.grade||""} ${c.level||""}반`, c.examType||"", `${c.date||""}`, `담당: ${c.teacher||"-"}`, `응시: ${c.total||0}명`));
    sep();

    // ─── 요약 ───
    out.push(row("[시험 결과 요약]"));
    out.push(row("평균","최고","최저","만점자","70점 미만"));
    out.push(row(`${c.avg||0}`, `${c.max||0}`, `${c.min||0}`, `${c.perfectCount||0}`, `${c.lowCount||0}`));
    sep();

    // ─── 학생별 성적 (깔끔하게: 등수, 학생, 점수, 객관식오답수, 주관식 결과, 비고) ───
    out.push(row("[학생별 성적]"));
    out.push(row("등수","학생","점수","객관식 오답수","주관식 정답","주관식 부분","주관식 오답","비고"));
    (c.students||[]).forEach(s=>{
      const objWrongs = (s.perQuestion||[]).filter(p=>p.type==="obj"&&p.verdict==="오답");
      const subAll = (s.perQuestion||[]).filter(p=>p.type==="sub");
      const subOk = subAll.filter(p=>p.verdict==="정답").length;
      const subPart = subAll.filter(p=>p.verdict==="부분정답").length;
      const subWrong = subAll.filter(p=>p.verdict==="오답").length;
      const wrongCnt = (s.perQuestion||[]).filter(p=>p.verdict==="오답"||p.verdict==="부분정답").length;
      const note = s.score===100 ? "만점" : s.score<70 ? "보충 필요" : wrongCnt===0 ? "양호" : "복습 권장";
      out.push(row(String(s.rank||""), s.name||"?", String(s.score||0), String(objWrongs.length), String(subOk), String(subPart), String(subWrong), note));
    });
    sep();

    // ─── 객관식 오답 상세 (학생별, 한 줄 한 학생) ───
    const objStudents = (c.students||[]).filter(s=>(s.perQuestion||[]).filter(p=>p.type==="obj"&&p.verdict==="오답").length>0);
    if (objStudents.length>0) {
      out.push(row("[객관식 오답 상세]"));
      out.push(row("학생","오답 번호","학생답","정답"));
      objStudents.forEach(s=>{
        const w = (s.perQuestion||[]).filter(p=>p.type==="obj"&&p.verdict==="오답");
        w.forEach(p=>{
          out.push(row(s.name||"?", `${p.q})`, p.studentAns||"빈칸", p.correctAns||"-"));
        });
      });
      sep();
    }

    // ─── 주관식 상세 (정답 먼저, 학생답 다음, 점수+사유+수정가이드) ───
    // ★ v23.6: 수정·추가 가이드를 텍스트로 정리해서 별도 컬럼에 포함
    const subStudents = (c.students||[]).filter(s=>(s.perQuestion||[]).filter(p=>p.type==="sub"&&p.verdict!=="정답").length>0);
    if (subStudents.length>0) {
      out.push(row("[주관식 검토 (오답·부분점수)]"));
      out.push(row("학생","문항","점수","정답","학생답","수정·추가 가이드","AI 채점 사유"));
      subStudents.forEach(s=>{
        const w = (s.perQuestion||[]).filter(p=>p.type==="sub"&&p.verdict!=="정답");
        w.forEach(p=>{
          // 수정·추가 가이드 텍스트 생성 (1) X→Y · 2) Z (추가) 형식)
          let guideTxt = "";
          if (p.correctAns && p.studentAns) {
            try {
              const ops = diffWordsKor(p.correctAns, p.studentAns);
              const groups = groupDiffOps(ops);
              const guides = groups.filter(g=>g.type==="replace"||g.type==="add");
              guideTxt = guides.map((g,gi)=>{
                if (g.type==="replace") return `${gi+1}) ${g.from}→${g.to}`;
                return `${gi+1}) ${g.text} (추가)`;
              }).join(" · ");
            } catch(_e) {}
          }
          out.push(row(s.name||"?", `${p.q})`, String(p.score||0), p.correctAns||"-", p.studentAns||"(빈칸)", guideTxt, p.reasoning||""));
        });
      });
      sep();
    }

    // ─── 어려운 문항 ───
    if (c.hardest && c.hardest.length>0) {
      out.push(row(`[어려운 문항 Top ${c.hardest.length}]`));
      out.push(row("순위","문항","틀린 학생","비율(%)"));
      c.hardest.forEach((h,hi)=>{
        out.push(row(String(hi+1), `${h.q})`, String(h.wrong), String(h.pct)));
      });
      sep();
    }

    out.push(row(`* 생성일: ${new Date().toLocaleString("ko-KR")} | 채움학원 자동 채점 시스템`));
    const bom = "﻿";
    const blob = new Blob([bom + out.join("\r\n")], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fname = `${c.date||""}_${c.subject||""}_${c.grade||""}${c.level||""}반_${c.examType||""}_성적.csv`.replace(/[\\/:*?"<>|]/g,"");
    document.body.appendChild(a); a.href = url; a.download = fname; a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const _unused_old_csv = (c, esc)=>{
    const lines = [];
    return lines; // ── 이전 HTML→Excel 코드는 dead code 로 남아있으나 호출되지 않음 ──
    // eslint-disable-next-line no-unreachable
    lines.push('<html><body><table>');
    lines.push(`<tr><td colspan="6" class="title">채움학원 — 반별 성적표</td></tr>`);
    lines.push(`<tr><td colspan="6" class="meta"><b>${esc(c.subject)} ${esc(c.grade)} ${esc(c.level||"")}반 · ${esc(c.examType)}</b> | 📅 ${esc(c.date)} | 👨‍🏫 ${esc(c.teacher||"-")} | 응시 ${c.total}명</td></tr>`);
    lines.push(`<tr><td colspan="6" class="section">📊 시험 결과 요약</td></tr>`);
    lines.push(`<tr><th>평균</th><th>최고</th><th>최저</th><th>만점자</th><th>70점 미만</th><th>응시</th></tr>`);
    lines.push(`<tr><td>${c.avg}점</td><td>${c.max}점</td><td>${c.min}점</td><td>${c.perfectCount||0}명</td><td>${c.lowCount||0}명</td><td>${c.total}명</td></tr>`);
    lines.push(`<tr><td colspan="6" class="section">📋 학생별 성적</td></tr>`);
    lines.push(`<tr><th style="width:50pt">등수</th><th style="width:80pt">학생</th><th style="width:60pt">점수</th><th style="width:300pt">객관식 오답 (학생답→정답)</th><th style="width:140pt">주관식 결과</th><th style="width:80pt">비고</th></tr>`);
    (c.students||[]).forEach(s=>{
      const cls = s.score>=90?"score-high":s.score>=70?"score-mid":"score-low";
      const objWrongs = (s.perQuestion||[]).filter(p=>p.type==="obj"&&p.verdict==="오답");
      const subAll = (s.perQuestion||[]).filter(p=>p.type==="sub");
      const objLine = objWrongs.length>0
        ? objWrongs.map(p=>`${p.q}번: ${esc(p.studentAns||"빈칸")}→${esc(p.correctAns||"-")}`).join(", ")
        : "-";
      const subSummary = subAll.length>0
        ? `정답 ${subAll.filter(p=>p.verdict==="정답").length} / 부분 ${subAll.filter(p=>p.verdict==="부분정답").length} / 오답 ${subAll.filter(p=>p.verdict==="오답").length}`
        : "-";
      const wrongCnt = (s.perQuestion||[]).filter(p=>p.verdict==="오답"||p.verdict==="부분정답").length;
      const note = wrongCnt>0 ? `오답·부분 ${wrongCnt}` : "전부 정답";
      lines.push(`<tr><td style="text-align:center">${s.rank}</td><td><b>${esc(s.name||"?")}</b></td><td class="${cls}" style="text-align:center">${s.score}점</td><td class="wrong" style="font-size:10pt">${esc(objLine)}</td><td style="font-size:10pt">${esc(subSummary)}</td><td style="font-size:10pt">${esc(note)}</td></tr>`);
    });
    const subStudents = (c.students||[]).filter(s=>(s.perQuestion||[]).filter(p=>p.type==="sub"&&p.verdict!=="정답").length>0);
    if (subStudents.length>0) {
      lines.push(`<tr><td colspan="6" class="section">📝 주관식 답안 상세 (오답·부분점수)</td></tr>`);
      lines.push(`<tr><th style="width:80pt">학생</th><th style="width:50pt">문항</th><th style="width:50pt">점수</th><th style="width:200pt">학생답</th><th style="width:200pt">정답</th><th>AI 채점 사유</th></tr>`);
      subStudents.forEach(s=>{
        const subWrongs = (s.perQuestion||[]).filter(p=>p.type==="sub"&&p.verdict!=="정답");
        subWrongs.forEach(p=>{
          const wcls = p.verdict==="오답" ? "wrong" : "";
          lines.push(`<tr class="sub"><td><b>${esc(s.name||"?")}</b></td><td style="text-align:center">${p.q}번</td><td style="text-align:center" class="${wcls}">${p.score}점</td><td style="font-size:10pt">${esc(p.studentAns||"(빈칸)")}</td><td class="correct" style="font-size:10pt">${esc(p.correctAns||"-")}</td><td style="font-size:9.5pt;color:#5C5C5C">${esc(p.reasoning||"")}</td></tr>`);
        });
      });
    }
    if (c.hardest && c.hardest.length>0) {
      lines.push(`<tr><td colspan="6" class="section">🔥 어려운 문항 Top ${c.hardest.length}</td></tr>`);
      lines.push(`<tr><th>순위</th><th>문항</th><th>틀린 학생</th><th>비율</th><th colspan="2">비고</th></tr>`);
      c.hardest.forEach((h,hi)=>{
        lines.push(`<tr><td style="text-align:center">${hi+1}</td><td style="text-align:center"><b>${h.q}번</b></td><td style="text-align:center">${h.wrong}명</td><td style="text-align:center">${h.pct}%</td><td colspan="2"></td></tr>`);
      });
    }
    lines.push(`<tr><td colspan="6" style="font-size:9pt;color:#999;padding:8pt;text-align:center">채움학원 자동 채점 시스템 · ${new Date().toLocaleString("ko-KR")}</td></tr>`);
    lines.push('</table></body></html>');
    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\n")], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fname = `${c.date||""}_${c.subject||""}_${c.grade||""}${c.level||""}반_${c.examType||""}_성적.csv`.replace(/[\\/:*?"<>|]/g,"");
    a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url);
  };
  // ★ v23.0: 성적표 보기·인쇄 — 새 탭에서 깔끔한 인쇄용 페이지 (Ctrl+P → PDF/인쇄, Word 복사 가능)
  // 기존 HTML→Word(.doc) 방식은 Word 365 보안 정책으로 "손상된 파일" 오류 → 새 탭 인쇄 방식으로 교체
  const downloadWord = (c)=>{
    const esc = (s)=>String(s||"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const lines = [];
    lines.push('<!DOCTYPE html><html lang="ko"><head>');
    lines.push('<meta charset="utf-8">');
    lines.push(`<title>${esc(c.subject)} ${esc(c.grade)} ${esc(c.level||"")}반 · ${esc(c.examType)} 성적표</title>`);
    lines.push('<style>');
    lines.push('@page { size: A4; margin: 18mm 16mm; }');
    lines.push('* { box-sizing:border-box; }');
    lines.push('body { font-family:"Malgun Gothic","Noto Sans KR",sans-serif; color:#1a1a1a; line-height:1.55; margin:0; padding:24px; max-width:920px; margin:0 auto; background:#f5f5f5; }');
    lines.push('.sheet { background:#fff; padding:32px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.08); }');
    lines.push('.toolbar { background:#fff8e6; border:1px solid #f0d595; border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }');
    lines.push('.toolbar button { padding:8px 14px; font-size:13px; font-weight:700; border-radius:6px; border:none; cursor:pointer; font-family:inherit; }');
    lines.push('.btn-print { background:#B8860B; color:#fff; }');
    lines.push('.btn-copy { background:#fff; color:#8B6914; border:1px solid #D4A017 !important; }');
    lines.push('.toolbar .hint { font-size:12px; color:#5C5C5C; margin-left:auto; }');
    lines.push('h1 { color:#B8860B; font-size:22pt; margin:0 0 6pt 0; border-bottom:2pt solid #D4A017; padding-bottom:6pt; }');
    lines.push('h2 { color:#8B6914; font-size:14pt; margin:20pt 0 8pt 0; padding-bottom:3pt; border-bottom:1pt solid #E8E4DA; }');
    lines.push('table { width:100%; border-collapse:collapse; margin:6pt 0; font-size:11pt; }');
    lines.push('th { background:#FFF3D0; color:#8B6914; padding:6pt 8pt; border:1pt solid #E8D8A0; font-weight:700; }');
    lines.push('td { padding:5pt 8pt; border:1pt solid #E8E4DA; vertical-align:top; }');
    lines.push('.meta { color:#5C5C5C; font-size:11pt; margin-bottom:14pt; }');
    lines.push('.summary-row td { background:#FFFBF0; text-align:center; }');
    lines.push('.score-high { color:#2E7D32; font-weight:700; }');
    lines.push('.score-mid { color:#B8860B; font-weight:700; }');
    lines.push('.score-low { color:#C62828; font-weight:700; }');
    lines.push('.student-block { margin-top:14pt; padding:10pt; border:1pt solid #E8E4DA; border-radius:4pt; page-break-inside:avoid; }');
    lines.push('.student-head { font-size:12pt; font-weight:700; margin-bottom:6pt; }');
    lines.push('.q-list { margin:4pt 0; font-size:10.5pt; line-height:1.7; }');
    lines.push('.q-obj-item { display:inline-block; padding:2pt 8pt; margin:2pt 4pt 2pt 0; background:#FFEBEE; color:#C62828; border-radius:3pt; font-size:10pt; }');
    lines.push('.q-sub-item { margin:6pt 0; padding:6pt 10pt; background:#FFF8E6; border-left:3pt solid #D4A017; }');
    lines.push('.q-sub-wrong { background:#FFEBEE; border-left-color:#C62828; }');
    lines.push('.q-label { color:#8B6914; font-weight:700; }');
    lines.push('.reasoning { color:#5C5C5C; font-size:10pt; margin-top:3pt; font-style:italic; }');
    lines.push('.foot { margin-top:24pt; padding-top:8pt; border-top:1pt solid #E8E4DA; color:#999; font-size:9pt; text-align:center; }');
    lines.push('@media print { body { background:#fff; padding:0; } .toolbar { display:none !important; } .sheet { box-shadow:none; padding:0; border-radius:0; } }');
    lines.push('</style></head><body>');
    lines.push('<div class="toolbar">');
    lines.push('<button class="btn-print" onclick="window.print()">🖨️ 인쇄 / PDF 저장 (Ctrl+P)</button>');
    lines.push('<button class="btn-copy" onclick="(function(){var r=document.createRange();r.selectNode(document.getElementById(\'sheet\'));window.getSelection().removeAllRanges();window.getSelection().addRange(r);document.execCommand(\'copy\');alert(\'복사되었어요. Word·한글에 붙여넣기(Ctrl+V) 하세요.\');})()">📋 전체 복사 (Word 붙여넣기용)</button>');
    lines.push('<span class="hint">Ctrl+P → 대상에서 "PDF로 저장" 선택 가능</span>');
    lines.push('</div>');
    lines.push('<div id="sheet" class="sheet">');
    lines.push(`<h1>채움학원 — 반별 성적표</h1>`);
    lines.push(`<div class="meta"><b>${esc(c.subject)} ${esc(c.grade)} ${esc(c.level||"")}반 · ${esc(c.examType)}</b><br/>`);
    lines.push(`📅 ${esc(c.date)} &nbsp;&nbsp; 👨‍🏫 ${esc(c.teacher||"-")} &nbsp;&nbsp; 응시: ${c.total}명</div>`);
    lines.push('<h2>📊 시험 결과 요약</h2>');
    lines.push('<table><thead><tr><th>평균</th><th>최고</th><th>최저</th><th>만점자</th><th>70점 미만</th></tr></thead>');
    lines.push(`<tbody class="summary-row"><tr><td>${c.avg}점</td><td>${c.max}점</td><td>${c.min}점</td><td>${c.perfectCount||0}명</td><td>${c.lowCount||0}명</td></tr></tbody></table>`);
    lines.push('<h2>📋 학생별 성적</h2>');
    lines.push('<table><thead><tr><th style="width:50pt">등수</th><th>학생</th><th style="width:60pt">점수</th><th>비고</th></tr></thead><tbody>');
    (c.students||[]).forEach(s=>{
      const cls = s.score>=90?"score-high":s.score>=70?"score-mid":"score-low";
      const wrongOnly = (s.perQuestion||[]).filter(p=>p.verdict==="오답");
      const wrongCount = wrongOnly.length || (s.wrongQs||[]).length;
      const partial = (s.perQuestion||[]).filter(p=>p.verdict==="부분정답").length;
      const note = wrongCount>0 ? `틀린 ${wrongCount}문항${partial>0?` · 부분 ${partial}`:""}` : (partial>0 ? `부분점수 ${partial}개` : "전부 정답");
      lines.push(`<tr><td style="text-align:center">${s.rank}</td><td>${esc(s.name||"?")}</td><td class="${cls}" style="text-align:center">${s.score}점</td><td style="font-size:10pt">${esc(note)}</td></tr>`);
    });
    lines.push('</tbody></table>');
    const wrongStudents = (c.students||[]).filter(s=>(s.perQuestion||[]).filter(p=>p.verdict==="오답"||p.verdict==="부분정답").length>0);
    if (wrongStudents.length>0) {
      lines.push('<h2>📝 틀린 문항 상세</h2>');
      wrongStudents.forEach(s=>{
        const wrongP = (s.perQuestion||[]).filter(p=>p.verdict==="오답"||p.verdict==="부분정답");
        const objWrongs = wrongP.filter(p=>p.type==="obj");
        const subWrongs = wrongP.filter(p=>p.type==="sub");
        lines.push(`<div class="student-block">`);
        lines.push(`<div class="student-head">#${s.rank} ${esc(s.name||"?")} — ${s.score}점</div>`);
        if (objWrongs.length>0) {
          lines.push(`<div class="q-list"><span class="q-label">❌ 객관식 오답 ${objWrongs.length}개:</span><br/>`);
          objWrongs.forEach(p=>{
            lines.push(`<span class="q-obj-item">${p.q}번: ${esc(p.studentAns||"빈칸")} → <b>${esc(p.correctAns||"-")}</b></span>`);
          });
          lines.push(`</div>`);
        }
        subWrongs.forEach(p=>{
          const isWrong = p.verdict==="오답";
          lines.push(`<div class="q-sub-item${isWrong?" q-sub-wrong":""}">`);
          lines.push(`<div><span class="q-label">${p.q}번 (주관식, ${p.score}점)</span></div>`);
          lines.push(`<div style="margin-top:3pt"><b>학생답:</b> ${esc(p.studentAns||"(빈칸)")}</div>`);
          lines.push(`<div><b>정답:</b> ${esc(p.correctAns||"-")}</div>`);
          if (p.reasoning) lines.push(`<div class="reasoning">💬 ${esc(p.reasoning)}</div>`);
          lines.push(`</div>`);
        });
        lines.push(`</div>`);
      });
    }
    if (c.hardest && c.hardest.length>0) {
      lines.push('<h2>🔥 어려운 문항 Top '+c.hardest.length+'</h2>');
      lines.push('<table><thead><tr><th style="width:60pt">순위</th><th style="width:80pt">문항</th><th>틀린 학생</th><th style="width:80pt">비율</th></tr></thead><tbody>');
      c.hardest.forEach((h,hi)=>{
        lines.push(`<tr><td style="text-align:center">${hi+1}</td><td style="text-align:center"><b>${h.q}번</b></td><td style="text-align:center">${h.wrong}명</td><td style="text-align:center">${h.pct}%</td></tr>`);
      });
      lines.push('</tbody></table>');
    }
    lines.push('<div class="foot">채움학원 자동 채점 시스템 · ' + new Date().toLocaleString("ko-KR") + '</div>');
    lines.push('</div></body></html>');
    const html = lines.join('\n');
    // 새 탭에서 열기 (사용자가 인쇄/PDF 저장 또는 Word 복사·붙여넣기 가능)
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } else {
      alert("팝업이 차단되었어요. 주소창의 팝업 차단을 해제해 주세요.");
    }
  };
  // ★ v22.8: 시험지/답지 파일 모달
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileModalLoading, setFileModalLoading] = useState(false);
  const [fileModalData, setFileModalData] = useState({title:"", files:[], err:""});
  // ★ v23.6: folderId 없어도 작동 — 정답목록에서 다단계 매칭 검색
  //   - 1차: c.folderId (class_grades 가 이미 folderId 있는 행 우선 반환)
  //   - 2차: view_answer_key 전체 메타 (subject+grade+level+examType+teacher+date)
  //   - 3차: 레벨만 빼고 재시도 (다른 레벨로 등록되었을 수도 있음)
  //   - 4차: 선생님까지 빼고 재시도 (다른 선생님 행에 폴더 있을 수도 있음)
  const openFileModal = async (c)=>{
    setFileModalOpen(true);
    setFileModalLoading(true);
    setFileModalData({title:`${c.subject} ${c.grade} ${c.level||""}반 · ${c.examType}`, files:[], err:""});
    try{
      let folderId = c.folderId;
      const tryLookup = async (params)=>{
        const sp = new URLSearchParams({action:"view_answer_key", ...params});
        const lk = await fetch(`${sheetsUrl}?${sp.toString()}`);
        const ld = await lk.json();
        if (ld.result === "ok" && ld.meta && ld.meta.folderId) return ld.meta.folderId;
        return "";
      };
      if (!folderId) {
        // 2차 — 전체 메타
        folderId = await tryLookup({subject:c.subject||"", grade:c.grade||"", level:c.level||"", examType:c.examType||"", teacher:c.teacher||"", date:c.date||""});
      }
      if (!folderId) {
        // 3차 — 레벨 제거
        folderId = await tryLookup({subject:c.subject||"", grade:c.grade||"", examType:c.examType||"", teacher:c.teacher||"", date:c.date||""});
      }
      if (!folderId) {
        // 4차 — 선생님 제거 (다른 선생님 폴더에라도 파일 있으면 OK)
        folderId = await tryLookup({subject:c.subject||"", grade:c.grade||"", examType:c.examType||"", date:c.date||""});
      }
      if (!folderId) {
        setFileModalData(prev=>({...prev, err:"이 시험은 시험지/답지 파일이 등록되지 않은 것 같아요.\n\n원본 PDF가 필요하면 '시험 등록' 탭에서 다시 업로드 해주세요."}));
        setFileModalLoading(false);
        return;
      }
      const r = await fetch(`${sheetsUrl}?action=list_folder_files&folderId=${encodeURIComponent(folderId)}`);
      const d = await r.json();
      if(d.result==="ok"){
        setFileModalData(prev=>({...prev, files: d.files||[]}));
      } else {
        setFileModalData(prev=>({...prev, err: d.message || "조회 실패"}));
      }
    }catch(e){
      setFileModalData(prev=>({...prev, err: "네트워크 오류: "+String(e)}));
    }
    setFileModalLoading(false);
  };

  const scoreColor = (s)=> s>=90?T.accent : s>=80?T.goldDark : s>=LOW_THRESHOLD?T.text : T.danger;

  // ★ 카드 헤더 컴포넌트
  const CardHeader = ({c})=>(
    <div style={{borderBottom:`1px solid ${T.border}`,paddingBottom:8,marginBottom:10}}>
      <div style={{fontSize:15,fontWeight:700,color:T.text,lineHeight:1.4}}>
        📘 {[c.subject, c.grade, (c.level?c.level+"반":"반")].filter(Boolean).join(" ")} · {c.examType}
        {c.teacher && <span style={{fontSize:12,fontWeight:600,color:T.goldDark,marginLeft:6}}>(👤 {c.teacher})</span>}
      </div>
      <div style={{fontSize:11,color:T.textMuted,marginTop:3}}>
        📅 {c.date} · 응시 {c.total}명
      </div>
    </div>
  );

  // ★ v23.3: 학생 1명용 PDF — 인쇄용 새 탭 (반 PDF와 동일 양식, 단일 학생)
  const downloadStudentPdf = (c, s)=>{
    const esc = (str)=>String(str||"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const lines = [];
    lines.push('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">');
    lines.push(`<title>${esc(s.name||"학생")} 성적표 - ${esc(c.subject)} ${esc(c.grade)} ${esc(c.examType)}</title>`);
    lines.push('<style>');
    lines.push('@page { size: A4; margin: 18mm 16mm; }');
    lines.push('body { font-family:"Malgun Gothic","Noto Sans KR",sans-serif; color:#1a1a1a; line-height:1.55; margin:0; padding:24px; max-width:920px; margin:0 auto; background:#f5f5f5; }');
    lines.push('.sheet { background:#fff; padding:32px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.08); }');
    lines.push('.toolbar { background:#fff8e6; border:1px solid #f0d595; border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; gap:8px; align-items:center; }');
    lines.push('.toolbar button { padding:8px 14px; font-size:13px; font-weight:700; border-radius:6px; border:none; cursor:pointer; font-family:inherit; background:#B8860B; color:#fff; }');
    lines.push('h1 { color:#B8860B; font-size:22pt; margin:0 0 6pt 0; border-bottom:2pt solid #D4A017; padding-bottom:6pt; }');
    lines.push('h2 { color:#8B6914; font-size:14pt; margin:18pt 0 8pt 0; padding-bottom:3pt; border-bottom:1pt solid #E8E4DA; }');
    lines.push('.meta { color:#5C5C5C; font-size:11pt; margin-bottom:14pt; }');
    lines.push('.score-box { display:inline-block; padding:18pt 26pt; background:#FFF3D0; border:2pt solid #D4A017; border-radius:10pt; text-align:center; margin:6pt 0; }');
    lines.push('.score-num { font-size:32pt; font-weight:800; color:#B8860B; line-height:1; }');
    lines.push('.score-label { font-size:11pt; color:#5C5C5C; margin-top:4pt; }');
    lines.push('.obj-chips { display:flex; flex-wrap:wrap; gap:5pt; margin:4pt 0; }');
    lines.push('.obj-chip { padding:3pt 9pt; background:#FFEBEE; color:#C62828; border-radius:10pt; font-size:10.5pt; font-weight:600; }');
    lines.push('.sub-block { margin:6pt 0; padding:8pt 12pt; background:#FFF8E6; border-left:3pt solid #D4A017; border-radius:3pt; page-break-inside:avoid; }');
    lines.push('.sub-block.wrong { background:#FFEBEE; border-left-color:#C62828; }');
    lines.push('.sub-correct { color:#2E7D32; font-weight:700; }');
    lines.push('.diff-add { background:#e8f5e9; color:#2E7D32; font-weight:700; padding:0 2pt; border-radius:2pt; border-bottom:2pt dotted #2E7D32; }');
    lines.push('.diff-del { background:#ffebee; color:#C62828; text-decoration:line-through; padding:0 2pt; border-radius:2pt; }');
    /* ★ v23.6: 수정·추가 가이드 박스 (PDF/인쇄용) — 학생답 본문 아래에 따로 정리 */
    lines.push('.guide-box { margin-top:5pt; padding:6pt 10pt; background:#f0f9f0; border:1pt dashed #66bb6a; border-radius:3pt; font-size:10pt; }');
    lines.push('.guide-title { font-size:9pt; font-weight:700; color:#2E7D32; margin-bottom:3pt; }');
    lines.push('.guide-item { color:#1B5E20; line-height:1.6; padding:1pt 0; }');
    lines.push('.guide-from { color:#C62828; font-weight:600; }');  /* 가이드의 from은 빨간 글씨만 (취소선 X — 가독성) */
    lines.push('.guide-to { color:#2E7D32; font-weight:700; }');
    lines.push('.guide-arrow { margin:0 4pt; color:#666; }');
    lines.push('.guide-add-tag { margin-left:4pt; font-size:9pt; color:#666; }');
    lines.push('.reasoning { color:#5C5C5C; font-size:10pt; margin-top:4pt; font-style:italic; }');
    lines.push('.foot { margin-top:24pt; padding-top:8pt; border-top:1pt solid #E8E4DA; color:#999; font-size:9pt; text-align:center; }');
    lines.push('@media print { body { background:#fff; padding:0; } .toolbar { display:none !important; } .sheet { box-shadow:none; padding:0; border-radius:0; } }');
    lines.push('</style></head><body>');
    lines.push('<div class="toolbar"><button onclick="window.print()">🖨️ 인쇄 / PDF 저장</button></div>');
    lines.push('<div class="sheet">');
    lines.push(`<h1>채움학원 — 개인 성적표</h1>`);
    lines.push(`<div class="meta"><b>${esc(s.name||"?")}</b> (#${s.rank}) · ${esc(c.subject)} ${esc(c.grade)} ${esc(c.level||"")}반 · ${esc(c.examType)}<br/>📅 ${esc(c.date)} &nbsp; 👨‍🏫 ${esc(c.teacher||"-")}</div>`);
    lines.push('<div class="score-box"><div class="score-num">'+(s.score||0)+'점</div><div class="score-label">반 평균 '+(c.avg||0)+'점 / 등수 #'+(s.rank||"-")+' / 응시 '+(c.total||0)+'명</div></div>');
    // 객관식 오답
    const objW = (s.perQuestion||[]).filter(p=>p.type==="obj"&&p.verdict==="오답");
    if (objW.length>0) {
      lines.push('<h2>❌ 객관식 오답 ('+objW.length+'개)</h2><div class="obj-chips">');
      objW.forEach(p=>{
        lines.push(`<span class="obj-chip">${p.q}) ${esc(p.studentAns||"빈")} › <b>${esc(p.correctAns||"-")}</b></span>`);
      });
      lines.push('</div>');
    }
    // 주관식 — 정답 먼저, 학생답 diff + 수정 가이드 (v23.6: 가이드 박스 분리)
    const subW = (s.perQuestion||[]).filter(p=>p.type==="sub"&&p.verdict!=="정답");
    if (subW.length>0) {
      lines.push('<h2>📝 주관식 검토 ('+subW.length+'개)</h2>');
      subW.forEach(p=>{
        const isWrong = p.verdict==="오답";
        lines.push(`<div class="sub-block${isWrong?" wrong":""}">`);
        lines.push(`<div><b>${p.q}번 (주관식, ${p.score}점)</b></div>`);
        lines.push(`<div style="margin-top:5pt"><b>✓ 정답:</b> <span class="sub-correct">${esc(p.correctAns||"-")}</span></div>`);
        // ★ v23.6: 학생답 본문 — 빨간 취소선만 (가독성 우선, add는 가이드 박스에 분리)
        const ops = diffWordsKor(p.correctAns||"", p.studentAns||"");
        const groups = groupDiffOps(ops);
        let bodyHtml = "";
        groups.forEach(g=>{
          if (g.type==="keep") bodyHtml += esc(g.text) + " ";
          else if (g.type==="del") bodyHtml += `<span class="diff-del">${esc(g.text)}</span> `;
          else if (g.type==="replace") bodyHtml += `<span class="diff-del">${esc(g.from)}</span> `;
          // add 는 본문에서 제외 (가이드 박스로)
        });
        lines.push(`<div style="margin-top:3pt"><b>📝 학생답:</b> ${p.studentAns?bodyHtml:'<i style="color:#C62828">(빈칸)</i>'}</div>`);
        // ★ v23.6: 수정·추가 가이드 박스 (취소선 X · 빨간 글씨만)
        const guides = groups.filter(g=>g.type==="replace"||g.type==="add");
        if (guides.length > 0) {
          lines.push(`<div class="guide-box">`);
          lines.push(`<div class="guide-title">🔧 수정·추가 가이드</div>`);
          guides.forEach((g,gi)=>{
            if (g.type==="replace") {
              lines.push(`<div class="guide-item"><b>${gi+1})</b> <span class="guide-from">${esc(g.from)}</span><span class="guide-arrow">→</span><span class="guide-to">${esc(g.to)}</span></div>`);
            } else {
              lines.push(`<div class="guide-item"><b>${gi+1})</b> <span class="guide-to">${esc(g.text)}</span><span class="guide-add-tag">(추가)</span></div>`);
            }
          });
          lines.push(`</div>`);
        }
        if (p.reasoning) lines.push(`<div class="reasoning">💬 ${esc(p.reasoning)}</div>`);
        lines.push(`</div>`);
      });
      lines.push('<div style="font-size:10pt;color:#666;margin-top:6pt;background:#f9f9f9;padding:6pt;border-radius:4pt"><b style="color:#2E7D32">초록</b> = 추가 필요 · <span class="diff-del">빨강 취소선</span> = 빼야 함 (학생답 본문 표시) · <span class="guide-from">빨강 글씨</span> = 가이드의 원본 표현</div>');
    }
    if (objW.length===0 && subW.length===0) {
      lines.push('<h2>🎉 전부 정답!</h2><p>훌륭한 시험이었어요. 계속 이대로 잘해줘!</p>');
    }
    lines.push('<div class="foot">채움학원 · ' + new Date().toLocaleString("ko-KR") + '</div>');
    lines.push('</div></body></html>');
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(lines.join('\n')); w.document.close(); }
    else alert("팝업이 차단되었어요. 주소창의 팝업 차단을 해제해 주세요.");
  };

  // ★ 단일 모드 카드 렌더링
  const renderSingleCard = (c, key)=>{
    const lowStudents = (c.students||[]).filter(s=>s.score<LOW_THRESHOLD);
    return (
      <div key={key} style={{...S.card, marginBottom:12}}>
        <CardHeader c={c}/>
        {/* 요약 통계 */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
          <div style={{textAlign:"center",padding:"8px 4px",background:T.bg,borderRadius:6}}>
            <div style={{fontSize:10,color:T.textMuted}}>평균</div>
            <div style={{fontSize:18,fontWeight:700,color:scoreColor(c.avg)}}>{c.avg}점</div>
          </div>
          <div style={{textAlign:"center",padding:"8px 4px",background:T.bg,borderRadius:6}}>
            <div style={{fontSize:10,color:T.textMuted}}>최고</div>
            <div style={{fontSize:18,fontWeight:700,color:T.accent}}>{c.max}점</div>
          </div>
          <div style={{textAlign:"center",padding:"8px 4px",background:T.bg,borderRadius:6}}>
            <div style={{fontSize:10,color:T.textMuted}}>최저</div>
            <div style={{fontSize:18,fontWeight:700,color:T.danger}}>{c.min}점</div>
          </div>
        </div>
        {/* 만점/미달 뱃지 */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
          {c.perfectCount>0&&<span style={{fontSize:11,padding:"4px 8px",background:T.goldPale,color:T.goldDeep,borderRadius:6,fontWeight:600}}>🏆 만점자 {c.perfectCount}명</span>}
          {lowStudents.length>0&&<span style={{fontSize:11,padding:"4px 8px",background:T.dangerLight,color:T.danger,borderRadius:6,fontWeight:600}}>⚠️ {LOW_THRESHOLD}점 미만 {lowStudents.length}명</span>}
        </div>
        {/* 학생별 성적 (점수 높은 순) — 틀린문제는 토글로 */}
        <div style={{marginBottom:10}}>
          <div style={{fontSize:12,color:T.textMuted,marginBottom:6,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>학생별 성적 (점수 높은 순)</span>
            <button onClick={()=>{
              // 전체 토글: 모두 닫힘이면 모두 열기, 아니면 모두 닫기
              const cardKey = key;
              const allKeys = (c.students||[]).map((s,si)=>`${cardKey}:${s.name||"?"}:${si}`);
              const anyOpen = allKeys.some(k=>openWrongs[k]);
              setOpenWrongs(p=>{
                const np={...p};
                allKeys.forEach(k=>np[k]=!anyOpen);
                return np;
              });
            }} style={{fontSize:10,padding:"2px 8px",border:`1px solid ${T.border}`,borderRadius:10,background:T.white,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>
              전체 펼치기/접기
            </button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            {(c.students||[]).map((s,si)=>{
              const k = `${key}:${s.name||"?"}:${si}`;
              const open = !!openWrongs[k];
              // ★ v22.9: 재검증된 perQuestion 우선 사용 (옛 wrongQs 무시 — false-positive 방지)
              const showPQ = Array.isArray(s.perQuestion) && s.perQuestion.length>0;
              const partialCount = showPQ ? s.perQuestion.filter(p=>p.verdict==="부분정답").length : 0;
              const wrongPQ = showPQ ? s.perQuestion.filter(p=>p.verdict==="오답"||p.verdict==="부분정답") : [];
              const wrongOnly = showPQ ? s.perQuestion.filter(p=>p.verdict==="오답") : [];
              const wrongCountDisp = showPQ ? wrongOnly.length : ((s.wrongQs||[]).length);
              const has = wrongCountDisp>0;
              const expandable = has || (showPQ && wrongPQ.length>0);
              return (
                <div key={si} style={{background:s.score<LOW_THRESHOLD?T.dangerLight:s.score===100?T.goldPale:T.bg,borderRadius:6,fontSize:12,overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",cursor:expandable?"pointer":"default"}} onClick={()=>{ if(expandable) toggleWrong(k); }}>
                    <span style={{minWidth:32,fontSize:11,fontWeight:600,color:T.textMuted}}>#{s.rank}</span>
                    <span style={{minWidth:60,fontWeight:600,color:T.text}}>{s.name||"?"}</span>
                    <span style={{minWidth:50,fontWeight:700,color:scoreColor(s.score)}}>{s.score}점</span>
                    {/* ★ v23.3: 학생별 PDF 다운로드 (각 점수 옆) */}
                    <button onClick={(e)=>{e.stopPropagation();downloadStudentPdf(c,s);}} title={`${s.name||"학생"} 개인 성적표 PDF`} style={{padding:"3px 8px",fontSize:10,fontWeight:700,borderRadius:6,border:`1px solid ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>📄 PDF</button>
                    <span style={{flex:1,color:T.textSub,fontSize:11,textAlign:"right"}}>
                      {has ? (
                        <span style={{color:T.danger,fontWeight:600}}>{open?"▼":"▶"} 틀린 {wrongCountDisp}문항{partialCount>0?` · 부분 ${partialCount}`:""}</span>
                      ) : partialCount>0 ? (
                        <span style={{color:T.goldDark,fontWeight:600}}>{open?"▼":"▶"} 부분점수 {partialCount}개</span>
                      ) : (
                        <span style={{color:T.accent}}>✓ 전부 정답</span>
                      )}
                    </span>
                  </div>
                  {expandable && open && (
                    <div style={{padding:"8px 12px 10px 16px",fontSize:11,color:T.text,lineHeight:1.6,background:T.white,borderTop:`1px dashed ${T.border}`}}>
                      {showPQ && wrongPQ.length>0 ? (
                        <>
                          {/* ★ v22.9: 객관식 — 초압축 chip (q·student›correct) */}
                          {(()=>{
                            const objWrongs = wrongPQ.filter(p=>p.type==="obj");
                            if(objWrongs.length===0)return null;
                            return (
                              <div style={{padding:"5px 8px",background:"#fff5f5",borderRadius:4,marginBottom:5,border:`1px solid #ffd0d0`}}>
                                <div style={{fontSize:10,fontWeight:700,color:T.danger,marginBottom:3}}>❌ 객관식 ({objWrongs.length})</div>
                                <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                                  {objWrongs.map((p,pi)=>(
                                    <span key={pi} style={{display:"inline-block",padding:"1px 5px",background:T.white,border:`1px solid ${T.danger}33`,borderRadius:6,fontSize:10,fontWeight:600,color:T.text,whiteSpace:"nowrap",lineHeight:1.5}}>
                                      <span style={{color:T.danger,fontWeight:700}}>{p.q})</span>
                                      <span style={{color:T.danger,marginLeft:3}}>{p.studentAns||"빈"}</span>
                                      <span style={{color:T.textMuted,margin:"0 1px",fontSize:9}}>›</span>
                                      <span style={{color:T.accent,fontWeight:700}}>{p.correctAns||"-"}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                          {/* ★ v22.8: 주관식 — 풀어서 표시 (학생답/정답/AI사유) */}
                          {wrongPQ.filter(p=>p.type==="sub").map((p,pi)=>{
                            const isWrong = p.verdict==="오답";
                            const bg = isWrong?"#fff5f5":"#fffaf0";
                            return (
                              <div key={pi} style={{padding:"6px 10px",background:bg,borderRadius:4,marginBottom:4,border:`1px solid ${isWrong?"#ffd0d0":"#ffe7b8"}`}}>
                                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:3}}>
                                  <span style={{fontWeight:700,color:isWrong?T.danger:T.goldDark,fontSize:12}}>{p.q}번 (주관식)</span>
                                  <span style={{fontSize:10,fontWeight:700,color:isWrong?T.danger:T.goldDark}}>{p.score}점</span>
                                </div>
                                <div style={{fontSize:11,color:T.textSub,wordBreak:"break-word"}}>
                                  {/* ★ v23.3: 정답 먼저 + 학생답 diff 표시 */}
                                  <div style={{marginBottom:3}}><span style={{color:T.accent,fontWeight:700,marginRight:4}}>✓ 정답:</span><span style={{color:T.text,fontWeight:500}}>{p.correctAns||"-"}</span></div>
                                  <div style={{marginBottom:3}}>
                                    <span style={{color:isWrong?T.danger:T.goldDark,fontWeight:700,marginRight:4}}>📝 학생답:</span>
                                    {p.studentAns ? <DiffView correct={p.correctAns||""} student={p.studentAns||""} T={T}/> : <span style={{color:T.danger,fontStyle:"italic"}}>(빈칸)</span>}
                                  </div>
                                  <div style={{fontSize:9,color:T.textMuted,marginBottom:3}}>
                                    <span style={{background:"#e8f5e9",color:"#2E7D32",padding:"0 4px",borderRadius:2,marginRight:4}}>초록</span>= 추가 필요 ·
                                    <span style={{background:"#ffebee",color:"#C62828",padding:"0 4px",borderRadius:2,margin:"0 4px",textDecoration:"line-through"}}>빨강</span>= 빼야 함
                                  </div>
                                  {p.reasoning && <div style={{marginTop:3,fontSize:10,color:T.textMuted,fontStyle:"italic"}}>💬 {p.reasoning}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      ) : has ? (
                        <div style={{color:T.danger,wordBreak:"break-all"}}>❌ {(showPQ?wrongOnly.map(p=>p.q):(s.wrongQs||[])).join(", ")}</div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* 어려운 문항 Top5 */}
        {c.hardest && c.hardest.length>0 && <div style={{marginBottom:10,padding:"8px 10px",background:T.bg,borderRadius:6}}>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:4,fontWeight:600}}>🔥 어려운 문항 Top {c.hardest.length}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {c.hardest.map((h,hi)=>(
              <span key={hi} style={{fontSize:11,padding:"3px 8px",background:h.pct>=70?T.dangerLight:T.white,color:h.pct>=70?T.danger:T.textSub,border:`1px solid ${T.border}`,borderRadius:10}}>
                {h.q}번 ({h.wrong}명·{h.pct}%)
              </span>
            ))}
          </div>
        </div>}
        {/* 액션 — ★ v22.8: Word/CSV 다운로드 + 시험지/답지 파일 모달 */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button onClick={()=>downloadWord(c)} style={{...S.btn,flex:"1 1 30%",fontSize:12,minWidth:90,background:T.goldDark}} title="새 탭에서 인쇄용 페이지 열기 (PDF 저장 / Word 복사 가능)">📄 인쇄·PDF</button>
          <button onClick={()=>downloadCsv(c)} style={{...S.btn,flex:"1 1 30%",fontSize:12,minWidth:80,background:T.accent}} title="CSV 다운로드 (Excel에서 바로 열기)">📊 CSV(엑셀)</button>
          <button onClick={()=>openFileModal(c)} style={{...S.btn,flex:"1 1 30%",fontSize:12,minWidth:90,background:T.blue,color:T.white,cursor:"pointer"}} title="시험지/답지 파일 보기">📁 시험지·답지</button>
        </div>
      </div>
    );
  };

  // ★ 기간 모드: 학생별 누적 흐름 — v23.1: rangeIgnoreExamType=true 면 시험명 무시 (반 단위 통합)
  const rangeGroups = useMemo(()=>{
    if(dateMode!=="range") return [];
    const m = {};
    sortedClasses.forEach(c=>{
      // ★ v23.1: 묶음 키 — 시험명 포함 vs 무시
      const k = rangeIgnoreExamType
        ? `${c.subject}|${c.grade}|${c.level}|${c.teacher||""}`
        : `${c.subject}|${c.grade}|${c.level}|${c.examType}|${c.teacher||""}`;
      if(!m[k]){
        m[k] = {meta:{subject:c.subject,grade:c.grade,level:c.level,examType:rangeIgnoreExamType?"전체 시험":c.examType,teacher:c.teacher}, dateSet:new Set(), byStudent:{}, hardest:{}};
      }
      m[k].dateSet.add(c.date);
      (c.students||[]).forEach(s=>{
        if(!m[k].byStudent[s.name]) m[k].byStudent[s.name] = {scores:{}, wrongs:{}};
        m[k].byStudent[s.name].scores[c.date] = s.score;
        m[k].byStudent[s.name].wrongs[c.date] = s.wrongQs||[];
      });
      // 어려운 문항 누적 (반 전체)
      (c.hardest||[]).forEach(h=>{
        if(!m[k].hardest[h.q]) m[k].hardest[h.q] = {q:h.q, wrong:0, total:0};
        m[k].hardest[h.q].wrong += h.wrong;
        m[k].hardest[h.q].total += c.total;
      });
    });
    return Object.values(m).map(g=>{
      const dates = [...g.dateSet].sort();
      const studentRows = Object.entries(g.byStudent).map(([name, data])=>{
        const scoreList = dates.map(d=> data.scores[d]!==undefined ? data.scores[d] : null);
        const valid = scoreList.filter(v=>v!==null);
        const avg = valid.length ? Math.round(valid.reduce((a,b)=>a+b,0)/valid.length) : 0;
        const max = valid.length ? Math.max(...valid) : 0;
        const min = valid.length ? Math.min(...valid) : 0;
        return {name, scores:scoreList, dates, avg, max, min, attempts:valid.length, wrongs:data.wrongs};
      }).sort((a,b)=>b.avg-a.avg);
      const hardest = Object.values(g.hardest).map(h=>({q:h.q, wrong:h.wrong, pct:h.total?Math.round((h.wrong/h.total)*100):0}))
        .sort((a,b)=>b.wrong-a.wrong).slice(0,5);
      return {meta:g.meta, dates, studentRows, hardest, classCount:g.dateSet.size};
    });
  }, [dateMode, sortedClasses, rangeIgnoreExamType]);

  // ★ 기간 모드 카드 렌더
  const renderRangeCard = (g, key)=>{
    const m = g.meta;
    const csvDownload = ()=>{
      const head = ["학생", ...g.dates, "평균"];
      const lines = [head.join(",")];
      g.studentRows.forEach(s=>{
        const row = [`"${s.name}"`, ...s.scores.map(v=>v===null?"":v), s.avg];
        lines.push(row.join(","));
      });
      const bom = "\uFEFF";
      const blob = new Blob([bom + lines.join("\n")], {type:"text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const fname = `누적_${m.subject||""}_${m.grade||""}${m.level||""}반_${m.examType||""}.csv`.replace(/[\\/:*?"<>|]/g,"");
      a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url);
    };
    return (
      <div key={key} style={{...S.card, marginBottom:12}}>
        <div style={{borderBottom:`1px solid ${T.border}`,paddingBottom:8,marginBottom:10}}>
          <div style={{fontSize:15,fontWeight:700,color:T.text,lineHeight:1.4}}>
            📘 {[m.subject, m.grade, (m.level?m.level+"반":"반")].filter(Boolean).join(" ")} · {m.examType}
            {m.teacher && <span style={{fontSize:12,fontWeight:600,color:T.goldDark,marginLeft:6}}>(👤 {m.teacher})</span>}
          </div>
          <div style={{fontSize:11,color:T.textMuted,marginTop:3}}>
            🗓 {g.dates.length}회 응시 · 학생 {g.studentRows.length}명 · 기간 {g.dates[0]} ~ {g.dates[g.dates.length-1]}
          </div>
        </div>
        {/* 가로 스크롤 표 — 학생 × 날짜 */}
        <div style={{overflowX:"auto",marginBottom:10}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:Math.max(360, 80+g.dates.length*70+60)}}>
            <thead>
              <tr style={{background:T.bg}}>
                <th style={{padding:"6px 8px",textAlign:"left",borderBottom:`1px solid ${T.border}`,minWidth:80,position:"sticky",left:0,background:T.bg,zIndex:1}}>학생</th>
                {g.dates.map(d=>(
                  <th key={d} style={{padding:"6px 8px",textAlign:"center",borderBottom:`1px solid ${T.border}`,fontSize:10,color:T.textMuted,whiteSpace:"nowrap"}}>{String(d).slice(5)}</th>
                ))}
                <th style={{padding:"6px 8px",textAlign:"center",borderBottom:`1px solid ${T.border}`,background:T.goldPale,color:T.goldDeep,fontWeight:700,whiteSpace:"nowrap"}}>평균</th>
              </tr>
            </thead>
            <tbody>
              {g.studentRows.map((s,si)=>(
                <tr key={si} style={{borderBottom:`1px solid ${T.borderLight}`}}>
                  <td style={{padding:"6px 8px",fontWeight:600,color:T.text,position:"sticky",left:0,background:T.white,zIndex:1}}>{s.name}</td>
                  {s.scores.map((v,vi)=>(
                    <td key={vi} style={{padding:"6px 8px",textAlign:"center",color:v===null?T.textMuted:scoreColor(v),fontWeight:v===null?400:700}}>
                      {v===null?"·":v}
                    </td>
                  ))}
                  <td style={{padding:"6px 8px",textAlign:"center",color:scoreColor(s.avg),fontWeight:800,background:T.goldPale}}>
                    {s.avg}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 어려운 문항 Top5 (누적) */}
        {g.hardest && g.hardest.length>0 && <div style={{marginBottom:10,padding:"8px 10px",background:T.bg,borderRadius:6}}>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:4,fontWeight:600}}>🔥 어려운 문항 Top {g.hardest.length} (기간 누적)</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {g.hardest.map((h,hi)=>(
              <span key={hi} style={{fontSize:11,padding:"3px 8px",background:h.pct>=70?T.dangerLight:T.white,color:h.pct>=70?T.danger:T.textSub,border:`1px solid ${T.border}`,borderRadius:10}}>
                {h.q}번 ({h.wrong}회·{h.pct}%)
              </span>
            ))}
          </div>
        </div>}
        <div style={{display:"flex",gap:6}}>
          <button onClick={csvDownload} style={{...S.btn,flex:1,fontSize:12}}>📥 누적 엑셀 다운로드</button>
        </div>
      </div>
    );
  };

  // ★ 단일 모드: 과목/학년 그룹 헤더 자동 삽입
  const renderSingleGrouped = ()=>{
    const out = [];
    let lastSubject = null, lastGrade = null;
    sortedClasses.forEach((c, i)=>{
      const showHeader = (c.subject !== lastSubject) || (c.grade !== lastGrade);
      if(showHeader){
        out.push(
          <div key={`hdr-${i}`} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 4px 6px 4px",marginTop:i===0?0:8}}>
            <div style={{fontSize:13,fontWeight:800,color:T.goldDeep,padding:"4px 12px",background:T.goldPale,borderRadius:14,border:`1px solid ${T.goldMuted}`}}>
              {c.subject||"(과목 없음)"} · {c.grade||"(학년 없음)"}
            </div>
            <div style={{flex:1,height:1,background:T.borderLight}}/>
          </div>
        );
        lastSubject = c.subject;
        lastGrade = c.grade;
      }
      out.push(renderSingleCard(c, `cls-${i}-${c.subject}-${c.grade}-${c.level}-${c.examType}-${c.date}`));
    });
    return out;
  };

  return (<div style={S.wrap} className="fade-up">
    {/* ★ v22.8: 시험지/답지 파일 모달 */}
    {fileModalOpen && (
      <div onClick={()=>setFileModalOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={(e)=>e.stopPropagation()} style={{background:T.white,borderRadius:14,width:"100%",maxWidth:560,maxHeight:"85vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,background:T.goldPale,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:T.goldDeep}}>📁 시험지 / 답지 파일</div>
              <div style={{fontSize:11,color:T.textSub,marginTop:2}}>{fileModalData.title}</div>
            </div>
            <button onClick={()=>setFileModalOpen(false)} style={{...S.btnO,padding:"6px 12px"}}>✕ 닫기</button>
          </div>
          <div style={{flex:1,overflow:"auto",padding:14}}>
            {fileModalLoading && <div style={{padding:20,textAlign:"center",color:T.textMuted}}>로딩 중...</div>}
            {fileModalData.err && <div style={{padding:14,background:T.dangerLight,color:T.danger,borderRadius:8,fontSize:13,fontWeight:600,textAlign:"center"}}>{fileModalData.err}</div>}
            {!fileModalLoading && !fileModalData.err && fileModalData.files.length===0 && (
              <div style={{padding:24,textAlign:"center",color:T.textMuted,fontSize:13}}>파일이 없습니다.</div>
            )}
            {!fileModalLoading && fileModalData.files.length>0 && (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {/* 시험지 그룹 */}
                {fileModalData.files.filter(f=>f.kind==="exam").length>0 && (
                  <div>
                    <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:6,padding:"4px 8px",background:T.bg,borderRadius:4}}>📄 시험지 ({fileModalData.files.filter(f=>f.kind==="exam").length})</div>
                    {fileModalData.files.filter(f=>f.kind==="exam").map((f,fi)=>{
                      const sizeMB = f.size?(f.size/1024/1024):0;
                      const big = sizeMB > 5.5;
                      return (
                      <div key={fi} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 10px",background:T.white,border:`1px solid ${T.border}`,borderRadius:6,marginBottom:4}}>
                        <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                          <div style={{fontSize:12,fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{f.name}</div>
                          <div style={{fontSize:10,color:T.textMuted}}>{f.size?(sizeMB>=1?sizeMB.toFixed(1)+"MB":Math.round(f.size/1024)+"KB"):""}{big?" · 큼 ⓘ":""}</div>
                        </div>
                        <button onClick={()=>proxyPreview&&proxyPreview(f.id,f.name)} disabled={!proxyPreview} style={{padding:"5px 10px",fontSize:11,fontWeight:700,borderRadius:5,border:`1px solid ${T.blue}`,background:T.white,color:T.blue,cursor:"pointer",fontFamily:"inherit"}}>👁 보기</button>
                        <button onClick={()=>proxyDownload&&proxyDownload(f.id,f.name)} disabled={!proxyDownload} style={{padding:"5px 10px",fontSize:11,fontWeight:700,borderRadius:5,border:"none",background:T.goldDark,color:T.white,cursor:"pointer",fontFamily:"inherit"}}>⬇ 다운</button>
                      </div>
                      );
                    })}
                  </div>
                )}
                {/* 답지 그룹 */}
                {fileModalData.files.filter(f=>f.kind==="answer").length>0 && (
                  <div>
                    <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:6,padding:"4px 8px",background:T.goldLight,borderRadius:4}}>🔑 답지 ({fileModalData.files.filter(f=>f.kind==="answer").length})</div>
                    {fileModalData.files.filter(f=>f.kind==="answer").map((f,fi)=>{
                      const sizeMB = f.size?(f.size/1024/1024):0;
                      const big = sizeMB > 5.5;
                      return (
                      <div key={fi} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 10px",background:T.goldPale,border:`1px solid ${T.goldMuted}`,borderRadius:6,marginBottom:4}}>
                        <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                          <div style={{fontSize:12,fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{f.name}</div>
                          <div style={{fontSize:10,color:T.textMuted}}>{f.size?(sizeMB>=1?sizeMB.toFixed(1)+"MB":Math.round(f.size/1024)+"KB"):""}{big?" · 큼 ⓘ":""}</div>
                        </div>
                        <button onClick={()=>proxyPreview&&proxyPreview(f.id,f.name)} disabled={!proxyPreview} style={{padding:"5px 10px",fontSize:11,fontWeight:700,borderRadius:5,border:`1px solid ${T.blue}`,background:T.white,color:T.blue,cursor:"pointer",fontFamily:"inherit"}}>👁 보기</button>
                        <button onClick={()=>proxyDownload&&proxyDownload(f.id,f.name)} disabled={!proxyDownload} style={{padding:"5px 10px",fontSize:11,fontWeight:700,borderRadius:5,border:"none",background:T.goldDark,color:T.white,cursor:"pointer",fontFamily:"inherit"}}>⬇ 다운</button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    <div style={{textAlign:"center",padding:"20px 0 12px"}}>
      <div style={{fontSize:36,marginBottom:4}}>📊</div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text}}>반별 성적</h1>
      <p style={{fontSize:13,color:T.textMuted}}>학생별 점수 · 오답번호 · 반 평균 / 최고 / 최저</p>
    </div>
    <div style={S.card}>
      {/* 날짜 모드 토글 */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        {[{k:"single",label:"📅 단일 날짜"},{k:"range",label:"📆 기간 (학생별 흐름)"}].map(m=>{
          const a = dateMode===m.k;
          return(<button key={m.k} onClick={()=>setDateMode(m.k)} style={{
            flex:1,padding:"8px",fontSize:12,fontWeight:a?700:500,borderRadius:8,
            border:`1.5px solid ${a?T.goldDark:T.border}`,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,
            cursor:"pointer",fontFamily:"inherit"
          }}>{m.label}</button>);
        })}
      </div>
      {/* 날짜 입력 */}
      {dateMode==="single" ? (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:3}}>날짜</div>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{...S.inp,width:"100%"}}/>
        </div>
      ) : (
        <>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          <div>
            <div style={{fontSize:11,color:T.textMuted,marginBottom:3}}>시작</div>
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{...S.inp,width:"100%"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:T.textMuted,marginBottom:3}}>끝</div>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{...S.inp,width:"100%"}}/>
          </div>
        </div>
        {/* ★ v23.1: 시험명 무시 토글 — 같은 반의 다양한 시험 종류를 한 흐름으로 묶기 */}
        <div style={{padding:"8px 12px",background:T.goldPale,borderRadius:8,marginBottom:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:12,fontWeight:700,color:T.goldDeep}}>📊 묶음 방식:</span>
          <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,fontWeight:rangeIgnoreExamType?700:500,color:rangeIgnoreExamType?T.goldDark:T.textSub}}>
            <input type="radio" checked={rangeIgnoreExamType} onChange={()=>setRangeIgnoreExamType(true)} style={{cursor:"pointer"}}/>
            반 단위 통합 (시험명 무시)
          </label>
          <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,fontWeight:!rangeIgnoreExamType?700:500,color:!rangeIgnoreExamType?T.goldDark:T.textSub}}>
            <input type="radio" checked={!rangeIgnoreExamType} onChange={()=>setRangeIgnoreExamType(false)} style={{cursor:"pointer"}}/>
            시험 종류별 분리
          </label>
          <span style={{fontSize:10,color:T.textMuted,flexBasis:"100%",lineHeight:1.4}}>
            {rangeIgnoreExamType ? "💡 같은 반(과목·학년·레벨·선생님)의 모든 시험 종류를 한 줄에 묶어서 흐름 파악" : "각 시험 종류별로 따로 보기"}
          </span>
        </div>
        </>
      )}
      {/* 과목 / 선생님 / 학년 */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        <div>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:3}}>과목</div>
          <select value={subject} onChange={e=>setSubject(e.target.value)} style={{...S.inp,width:"100%"}}>
            <option value="">전체 과목</option>
            {["국어","영어","수학","과학","사회"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:3}}>선생님</div>
          <select value={teacher} onChange={e=>setTeacher(e.target.value)} style={{...S.inp,width:"100%"}}>
            <option value="">전체 선생님</option>
            {sortedSubjects.map(subj=>(
              <optgroup key={subj} label={`── ${subj} ──`}>
                {teachersBySubject[subj].map(name=><option key={subj+"|"+name} value={name}>{name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:3}}>학년</div>
          <select value={grade} onChange={e=>setGrade(e.target.value)} style={{...S.inp,width:"100%"}}>
            <option value="">전체 학년</option>
            {["초3","초4","초5","초6","중1","중2","중3","고1","고2","고3"].map(g=><option key={g}>{g}</option>)}
          </select>
        </div>
      </div>
      <button onClick={load} style={{...S.btnG,width:"100%"}}>🔍 조회</button>
      <div style={{fontSize:10,color:T.textMuted,marginTop:6,textAlign:"center"}}>※ 미달 기준 = 70점 미만 (고정)</div>
    </div>

    {loading ? <div style={{textAlign:"center",padding:30,color:T.textMuted}}>로딩 중…</div> :
     sortedClasses.length === 0 ? <div style={{textAlign:"center",padding:30,color:T.textMuted}}>해당 조건의 시험 데이터 없음<br/><span style={{fontSize:11}}>(시험을 학생들이 제출한 후에 표시됩니다)</span></div> :
     dateMode === "range"
       ? rangeGroups.map((g,i)=>renderRangeCard(g, `rg-${i}`))
       : renderSingleGrouped()
    }
  </div>);
}
/* ═══ 스케줄 탭 — v23.0 에서 제거 ═══
   DB 연결 후 재구현 예정.
   이전 코드는 git history 에서 확인 가능.
*/
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
/* ═══ [v21.0] AI 답지 검수 — 모달 ═══ */
function ReviewDetailModal({item, sheetsUrl, T, S, onClose, onConfirmed, onDeleted}){
  // 모델별 답안을 한 곳에 모아서 비교 + 선생님 수정 + 확정
  const totalQ = parseInt(item.totalQ||0,10);
  const types = item.types || {};
  // 모델 답안 (재요청 후 overrideMR이 있으면 그걸 사용)
  const [overrideMR, setOverrideMR] = useState(null);
  const mr = overrideMR || item.modelResults || {};
  const ga = (mr.gemini && mr.gemini.answers) || {};
  const pa = (mr.gpt && mr.gpt.answers) || {};
  const ca = (mr.claude && mr.claude.answers) || {};
  // 초기 정답: 활성 모델 모두 일치한 문항만 자동 채움.
  // ★ v21.5: GPT 비활성화 감지 — 활성 모델만 일치 검증 (Gemini=Claude 면 OK)
  const gptDisabled = !!(mr.gpt && mr.gpt.error && String(mr.gpt.error).indexOf("비활성화") >= 0);
  const initial = useMemo(()=>{
    const out = {};
    const norm = s=>String(s||"").replace(/[①②③④⑤]/g,m=>({"①":"1","②":"2","③":"3","④":"4","⑤":"5"})[m]).trim();
    for(let q=1;q<=totalQ;q++){
      const k=String(q);
      const g=norm(ga[k]);
      const p=norm(pa[k]);
      const c=norm(ca[k]);
      // GPT 비활성화 → Gemini=Claude 만 확인. 활성이면 3개 모두 일치 필요
      const matched = gptDisabled
        ? !!(g && c && g===c)
        : !!(g && g===p && p===c);
      if(matched){
        out[k]=g;
      } else {
        out[k]="";
      }
    }
    return out;
  },[totalQ, JSON.stringify(ga), JSON.stringify(pa), JSON.stringify(ca), gptDisabled]);
  const [finalAns, setFinalAns] = useState(initial);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfErr, setPdfErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 기본은 "결정 필요" 문항만 보여주기 (자동 채워진 건 숨김)
  // 단, 자동 채움이 0개면 답지를 보면서 다 입력해야 하므로 전체 보기 ON
  const initialShowAll = useMemo(()=>{
    const filledInit = Object.values(initial).filter(v=>String(v||"").trim()!=="").length;
    return filledInit === 0;
  },[JSON.stringify(initial)]);
  const [showAll, setShowAll] = useState(initialShowAll);
  useEffect(()=>{
    if(!item.folderId){setPdfErr("폴더ID 없음 (직접 입력 모드)");return;}
    setPdfLoading(true); setPdfErr("");
    fetch(`${sheetsUrl}?action=get_review_pdf&folderId=${encodeURIComponent(item.folderId)}`)
      .then(r=>r.json()).then(d=>{
        if(d.result==="success") setPdfUrl(d.previewUrl||"");
        else setPdfErr(d.message||"답지 미리보기 실패");
      }).catch(()=>setPdfErr("네트워크 오류")).finally(()=>setPdfLoading(false));
  },[item.folderId, sheetsUrl]);
  const setQ = (q,v)=>setFinalAns(p=>({...p,[String(q)]:v}));
  const filledCount = Object.values(finalAns).filter(v=>String(v||"").trim()!=="").length;
  const blanks = [];
  for(let q=1;q<=totalQ;q++){if(!String(finalAns[String(q)]||"").trim())blanks.push(q);}
  // 모델 답안 갱신 / 액션 진행 상태
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const aiRetry = async ()=>{
    if(!confirm("불일치 문항을 AI에게 다시 요청하고 다수결로 채울까요?\n(현재 입력된 답은 다수결 결정으로 덮어씁니다.)")) return;
    setRetrying(true);
    try{
      const res = await fetch(sheetsUrl,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({action:"ai_retry_mismatches", rowIndex: item.rowIndex})
      });
      const d = await res.json();
      if(d.result==="success"){
        // 다수결 결과로 finalAns 업데이트
        setFinalAns(prev=>{
          const next = {...prev};
          Object.keys(d.majorityFinal||{}).forEach(k=>{ next[k] = d.majorityFinal[k]; });
          return next;
        });
        // 모델 결과도 업데이트 (UI 갱신용)
        if(d.modelResults) setOverrideMR(d.modelResults);
        const decided = Object.keys(d.majorityFinal||{}).length;
        const remain = (d.stillMismatch||[]).length;
        alert(`✅ 재요청 완료\n다수결로 결정: ${decided}개\n여전히 불일치: ${remain}개\n\n남은 불일치는 답지 보면서 직접 입력하세요.`);
      } else {
        alert("재요청 실패: "+(d.message||""));
      }
    }catch(e){
      alert("네트워크 오류: "+String(e));
    }finally{setRetrying(false);}
  };
  const removeReview = async ()=>{
    if(!confirm("이 검수 항목을 정답목록에서 완전히 삭제할까요?\n(되돌릴 수 없습니다)")) return;
    setDeleting(true);
    try{
      const res = await fetch(sheetsUrl,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({action:"delete_review", rowIndex: item.rowIndex, deletedBy: item.teacher||""})
      });
      const d = await res.json();
      if(d.result==="success"){
        alert("🗑 삭제 완료");
        onDeleted && onDeleted(item.rowIndex);
        onClose();
      } else {
        alert("삭제 실패: "+(d.message||""));
      }
    }catch(e){
      alert("네트워크 오류: "+String(e));
    }finally{setDeleting(false);}
  };
  const submit = async ()=>{
    if(blanks.length>0){
      if(!confirm(`아직 ${blanks.length}개 문항이 비어있습니다.\n비어있는 문항: ${blanks.slice(0,10).join(", ")}${blanks.length>10?"...":""}\n\n그래도 확정할까요?`))return;
    }
    setSubmitting(true);
    try{
      const res = await fetch(sheetsUrl,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({
          action:"confirm_review",
          rowIndex: item.rowIndex,
          finalAnswers: finalAns,
          confirmedBy: item.teacher||""
        })
      });
      const d = await res.json();
      if(d.result==="success"){
        alert("✅ 검수 확정 완료. 정답목록에 저장되었습니다.");
        onConfirmed && onConfirmed(item.rowIndex);
        onClose();
      } else {
        alert("저장 실패: "+(d.message||""));
      }
    }catch(e){
      alert("네트워크 오류: "+String(e));
    }finally{setSubmitting(false);}
  };
  // 표시할 문항: "선생님 결정 필요"한 문항(=initial이 빈칸)만, 또는 전체 보기
  const needReviewQs = [];
  for(let q=1;q<=totalQ;q++){
    if(!String(initial[String(q)]||"").trim()) needReviewQs.push(q);
  }
  const needReviewSet = new Set(needReviewQs);
  const visibleQs = [];
  for(let q=1;q<=totalQ;q++){
    if(showAll || needReviewSet.has(q)) visibleQs.push(q);
  }
  // 헤더용 모델 상태 (실패 사유 + 시도 횟수 같이 표시)
  const modelDiagnostics = ['gemini','gpt','claude'].map(m=>{
    const r = (item.modelResults||{})[m] || {};
    const label = ({gemini:"Gemini",gpt:"GPT",claude:"Claude"}[m]);
    return {
      key: m, label,
      ok: !r.error,
      error: r.error || "",
      attempts: r.attempts || 0,
      answerCount: Object.keys(r.answers||{}).length
    };
  });
  const failedDiag = modelDiagnostics.filter(d=>!d.ok);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"stretch",justifyContent:"center",padding:0}} onClick={onClose}>
      <div style={{background:T.white,width:"100%",maxWidth:1400,height:"100vh",overflow:"hidden",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        {/* 헤더 */}
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:T.goldPale}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:16,fontWeight:800,color:T.text}}>🔍 AI 검수 — {item.subject} {item.grade} {item.level} ({item.examType})</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2}}>👨‍🏫 {item.teacher||"-"} · 📅 {item.date} · 📝 {totalQ}문제 · ✅ 자동 채움 {filledCount}개 · ⚠️ 결정 필요 {needReviewQs.length}개</div>
            <div style={{fontSize:11,marginTop:6,display:"flex",gap:8,flexWrap:"wrap"}}>
              {modelDiagnostics.map(d=>(
                <span key={d.key} title={d.error||""} style={{
                  padding:"2px 8px",borderRadius:10,fontWeight:700,
                  background: d.ok ? "#e6f7ee" : "#ffecec",
                  color: d.ok ? "#0a7d3a" : T.danger,
                  border: `1px solid ${d.ok ? "#9fdfb6" : "#f5b1b1"}`
                }}>
                  {d.ok ? "✅" : "❌"} {d.label} {d.ok ? `(${d.answerCount}문항)` : `(${d.attempts}회 시도)`}
                </span>
              ))}
            </div>
            {failedDiag.length>0 && (
              <div style={{fontSize:11,color:T.danger,marginTop:4,wordBreak:"break-all"}}>
                {failedDiag.map(d=>`▸ ${d.label}: ${d.error}`).join(" | ")}
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
            <button onClick={aiRetry} disabled={retrying} title="불일치 문항만 AI에게 다시 요청해서 다수결로 채웁니다" style={{padding:"6px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:`1px solid ${T.gold}`,background:T.white,color:T.goldDark,cursor:retrying?"wait":"pointer",fontFamily:"inherit"}}>
              {retrying?"⏳ 재요청 중...":"🔄 불일치 재요청"}
            </button>
            <button onClick={removeReview} disabled={deleting} title="이 검수 항목을 정답목록에서 삭제" style={{padding:"6px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:`1px solid ${T.danger}`,background:T.white,color:T.danger,cursor:deleting?"wait":"pointer",fontFamily:"inherit"}}>
              {deleting?"⏳":"🗑 삭제"}
            </button>
            <button onClick={onClose} style={{...S.btnO,padding:"6px 12px"}}>✕ 닫기</button>
          </div>
        </div>
        {/* 본문: 좌측 답지 PDF + 우측 답안 비교 */}
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          {/* 좌측: 답지 PDF */}
          <div style={{flex:"1 1 50%",borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",background:T.bg}}>
            <div style={{padding:"8px 12px",fontSize:12,fontWeight:700,color:T.textSub,borderBottom:`1px solid ${T.border}`,background:T.white}}>📄 답지 PDF</div>
            <div style={{flex:1,position:"relative"}}>
              {pdfLoading && <div style={{padding:24,textAlign:"center",color:T.textMuted}}>답지 불러오는 중...</div>}
              {pdfErr && <div style={{padding:24,color:T.danger}}>{pdfErr}</div>}
              {pdfUrl && (
                <iframe src={pdfUrl} style={{width:"100%",height:"100%",border:"none"}} title="답지 미리보기"/>
              )}
            </div>
          </div>
          {/* 우측: 답안 비교 + 수정 */}
          <div style={{flex:"1 1 50%",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"8px 12px",fontSize:12,fontWeight:700,color:T.textSub,borderBottom:`1px solid ${T.border}`,background:T.white,display:"flex",alignItems:"center",gap:10}}>
              <span>📋 답안 비교 ({filledCount}/{totalQ} 채움)</span>
              <label style={{fontSize:11,fontWeight:600,color:T.textMuted,cursor:"pointer",marginLeft:"auto"}}>
                <input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)} style={{marginRight:4}}/>
                전체 문항 보기
              </label>
            </div>
            <div style={{flex:1,overflow:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead style={{position:"sticky",top:0,background:T.goldPale,zIndex:1}}>
                  <tr>
                    <th style={{padding:"8px 4px",border:`1px solid ${T.border}`,width:36}}>#</th>
                    <th style={{padding:"8px 4px",border:`1px solid ${T.border}`,width:60,color:"#0d8aff"}}>Gemini</th>
                    <th style={{padding:"8px 4px",border:`1px solid ${T.border}`,width:60,color:"#10a37f"}}>GPT</th>
                    <th style={{padding:"8px 4px",border:`1px solid ${T.border}`,width:60,color:"#ca8a04"}}>Claude</th>
                    <th style={{padding:"8px 4px",border:`1px solid ${T.border}`,background:T.goldDark,color:T.white}}>최종 정답</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQs.map(q=>{
                    const k=String(q);
                    const g=String(ga[k]||"");
                    const p=String(pa[k]||"");
                    const c=String(ca[k]||"");
                    const isMis = needReviewSet.has(q);
                    // 주관식 자동 감지: types에 sa/sub 표시 OR 모델 답안에 긴 텍스트(5자 이상 비숫자)가 있으면 주관식 처리
                    const explicitSubj = (types[k]||"")==="sa" || (types[k]||"")==="sub";
                    const longText = [g,p,c].some(v=>v && v.length>=5 && !/^[1-9](\s*,\s*[1-9])*$/.test(v.trim()));
                    const isSubj = explicitSubj || longText;
                    // 다수결 후보 계산 — 정규화 후 동일한 답이 2개 이상이면 추천
                    const norm = s=>String(s||"").replace(/[①②③④⑤]/g,m=>({"①":"1","②":"2","③":"3","④":"4","⑤":"5"})[m])
                                                  .replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
                                                  .replace(/\s*\(\s*\d+\s*\)\s*/g," / ").replace(/[;\n\r]+/g," / ")
                                                  .replace(/\s+/g," ").trim().replace(/[.\s]+$/,"").toLowerCase();
                    const nG=norm(g), nP=norm(p), nC=norm(c);
                    const counts = {};
                    [[nG,g],[nP,p],[nC,c]].forEach(([n,raw])=>{
                      if(n && n!=="?") counts[n] = counts[n] ? {...counts[n], n: counts[n].n+1} : {raw, n:1};
                    });
                    let majorityRaw = "";
                    Object.values(counts).forEach(v=>{ if(v.n>=2 && (!majorityRaw || v.n>(counts[norm(majorityRaw)]?.n||0))) majorityRaw = v.raw; });
                    const renderModelCell = (raw, color) => {
                      const display = raw || "-";
                      const isShort = !raw || raw.length<=10;
                      return (
                        <button
                          type="button"
                          disabled={!raw || raw==="?"}
                          onClick={()=>setQ(q, raw)}
                          title={raw ? `클릭하면 최종정답에 "${raw}" 입력` : ""}
                          style={{
                            width:"100%",minHeight:28,padding:"4px 6px",border:"none",
                            background:"transparent",color:color,fontWeight:600,
                            cursor:(!raw||raw==="?")?"default":"pointer",
                            fontSize:isShort?13:11,
                            textAlign:isShort?"center":"left",
                            wordBreak:"break-word",whiteSpace:"pre-wrap",
                            fontFamily:"inherit"
                          }}>
                          {display}
                        </button>
                      );
                    };
                    return (
                      <tr key={q} style={{background: isMis?"#fff5f0":T.white}}>
                        <td style={{padding:"4px 4px",border:`1px solid ${T.border}`,textAlign:"center",fontWeight:700,color:isMis?T.danger:T.textSub,verticalAlign:"top"}}>{q}{isSubj&&<span style={{fontSize:9,color:T.textMuted,display:"block"}}>주관식</span>}</td>
                        <td style={{padding:0,border:`1px solid ${T.border}`,verticalAlign:"top"}}>{renderModelCell(g,"#0d8aff")}</td>
                        <td style={{padding:0,border:`1px solid ${T.border}`,verticalAlign:"top"}}>{renderModelCell(p,"#10a37f")}</td>
                        <td style={{padding:0,border:`1px solid ${T.border}`,verticalAlign:"top"}}>{renderModelCell(c,"#ca8a04")}</td>
                        <td style={{padding:"4px",border:`1px solid ${T.border}`,verticalAlign:"top"}}>
                          {isSubj ? (
                            <textarea value={finalAns[k]||""} onChange={e=>setQ(q,e.target.value)} placeholder="답 입력 (위 모델 답안 클릭 가능)" rows={Math.max(1,Math.ceil((finalAns[k]||"").length/40))} style={{width:"100%",padding:"4px 6px",fontSize:12,border:`1.5px solid ${isMis?T.danger:T.border}`,borderRadius:6,fontFamily:"inherit",background:isMis?"#fffbf6":T.white,fontWeight:isMis?700:500,textAlign:"left",resize:"vertical",minHeight:28}}/>
                          ) : (
                            <input value={finalAns[k]||""} onChange={e=>setQ(q,e.target.value)} placeholder="1~5" style={{width:"100%",padding:"4px 6px",fontSize:13,border:`1.5px solid ${isMis?T.danger:T.border}`,borderRadius:6,fontFamily:"inherit",background:isMis?"#fffbf6":T.white,fontWeight:isMis?700:500,textAlign:"center"}}/>
                          )}
                          {isMis && majorityRaw && (
                            <button
                              type="button"
                              onClick={()=>setQ(q, majorityRaw)}
                              style={{marginTop:4,width:"100%",padding:"3px 6px",fontSize:10,fontWeight:700,
                                background:"#fff3cd",color:"#855700",border:"1px solid #ffc107",
                                borderRadius:4,cursor:"pointer",fontFamily:"inherit"}}>
                              👥 다수결: "{majorityRaw.length>20?majorityRaw.substring(0,20)+"...":majorityRaw}" 적용
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleQs.length===0 && (
                    <tr><td colSpan={5} style={{padding:24,textAlign:"center",color:T.textMuted}}>표시할 문항이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        {/* 하단 버튼 */}
        <div style={{padding:"12px 18px",borderTop:`1px solid ${T.border}`,background:T.bg,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <div style={{fontSize:12,color:T.textSub}}>
            {blanks.length>0 ? <span style={{color:T.danger,fontWeight:700}}>⚠️ 미입력 {blanks.length}개</span> : <span style={{color:T.accent,fontWeight:700}}>✅ 모든 문항 입력 완료</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={onClose} style={{...S.btnO,padding:"8px 16px"}}>취소</button>
            <button onClick={submit} disabled={submitting} style={{padding:"8px 20px",fontSize:13,fontWeight:700,borderRadius:8,border:"none",background:submitting?T.borderLight:T.goldDark,color:T.white,cursor:submitting?"not-allowed":"pointer",fontFamily:"inherit"}}>{submitting?"저장 중...":"✅ 검수 확정"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function ReviewListModal({sheetsUrl, T, S, onClose, currentTeacher}){
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(null);
  // 본인 것만 보기 (현재 로그인 선생님이 있으면 기본 ON)
  const [onlyMine, setOnlyMine] = useState(!!currentTeacher);
  const load = useCallback(()=>{
    setLoading(true); setErr("");
    fetch(`${sheetsUrl}?action=list_review_pending`)
      .then(r=>r.json()).then(d=>{
        if(d.result==="success") setItems(d.items||[]);
        else setErr(d.message||"조회 실패");
      }).catch(()=>setErr("네트워크 오류")).finally(()=>setLoading(false));
  },[sheetsUrl]);
  useEffect(()=>{ load(); },[load]);
  // 항목별 삭제
  const deleteItem = async (rowIndex, ev)=>{
    if(ev) ev.stopPropagation();
    if(!confirm("이 검수 항목을 삭제할까요? (되돌릴 수 없습니다)")) return;
    try{
      const res = await fetch(sheetsUrl,{
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({action:"delete_review", rowIndex, deletedBy: currentTeacher||""})
      });
      const d = await res.json();
      if(d.result==="success"){ load(); }
      else alert("삭제 실패: "+(d.message||""));
    }catch(e){ alert("네트워크 오류: "+String(e)); }
  };
  if(selected){
    return <ReviewDetailModal item={selected} sheetsUrl={sheetsUrl} T={T} S={S} onClose={()=>setSelected(null)} onConfirmed={()=>{ setSelected(null); load(); }} onDeleted={()=>{ setSelected(null); load(); }}/>;
  }
  // 필터링
  const filteredItems = onlyMine && currentTeacher
    ? items.filter(it=>String(it.teacher||"").trim() === currentTeacher.trim())
    : items;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{background:T.white,width:"100%",maxWidth:900,maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",borderRadius:12}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:T.goldPale}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:T.text}}>🔍 AI 검수 대기 목록</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2}}>{onlyMine && currentTeacher ? `${currentTeacher} 선생님 ` : "전체 "}검수 대기 {filteredItems.length}건 / 전체 {items.length}건</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {currentTeacher && (
              <label style={{fontSize:11,fontWeight:700,color:T.textSub,cursor:"pointer",display:"flex",alignItems:"center",gap:4,padding:"6px 10px",background:T.white,borderRadius:6,border:`1px solid ${T.border}`}}>
                <input type="checkbox" checked={onlyMine} onChange={e=>setOnlyMine(e.target.checked)}/>
                본인 것만
              </label>
            )}
            <button onClick={load} style={{...S.btnO,padding:"6px 12px"}}>🔄 새로고침</button>
            <button onClick={onClose} style={{...S.btnO,padding:"6px 12px"}}>✕ 닫기</button>
          </div>
        </div>
        <div style={{flex:1,overflow:"auto",padding:14}}>
          {loading && <div style={{padding:24,textAlign:"center",color:T.textMuted}}>불러오는 중...</div>}
          {err && <div style={{padding:14,background:T.dangerLight,borderRadius:10,color:T.danger,fontSize:13,fontWeight:600,textAlign:"center"}}>{err}</div>}
          {!loading && !err && filteredItems.length===0 && (
            <div style={{padding:40,textAlign:"center",color:T.textMuted}}>
              <div style={{fontSize:36,marginBottom:8}}>✨</div>
              <div style={{fontSize:14,fontWeight:600}}>검수 대기 항목이 없습니다.</div>
              <div style={{fontSize:12,marginTop:4}}>{onlyMine && currentTeacher ? "본인 담당 시험 중 검수 필요한 답지가 없습니다." : "모든 답지가 자동 등록되었습니다."}</div>
            </div>
          )}
          {!loading && filteredItems.length>0 && (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filteredItems.map(it=>(
                <div key={it.rowIndex} onClick={()=>setSelected(it)} style={{padding:"12px 14px",border:`1.5px solid ${T.border}`,borderRadius:10,background:T.white,cursor:"pointer",display:"flex",alignItems:"center",gap:10,transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=T.goldDark;e.currentTarget.style.background=T.goldPale;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.white;}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:T.text}}>{it.subject} {it.grade} {it.level} <span style={{color:T.textSub,fontWeight:500}}>· {it.examType}{it.setType?" ("+it.setType+")":""}</span></div>
                    <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>👨‍🏫 {it.teacher||"-"} · 📅 {it.date} · 📝 {it.totalQ}문제 · 🏫 {it.className||"-"}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:18,fontWeight:800,color:T.danger}}>{it.mismatchCount}</div>
                    <div style={{fontSize:10,color:T.textMuted}}>불일치</div>
                  </div>
                  <button onClick={(e)=>deleteItem(it.rowIndex, e)} title="삭제" style={{padding:"4px 8px",fontSize:12,fontWeight:700,borderRadius:4,border:`1px solid ${T.danger}`,background:T.white,color:T.danger,cursor:"pointer",fontFamily:"inherit"}}>🗑</button>
                  <div style={{fontSize:18,color:T.goldDark,marginLeft:6}}>›</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// [v21.1] 확정 답지 조회 모달 (AUTO_OK + MANUAL_CONFIRMED)
function ConfirmedAnswersModal({sheetsUrl, T, S, onClose, currentTeacher}){
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [days, setDays] = useState(30);
  const [onlyMine, setOnlyMine] = useState(!!currentTeacher);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const load = useCallback(()=>{
    setLoading(true); setErr("");
    const teacherParam = (onlyMine && currentTeacher) ? `&teacher=${encodeURIComponent(currentTeacher)}` : "";
    fetch(`${sheetsUrl}?action=list_confirmed_answers&days=${days}${teacherParam}`)
      .then(r=>r.json()).then(d=>{
        if(d.result==="success") setItems(d.items||[]);
        else setErr(d.message||"조회 실패");
      }).catch(()=>setErr("네트워크 오류")).finally(()=>setLoading(false));
  },[sheetsUrl, days, onlyMine, currentTeacher]);
  useEffect(()=>{ load(); },[load]);
  const openDetail = async (it)=>{
    setDetailLoading(true);
    try{
      const r = await fetch(`${sheetsUrl}?action=get_confirmed_detail&rowIndex=${it.rowIndex}`);
      const d = await r.json();
      if(d.result==="success") setDetail(d);
      else alert("상세 조회 실패: "+(d.message||""));
    }catch(e){ alert("네트워크 오류: "+String(e)); }
    finally{ setDetailLoading(false); }
  };
  if(detail){
    const ans = detail.answers||{};
    const types = detail.types||{};
    const ks = Object.keys(ans).sort((a,b)=>parseInt(a,10)-parseInt(b,10));
    const startNum = parseInt(detail.startNumber||1,10);
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setDetail(null)}>
        <div style={{background:T.white,width:"100%",maxWidth:700,maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",borderRadius:12}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:T.goldPale}}>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:T.text}}>📖 {detail.subject} {detail.grade} {detail.level} ({detail.examType})</div>
              <div style={{fontSize:11,color:T.textSub,marginTop:2}}>👨‍🏫 {detail.teacher||"-"} · 📅 {detail.date} · {detail.totalQ}문제 · 시작번호 {startNum} · 상태 {detail.status==="AUTO_OK"?"✅ 자동확정":"✋ 수동확정"}</div>
            </div>
            <button onClick={()=>setDetail(null)} style={{...S.btnO,padding:"6px 12px"}}>✕ 닫기</button>
          </div>
          <div style={{flex:1,overflow:"auto",padding:14}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead style={{position:"sticky",top:0,background:T.goldPale}}>
                <tr><th style={{padding:6,border:`1px solid ${T.border}`,width:80}}>문항</th><th style={{padding:6,border:`1px solid ${T.border}`,width:60}}>유형</th><th style={{padding:6,border:`1px solid ${T.border}`}}>정답</th></tr>
              </thead>
              <tbody>
                {ks.map(k=>{
                  const isSubj = (types[k]||"")==="sa" || (types[k]||"")==="sub" || (String(ans[k]||"").length>=5 && !/^[1-9](\s*,\s*[1-9])*$/.test(String(ans[k]||"").trim()));
                  const displayNum = startNum > 1 ? `${k} (원본: ${startNum + parseInt(k,10) - 1})` : k;
                  return (
                    <tr key={k}>
                      <td style={{padding:6,border:`1px solid ${T.border}`,textAlign:"center",fontWeight:700,color:T.textSub}}>{displayNum}</td>
                      <td style={{padding:6,border:`1px solid ${T.border}`,textAlign:"center",color:T.textMuted,fontSize:11}}>{isSubj?"주관식":"객관식"}</td>
                      <td style={{padding:6,border:`1px solid ${T.border}`,fontWeight:600,color:T.goldDark,wordBreak:"break-word"}}>{ans[k]||"(미입력)"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{background:T.white,width:"100%",maxWidth:900,maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",borderRadius:12}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:T.goldPale}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:T.text}}>📖 확정 답지 조회</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2}}>최근 {days}일 · {onlyMine && currentTeacher ? `${currentTeacher} 선생님 ` : "전체 "}{items.length}건</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <select value={days} onChange={e=>setDays(parseInt(e.target.value,10))} style={{padding:"6px 8px",fontSize:12,fontWeight:700,borderRadius:6,border:`1px solid ${T.border}`,background:T.white,fontFamily:"inherit"}}>
              <option value={7}>최근 7일</option>
              <option value={30}>최근 30일</option>
              <option value={90}>최근 90일</option>
              <option value={365}>최근 1년</option>
            </select>
            {currentTeacher && (
              <label style={{fontSize:11,fontWeight:700,color:T.textSub,cursor:"pointer",display:"flex",alignItems:"center",gap:4,padding:"6px 10px",background:T.white,borderRadius:6,border:`1px solid ${T.border}`}}>
                <input type="checkbox" checked={onlyMine} onChange={e=>setOnlyMine(e.target.checked)}/>
                본인 것만
              </label>
            )}
            <button onClick={load} style={{...S.btnO,padding:"6px 12px"}}>🔄</button>
            <button onClick={onClose} style={{...S.btnO,padding:"6px 12px"}}>✕ 닫기</button>
          </div>
        </div>
        <div style={{flex:1,overflow:"auto",padding:14}}>
          {(loading || detailLoading) && <div style={{padding:24,textAlign:"center",color:T.textMuted}}>불러오는 중...</div>}
          {err && <div style={{padding:14,background:T.dangerLight,borderRadius:10,color:T.danger,fontSize:13,fontWeight:600,textAlign:"center"}}>{err}</div>}
          {!loading && !err && items.length===0 && (
            <div style={{padding:40,textAlign:"center",color:T.textMuted}}>
              <div style={{fontSize:36,marginBottom:8}}>📭</div>
              <div style={{fontSize:14,fontWeight:600}}>확정된 답지가 없습니다.</div>
            </div>
          )}
          {!loading && items.length>0 && (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {items.map(it=>(
                <div key={it.rowIndex} style={{padding:"10px 12px",border:`1px solid ${T.border}`,borderRadius:8,background:T.white,display:"flex",alignItems:"center",gap:10}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=T.goldDark;e.currentTarget.style.background=T.goldPale;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.white;}}>
                  <div style={{fontSize:11,fontWeight:700,padding:"2px 6px",borderRadius:4,background:it.status==="AUTO_OK"?"#e6f7ee":"#fff3cd",color:it.status==="AUTO_OK"?"#0a7d3a":"#855700"}}>
                    {it.status==="AUTO_OK"?"✅ 자동":"✋ 수동"}
                  </div>
                  <div style={{flex:1,cursor:"pointer"}} onClick={()=>openDetail(it)}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text}}>{it.subject} {it.grade} {it.level} <span style={{color:T.textSub,fontWeight:500}}>· {it.examType}{it.setType?" ("+it.setType+")":""}</span></div>
                    <div style={{fontSize:10,color:T.textMuted,marginTop:1}}>👨‍🏫 {it.teacher||"-"} · 📅 {it.date} · {it.totalQ}문제 · 답안 {it.answerCount}개</div>
                  </div>
                  <button onClick={async(e)=>{
                    e.stopPropagation();
                    if(!confirm(`"${it.subject} ${it.grade} ${it.level} (${it.examType})" 답지를 삭제하시겠습니까?\n\n⚠️ 학생앱에서도 즉시 사라집니다. 복구 불가능.`))return;
                    try{
                      // ★ Content-Type: text/plain 으로 CORS preflight 회피 (다른 POST 호출과 동일 패턴)
                      const r=await fetch(sheetsUrl,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},
                        body:JSON.stringify({action:"delete_review",rowIndex:it.rowIndex,deletedBy:currentTeacher||""})});
                      const d=await r.json();
                      if(d.result==="success"){
                        alert("✅ 삭제 완료\n학생앱에서도 즉시 검색 안 됩니다.");
                        load();
                      }else{
                        alert("삭제 실패: "+(d.message||""));
                      }
                    }catch(err){alert("네트워크 오류: "+String(err));}
                  }} style={{padding:"6px 10px",fontSize:11,fontWeight:700,borderRadius:6,border:`1px solid ${T.danger}`,background:T.white,color:T.danger,cursor:"pointer",fontFamily:"inherit"}} title="삭제">🗑</button>
                  <div onClick={()=>openDetail(it)} style={{fontSize:16,color:T.goldDark,cursor:"pointer"}}>›</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function DashboardTab({sheetsUrl, T, S, teacherList, proxyDownload, proxyPreview, currentTeacher}){
  const todayIsoStr=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
  const [dashDate, setDashDate] = useState(todayIsoStr());
  const [dashData, setDashData] = useState(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashErr, setDashErr] = useState("");
  // ★ v23.0: schStatus 제거 (스케줄 기능 삭제), activeSubj 제거 (시간별 표 레이아웃)
  const [openFiles, setOpenFiles] = useState({}); // {exam_i_j: bool}
  // [v21.0] AI 검수 대기 카운트 + 모달
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [confirmedModalOpen, setConfirmedModalOpen] = useState(false);
  const toggleFiles = (k)=>setOpenFiles(p=>({...p,[k]:!p[k]}));
  // ★ v23.1/23.2: 정답 보기·편집 모달
  const [ansModalOpen, setAnsModalOpen] = useState(false);
  const [ansModalLoading, setAnsModalLoading] = useState(false);
  const [ansModalData, setAnsModalData] = useState({title:"", err:"", totalQ:0, answers:{}, types:{}, meta:{}});
  const [ansEditMode, setAnsEditMode] = useState(false);
  const [ansEditData, setAnsEditData] = useState({answers:{}, types:{}, totalQ:0});
  const [ansEditSaving, setAnsEditSaving] = useState(false);
  const openAnswerModal = async (ex)=>{
    setAnsModalOpen(true);
    setAnsModalLoading(true);
    setAnsEditMode(false);
    setAnsModalData({title:`${ex.subject||""} ${ex.grade||""} ${ex.level||""}반 · ${ex.examType||""}`, err:"", totalQ:0, answers:{}, types:{}, meta:{}});
    try {
      // ★ v23.6: folderId 와 메타데이터 둘 다 보냄 — GAS 가 폴더ID 매칭 실패 시 메타데이터로 fallback
      const params = new URLSearchParams();
      if (ex.folderId) params.set("folderId", ex.folderId);
      params.set("subject", ex.subject||"");
      params.set("grade", ex.grade||"");
      params.set("level", ex.level||"");
      params.set("examType", ex.examType||"");
      if (ex.teacher) params.set("teacher", ex.teacher);
      params.set("date", ex.date||"");
      const r = await fetch(`${sheetsUrl}?action=view_answer_key&${params.toString()}`);
      const d = await r.json();
      if (d.result === "ok") {
        setAnsModalData(p=>({...p, totalQ:d.totalQ||0, answers:d.answers||{}, types:d.types||{}, meta:d.meta||{}}));
      } else {
        setAnsModalData(p=>({...p, err:d.message||"조회 실패"}));
      }
    } catch(e) {
      setAnsModalData(p=>({...p, err:"네트워크 오류: "+String(e)}));
    }
    setAnsModalLoading(false);
  };
  // ★ v23.2: 편집 모드 진입
  const startAnsEdit = ()=>{
    setAnsEditData({
      answers: {...ansModalData.answers},
      types: {...ansModalData.types},
      totalQ: ansModalData.totalQ
    });
    setAnsEditMode(true);
  };
  // ★ v23.5: 정답 편집 저장 — GAS 가 자동으로 객관식 재채점까지 처리 (학생앱은 항상 GAS 실시간 조회 → 자동 동기화)
  const saveAnsEdit = async ()=>{
    if (ansEditSaving) return;
    const folderId = ansModalData.meta?.folderId;
    if (!folderId) { alert("folderId 없음 — 저장 불가"); return; }
    setAnsEditSaving(true);
    try {
      const params = new URLSearchParams();
      params.set("action", "update_answer_key");
      params.set("folderId", folderId);
      params.set("answers", JSON.stringify(ansEditData.answers));
      params.set("types", JSON.stringify(ansEditData.types));
      params.set("totalQ", String(ansEditData.totalQ));
      const r = await fetch(`${sheetsUrl}?${params.toString()}`);
      const d = await r.json();
      if (d.result === "ok") {
        setAnsModalData(p=>({...p, answers:ansEditData.answers, types:ansEditData.types, totalQ:ansEditData.totalQ}));
        setAnsEditMode(false);
        const regradedN = d.regraded || 0;
        const subjN = d.subjectNeedsAI || 0;
        let msg = "✅ 정답 저장 완료!\n\n";
        if (regradedN > 0) {
          msg += `🎯 객관식 ${regradedN}명 자동 재채점 완료\n`;
          msg += `📡 학생앱도 즉시 새 정답 기준으로 조회됩니다`;
          if (subjN > 0) msg += `\n📝 주관식 ${subjN}명은 밤 11시 AI 채점에 반영`;
        } else {
          msg += `📡 학생앱에 새 정답이 즉시 적용됩니다 (제출자 없음)`;
        }
        alert(msg);
        loadDashboard(); // 대시보드 즉시 갱신
      } else {
        alert("저장 실패: " + (d.message||"알 수 없음"));
      }
    } catch(e) { alert("네트워크 오류: " + String(e)); }
    setAnsEditSaving(false);
  };
  // ★ v23.3: 현재 모달의 시험 강제 재채점
  const [regradeRunning, setRegradeRunning] = useState(false);
  const forceRegradeCurrentExam = async ()=>{
    const folderId = ansModalData.meta?.folderId;
    if (!folderId) { alert("folderId 없음 — 재채점 불가"); return; }
    if (regradeRunning) return;
    setRegradeRunning(true);
    try {
      const r = await fetch(`${sheetsUrl}?action=force_regrade_by_folder&folderId=${encodeURIComponent(folderId)}`);
      const d = await r.json();
      if (d.result === "ok") {
        alert(`💯 재채점 완료\n\n${d.message||""}`);
        loadDashboard(); // 대시보드 즉시 갱신
      } else {
        alert("재채점 실패: " + (d.message||"알 수 없음"));
      }
    } catch(e) { alert("네트워크 오류: " + String(e)); }
    setRegradeRunning(false);
  };
  // ★ v23.2: 정답 행 삭제
  const deleteAnsRow = async ()=>{
    const folderId = ansModalData.meta?.folderId;
    if (!folderId) { alert("folderId 없음 — 삭제 불가"); return; }
    if (!window.confirm("정말 이 정답 데이터를 삭제할까요?\n\n삭제 후엔 학생이 새로 시험 보더라도 채점 불가능합니다.\n(원본 시험지/답지 파일은 Drive에 그대로 남습니다)")) return;
    try {
      const r = await fetch(`${sheetsUrl}?action=delete_answer_row&folderId=${encodeURIComponent(folderId)}`);
      const d = await r.json();
      if (d.result === "ok") {
        alert("삭제 완료. 새로 답지를 등록하려면 '시험 등록' 탭을 이용해주세요.");
        setAnsModalOpen(false);
        loadDashboard();
      } else {
        alert("삭제 실패: " + (d.message||"알 수 없음"));
      }
    } catch(e) { alert("네트워크 오류: " + String(e)); }
  };
  // ★ v23.1: 파일 일괄 다운로드 (오늘 모든 시험지/답지)
  const [batchDlRunning, setBatchDlRunning] = useState(false);
  const [batchDlProgress, setBatchDlProgress] = useState({done:0, total:0, current:""});
  const batchDownloadAllFiles = async (allExams)=>{
    if (batchDlRunning) return;
    const allFiles = [];
    allExams.forEach(ex=>{
      (ex.files||[]).forEach(fl=>{
        allFiles.push({...fl, examLabel:`${ex.subject||""}_${ex.grade||""}_${ex.level||""}_${ex.examType||""}_${ex.teacher||""}`});
      });
    });
    if (allFiles.length === 0) {
      alert("다운로드할 파일이 없습니다.");
      return;
    }
    if (!window.confirm(`총 ${allFiles.length}개 파일을 순차적으로 다운로드합니다. 시작할까요?\n(브라우저 팝업/다운로드 차단을 허용해 주세요)`)) return;
    setBatchDlRunning(true);
    setBatchDlProgress({done:0, total:allFiles.length, current:""});
    for (let i=0; i<allFiles.length; i++) {
      const fl = allFiles[i];
      setBatchDlProgress({done:i, total:allFiles.length, current:fl.name});
      try {
        await proxyDownload(fl.id, `${fl.examLabel}_${fl.name}`);
        await new Promise(r=>setTimeout(r, 600)); // 브라우저 부하 완화
      } catch(e) { /* 한 파일 실패는 계속 */ }
    }
    setBatchDlProgress({done:allFiles.length, total:allFiles.length, current:""});
    setBatchDlRunning(false);
    setTimeout(()=>setBatchDlProgress({done:0,total:0,current:""}), 3000);
  };
  const loadReviewCount = useCallback(()=>{
    fetch(`${sheetsUrl}?action=list_review_pending`)
      .then(r=>r.json()).then(d=>{
        if(d.result==="success") setReviewCount((d.items||[]).length);
      }).catch(()=>{});
  },[sheetsUrl]);
  const loadDashboard = useCallback((dateOverride)=>{
    const d=dateOverride||dashDate;
    setDashLoading(true); setDashErr(""); setDashData(null);
    fetch(`${sheetsUrl}?action=teacher_dashboard&date=${encodeURIComponent(d)}`)
      .then(r=>r.json()).then(d2=>{if(d2.result==="ok"){setDashData(d2);}else{setDashErr(d2.message||"조회 실패");}setDashLoading(false);})
      .catch(()=>{setDashErr("네트워크 오류");setDashLoading(false);});
    // ★ v23.0: 스케줄 기능 제거 (DB 연결 후 재구현 예정)
    loadReviewCount();
  }, [dashDate, sheetsUrl, loadReviewCount]);
  useEffect(()=>{ loadDashboard(); }, [loadDashboard]);
  // ★ v23.7: 시험 전체 취소 — 정답목록 행 삭제 + (선택) Drive 파일 정리 → 학생앱에서 즉시 사라짐
  const cancelDashExam = useCallback(async (ex)=>{
    const examLabel = `${ex.subject||""} ${ex.grade||""} ${ex.level||""}반 · ${ex.examType||""}${ex.setType?` (${ex.setType})`:""}`;
    if (!ex.rowIndex) {
      alert("⚠️ 이 시험은 행 정보가 없어 직접 취소할 수 없습니다.\n새로고침 후 다시 시도하거나, 시트에서 직접 확인하세요.");
      return;
    }
    // 1차 확인
    if (!window.confirm(`이 시험을 취소할까요?\n\n📚 ${examLabel}\n📝 ${ex.totalQuestions||0}문항\n\n취소하면 학생앱에서 즉시 사라집니다.\n(잘못 등록했거나 답지를 교체해야 할 때 사용)`)) return;
    // Drive 파일 옵션 (folderId가 있을 때만 물어봄)
    let trashFiles = false;
    if (ex.folderId) {
      trashFiles = window.confirm(`Drive에 올린 시험지·답지 파일도 함께 휴지통으로 보낼까요?\n\n[확인] = 정답 + 파일 모두 정리 (휴지통, 30일 복구 가능)\n[취소] = 정답 데이터만 삭제 (파일은 Drive 그대로 유지)`);
    }
    // 2차 최종 확인
    if (!window.confirm(`정말 취소하시겠습니까? (마지막 확인)\n\n📚 ${examLabel}\n\n진행 후엔:\n· 학생앱에서 이 시험이 즉시 사라집니다\n· 정답 데이터는 '정답목록_취소백업_…' 시트에 자동 보관\n${trashFiles?"· Drive 파일도 휴지통으로 (30일 내 복구 가능)":"· Drive 파일은 그대로 유지"}\n\n진행할까요?`)) return;
    try {
      const params = new URLSearchParams({
        action: "cancel_dash_exam",
        rowIndex: String(ex.rowIndex),
        confirm: "YES",
        trashFiles: trashFiles ? "1" : "0",
        folderId: ex.folderId || ""
      });
      const r = await fetch(`${sheetsUrl}?${params.toString()}`);
      const d = await r.json();
      if (d.result === "ok") {
        alert(`✅ 시험 취소 완료\n\n📚 ${examLabel}\n학생앱에서 즉시 사라집니다.\n${d.trashedFiles>0?`\n📁 Drive 파일 ${d.trashedFiles}개 휴지통 이동`:""}\n\n🛟 복구용 백업: ${d.backupSheet}`);
        // 즉시 갱신 (캐시 무효화 + 강제 재조회)
        try {
          const todayParam = encodeURIComponent(dashDate);
          await fetch(`${sheetsUrl}?action=teacher_dashboard&date=${todayParam}&nocache=1&force_scan=1`);
        } catch(_e) {}
        loadDashboard();
      } else {
        alert("❌ 취소 실패: " + (d.message||"알 수 없는 오류"));
      }
    } catch(e) {
      alert("네트워크 오류: " + String(e));
    }
  }, [sheetsUrl, loadDashboard, dashDate]);
  // ★ v23.7: 시험지/답지 파일 삭제 — 2차 확인 후 휴지통 이동
  const deleteDashFile = useCallback(async (fl, examLabel)=>{
    const kindLabel = fl.kind==="answer" ? "답지" : "시험지";
    // 1차 확인
    if (!window.confirm(`이 ${kindLabel} 파일을 삭제할까요?\n\n${fl.name}\n\n(잘못 올렸을 때 사용)`)) return;
    // 2차 확인
    if (!window.confirm(`정말 삭제할까요?\n\n📁 ${examLabel||""}\n${fl.kind==="answer"?"🔑":"📄"} ${fl.name}\n\n삭제 후 Drive 휴지통에서 30일 내 복구 가능합니다.`)) return;
    try {
      const r = await fetch(`${sheetsUrl}?action=delete_dash_file&fileId=${encodeURIComponent(fl.id)}&confirm=YES`);
      const d = await r.json();
      if (d.result === "ok") {
        alert(`✅ 삭제 완료\n\n${d.fileName||fl.name}\n(휴지통으로 이동)`);
        loadDashboard(); // 즉시 갱신
      } else {
        alert("삭제 실패: " + (d.message||"알 수 없는 오류"));
      }
    } catch(e) {
      alert("네트워크 오류: " + String(e));
    }
  }, [sheetsUrl, loadDashboard]);
  // [v21.0] 30초마다 검수 대기 카운트 갱신
  useEffect(()=>{
    const id = setInterval(loadReviewCount, 30000);
    return ()=>clearInterval(id);
  },[loadReviewCount]);
  const isDashToday=dashDate===todayIsoStr();
  const dashDateLabel=(()=>{const m=dashDate.match(/(\d{4})-(\d{2})-(\d{2})/);return m?`${parseInt(m[2])}/${parseInt(m[3])}`:"";})();
  return(<div style={S.wrap} className="fade-up">
    <div style={{textAlign:"center",padding:"20px 0 12px",position:"relative"}}>
      <div style={{fontSize:36,marginBottom:4}}>📊</div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:4}}>{isDashToday?"오늘의 현황":`${dashDateLabel} 시험 현황`}</h1>
      <p style={{fontSize:13,color:T.textMuted}}>{isDashToday?"오늘":dashDateLabel} 시험 · 과목 · 학년 · 선생님별 분류</p>
      {/* ★ v23.2: 확정 답지 조회 버튼 제거 — 각 시험 카드의 "정답 보기" 버튼으로 통합 */}
    </div>
    {/* [v21.0] AI 검수 대기 배너 */}
    {reviewCount > 0 && (
      <div onClick={()=>setReviewModalOpen(true)} style={{padding:"12px 16px",borderRadius:10,background:"linear-gradient(135deg, #FFF3D0 0%, #FFE5A0 100%)",border:`2px solid ${T.goldDark}`,marginBottom:10,cursor:"pointer",display:"flex",alignItems:"center",gap:10,transition:"all 0.15s"}}
        onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 4px 12px rgba(212,160,23,0.25)";}}
        onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
        <div style={{fontSize:28}}>🔍</div>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:800,color:T.goldDeep}}>AI 검수 대기 — {reviewCount}건</div>
          <div style={{fontSize:11,color:T.textSub,marginTop:2}}>3중 만장일치에 실패한 답안. 클릭해서 검수해주세요.</div>
        </div>
        <div style={{fontSize:22,fontWeight:800,color:T.danger,padding:"6px 14px",background:T.white,borderRadius:8,minWidth:50,textAlign:"center"}}>{reviewCount}</div>
        <div style={{fontSize:20,color:T.goldDark}}>›</div>
      </div>
    )}
    {reviewModalOpen && <ReviewListModal sheetsUrl={sheetsUrl} T={T} S={S} currentTeacher={currentTeacher} onClose={()=>{setReviewModalOpen(false);loadReviewCount();}}/>}
    {confirmedModalOpen && <ConfirmedAnswersModal sheetsUrl={sheetsUrl} T={T} S={S} currentTeacher={currentTeacher} onClose={()=>setConfirmedModalOpen(false)}/>}
    {/* ★ v23.2: 정답 보기·편집 모달 — 번호 순 통합, 편집/삭제 지원 */}
    {ansModalOpen && (
      <div onClick={()=>setAnsModalOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:T.white,borderRadius:14,width:"100%",maxWidth:720,maxHeight:"88vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,background:T.goldPale,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:15,fontWeight:800,color:T.goldDeep}}>🔑 정답 데이터 {ansEditMode&&<span style={{fontSize:11,padding:"2px 8px",background:T.danger,color:T.white,borderRadius:6,marginLeft:6}}>편집 중</span>}</div>
              <div style={{fontSize:11,color:T.textSub,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ansModalData.title}</div>
            </div>
            <button onClick={()=>{ if(ansEditMode&&!window.confirm("편집 내용 버리고 닫을까요?")) return; setAnsModalOpen(false); }} style={{...S.btnO,padding:"6px 12px"}}>✕ 닫기</button>
          </div>
          <div style={{flex:1,overflow:"auto",padding:14}}>
            {ansModalLoading && <div style={{padding:20,textAlign:"center",color:T.textMuted}}>로딩 중...</div>}
            {ansModalData.err && <div style={{padding:14,background:T.dangerLight,color:T.danger,borderRadius:8,fontSize:13,fontWeight:600,textAlign:"center"}}>{ansModalData.err}</div>}
            {!ansModalLoading && !ansModalData.err && ansModalData.totalQ > 0 && (()=>{
              const meta = ansModalData.meta || {};
              const total = ansModalData.totalQ || 0;
              const startN = meta.startNumber || 1;
              const ansSrc = ansEditMode ? ansEditData.answers : (ansModalData.answers||{});
              const typSrc = ansEditMode ? ansEditData.types : (ansModalData.types||{});
              const items = [];
              let objN=0, subN=0;
              for (let i=0; i<total; i++) {
                const num = String(startN + i);
                const t = typSrc[num] || typSrc[i+1] || "obj";
                const a = ansSrc[num] !== undefined ? ansSrc[num] : (ansSrc[i+1] !== undefined ? ansSrc[i+1] : "");
                items.push({num, type:t, ans:a});
                if (t==="sub") subN++; else objN++;
              }
              const updateA = (num, v)=>setAnsEditData(p=>({...p, answers:{...p.answers, [num]:v}}));
              const updateT = (num, v)=>setAnsEditData(p=>({...p, types:{...p.types, [num]:v}}));
              return (
                <div>
                  {/* 메타 정보 */}
                  <div style={{padding:"8px 12px",background:T.bg,borderRadius:6,marginBottom:10,fontSize:11,color:T.textSub,display:"flex",gap:12,flexWrap:"wrap"}}>
                    <span>👨‍🏫 <b>{meta.teacher||"-"}</b></span>
                    <span>📅 {meta.date||"-"}</span>
                    <span>📝 총 {total}문항</span>
                    <span>🅰 객관식 {objN}</span>
                    <span>✍️ 주관식 {subN}</span>
                    {meta.setLabel && <span>📦 {meta.setLabel}</span>}
                  </div>
                  {/* 번호 순서대로 통합 표시 */}
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {items.map((q,qi)=>{
                      const isObj = q.type === "obj";
                      const bg = isObj ? T.goldLight : T.bg;
                      const border = isObj ? T.goldMuted : T.border;
                      return (
                        <div key={qi} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:bg,border:`1px solid ${border}`,borderRadius:6}}>
                          <div style={{minWidth:42,fontSize:11,fontWeight:800,color:T.goldDeep,textAlign:"center"}}>{q.num}번</div>
                          {ansEditMode ? (
                            <>
                              <select value={q.type} onChange={e=>updateT(q.num, e.target.value)} style={{padding:"2px 6px",fontSize:11,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"inherit",background:T.white}}>
                                <option value="obj">객관식</option>
                                <option value="sub">주관식</option>
                              </select>
                              <input value={q.ans||""} onChange={e=>updateA(q.num, e.target.value)} placeholder={isObj?"예: 3":"정답 입력"} style={{flex:1,padding:"3px 8px",fontSize:12,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"inherit"}}/>
                            </>
                          ) : (
                            <>
                              <span style={{fontSize:9,padding:"1px 5px",borderRadius:6,background:isObj?T.goldDark:T.blue,color:T.white,fontWeight:700,whiteSpace:"nowrap"}}>{isObj?"🅰 객":"✍️ 주"}</span>
                              <div style={{flex:1,fontSize:isObj?14:12,fontWeight:isObj?800:600,color:isObj?T.goldDeep:T.text,wordBreak:"break-word"}}>{q.ans?String(q.ans):<span style={{color:T.danger}}>(빈칸)</span>}</div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* 편집 모드: 문항 추가/감소 */}
                  {ansEditMode && (
                    <div style={{marginTop:10,padding:"8px 10px",background:T.bg,borderRadius:6,display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:11,color:T.textSub,fontWeight:600}}>총 문항 수:</span>
                      <input type="number" min="1" max="200" value={ansEditData.totalQ} onChange={e=>setAnsEditData(p=>({...p, totalQ:Math.max(1,parseInt(e.target.value)||1)}))} style={{width:80,padding:"3px 6px",fontSize:12,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"inherit"}}/>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {/* 액션 버튼 영역 */}
          {!ansModalLoading && !ansModalData.err && ansModalData.totalQ > 0 && (
            <div style={{padding:"10px 14px",borderTop:`1px solid ${T.border}`,background:T.bg,display:"flex",gap:6,flexWrap:"wrap"}}>
              {!ansEditMode ? (
                <>
                  <button onClick={startAnsEdit} style={{...S.btnG,flex:"1 1 30%",fontSize:12,padding:"8px 12px",background:T.goldDark}} title="정답을 수정하면 학생앱도 즉시 새 기준으로 채점됩니다">✏️ 편집 (자동 재채점)</button>
                  <button onClick={deleteAnsRow} style={{flex:"1 1 30%",fontSize:12,padding:"8px 12px",borderRadius:8,border:`1.5px solid ${T.danger}`,background:T.white,color:T.danger,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}} title="이 시험의 확정 답안 데이터를 삭제 (중복 등록 시 사용)">🗑 답안 삭제</button>
                  <button onClick={()=>setAnsModalOpen(false)} style={{flex:"1 1 30%",fontSize:12,padding:"8px 12px",borderRadius:8,border:`1.5px solid ${T.border}`,background:T.white,color:T.textSub,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>닫기</button>
                </>
              ) : (
                <>
                  <button disabled={ansEditSaving} onClick={saveAnsEdit} style={{...S.btnG,flex:"1 1 50%",fontSize:12,padding:"8px 12px",background:ansEditSaving?T.borderLight:T.accent,cursor:ansEditSaving?"wait":"pointer"}}>{ansEditSaving?"저장 중...":"💾 저장"}</button>
                  <button onClick={()=>setAnsEditMode(false)} style={{flex:"1 1 30%",fontSize:12,padding:"8px 12px",borderRadius:8,border:`1.5px solid ${T.border}`,background:T.white,color:T.textSub,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )}
    {/* 날짜 선택 + 새로고침 */}
    <div style={{...S.card,padding:"12px 14px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:700,color:T.textSub}}>📅 날짜</span>
        <input type="date" value={dashDate} onChange={e=>setDashDate(e.target.value||todayIsoStr())} style={{padding:"6px 10px",fontSize:13,border:`1.5px solid ${T.border}`,borderRadius:8,fontFamily:"inherit",background:T.white,color:T.text}}/>
        <button onClick={()=>setDashDate(todayIsoStr())} style={{padding:"6px 12px",fontSize:11,fontWeight:700,borderRadius:8,border:`1.5px solid ${isDashToday?T.goldDark:T.border}`,background:isDashToday?T.goldLight:T.white,color:isDashToday?T.goldDeep:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>오늘</button>
        <button onClick={()=>{const d=new Date(dashDate);d.setDate(d.getDate()-1);setDashDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);}} style={{padding:"6px 10px",fontSize:11,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.border}`,background:T.white,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>← 이전</button>
        <button onClick={()=>{const d=new Date(dashDate);d.setDate(d.getDate()+1);setDashDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);}} style={{padding:"6px 10px",fontSize:11,fontWeight:600,borderRadius:8,border:`1.5px solid ${T.border}`,background:T.white,color:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>다음 →</button>
        <button onClick={()=>loadDashboard()} style={{...S.btnO,padding:"6px 12px",fontSize:11,marginLeft:"auto"}}>🔄 새로고침</button>
        {/* ★ v23.1: 파일 일괄 다운로드 (오늘의 모든 시험지/답지) */}
        <button onClick={()=>batchDownloadAllFiles(dashData?.exams||[])} disabled={batchDlRunning||!dashData||(dashData?.exams||[]).length===0} style={{padding:"6px 12px",fontSize:11,fontWeight:700,borderRadius:8,border:`1.5px solid ${T.blue}`,background:batchDlRunning?T.borderLight:T.blueLight,color:T.blue,cursor:batchDlRunning?"wait":"pointer",fontFamily:"inherit"}}>
          {batchDlRunning?`📦 ${batchDlProgress.done}/${batchDlProgress.total}`:"📦 파일 일괄 다운"}
        </button>
      </div>
      {batchDlRunning&&batchDlProgress.current&&(
        <div style={{marginTop:8,padding:"6px 10px",background:T.blueLight,borderRadius:6,fontSize:11,color:T.blue,fontWeight:600}}>
          ⬇ {batchDlProgress.current} ({batchDlProgress.done+1}/{batchDlProgress.total})
        </div>
      )}
    </div>
    {/* ★ v23.0: 스케줄 vs 실제 업로드 비교 섹션 제거 — DB 연결 후 재구현 */}
    {dashLoading&&<div style={{textAlign:"center",padding:40,color:T.textMuted}}>불러오는 중...</div>}
    {dashErr&&<div style={{padding:14,background:T.dangerLight,borderRadius:10,color:T.danger,fontSize:13,fontWeight:600,textAlign:"center"}}>{dashErr}</div>}
    {dashData&&!dashLoading&&(()=>{
      // ★ v23.0: 시안 3 — 표 + 진행도 바 (같은 시간끼리 묶기)
      const allExams = dashData.exams||[];
      const expTot = dashData.expectedTotal||dashData.summary?.totalExpected||0;
      const subTot = dashData.submissionTotal||dashData.summary?.totalSubmitted||0;
      const submitPct = expTot>0 ? Math.round(subTot/expTot*100) : 0;
      const fileMissing = allExams.filter(e=>!e.hasExamFile).length;
      // 시간별 그룹핑 (같은 HH:MM 은 한 줄에)
      const timeGroups = {};
      allExams.forEach(ex=>{
        const tRaw = String(ex.examTime||"").trim();
        const tKey = /^\d{1,2}:\d{2}$/.test(tRaw) ? tRaw.padStart(5,"0") : "미정";
        if(!timeGroups[tKey]) timeGroups[tKey] = [];
        timeGroups[tKey].push(ex);
      });
      const timeKeys = Object.keys(timeGroups).sort((a,b)=>{
        if(a==="미정") return 1; if(b==="미정") return -1;
        return a.localeCompare(b);
      });
      // 작은 KPI 카드 헬퍼
      const kpi = (label, value, color, sub)=>(
        <div style={{padding:"12px 14px",background:T.goldPale,borderRadius:8,textAlign:"center",borderBottom:`3px solid ${color||T.goldDark}`}}>
          <div style={{fontSize:22,fontWeight:800,color:color||T.goldDark,lineHeight:1}}>{value}</div>
          <div style={{fontSize:11,color:T.textSub,marginTop:4,fontWeight:600}}>{label}</div>
          {sub&&<div style={{fontSize:10,color:T.textMuted,marginTop:2}}>{sub}</div>}
        </div>
      );
      return(<>
        {/* ── 4개 KPI 바 (★ v23.2: 검수 대기 제거 — 배너로만 노출) ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
          {kpi("📋 등록 시험", allExams.length, T.goldDark)}
          {kpi("👥 예상 응시", expTot, T.blue)}
          {kpi("✅ 제출 완료", subTot, T.accent)}
          {kpi("📊 제출률", submitPct+"%", T.goldDark)}
        </div>
        {/* ── 보조 알림 ── */}
        {(expTot>0||fileMissing>0)&&(
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            {expTot>0&&(
              <div style={{flex:"1 1 240px",padding:"10px 14px",borderRadius:10,background:T.blueLight,border:`1px solid ${T.blue}30`,fontSize:12,color:T.blue,fontWeight:600}}>
                🖨️ 오늘 시험지 <b>{expTot}장</b> 필요 (실장님 프린트 참고)
              </div>
            )}
            {fileMissing>0&&(
              <div style={{flex:"1 1 240px",padding:"10px 14px",borderRadius:10,background:T.dangerLight,border:`1px solid ${T.danger}40`,fontSize:12,color:T.danger,fontWeight:600}}>
                ⚠️ 시험지 미업로드 <b>{fileMissing}건</b> — 표에서 확인하세요
              </div>
            )}
          </div>
        )}
        {/* ── 시간별 표 ── */}
        {allExams.length===0?(
          <div style={{padding:24,background:T.borderLight,borderRadius:10,color:T.textMuted,fontSize:13,textAlign:"center"}}>오늘 등록된 시험이 없습니다.</div>
        ):(
          <div style={{background:T.white,borderRadius:12,overflow:"hidden",border:`1.5px solid ${T.goldMuted}`}}>
            {/* 표 헤더 */}
            <div style={{display:"flex",alignItems:"center",padding:"10px 14px",background:T.goldDark,color:T.white,fontSize:12,fontWeight:700,gap:10}}>
              <div style={{width:70,flexShrink:0}}>🕐 시간</div>
              <div style={{flex:1}}>📋 시험 (같은 시간 = 같은 줄)</div>
              <div style={{width:70,textAlign:"right",fontSize:11,opacity:.9}}>{timeKeys.length}개 시간대</div>
            </div>
            {/* 시간 행들 */}
            {timeKeys.map((time, ti)=>{
              const exams = timeGroups[time].slice().sort((a,b)=>{
                const sa = (a.subject||"")+(a.grade||"")+(a.teacher||"");
                const sb = (b.subject||"")+(b.grade||"")+(b.teacher||"");
                return sa.localeCompare(sb);
              });
              const rowExp = exams.reduce((s,e)=>s+(e.studentCount||0),0);
              const rowSub = exams.reduce((s,e)=>s+(e.submitted||0),0);
              return (
                <div key={time} style={{display:"flex",alignItems:"stretch",borderTop:ti===0?"none":`1px solid ${T.borderLight}`,background:ti%2?T.goldPale:T.white}}>
                  {/* 시간 라벨 */}
                  <div style={{width:70,flexShrink:0,padding:"12px 10px",background:T.goldLight,borderRight:`1px solid ${T.goldMuted}`,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",fontSize:14,fontWeight:800,color:T.goldDeep}}>
                    <div style={{fontSize:time==="미정"?12:15}}>{time==="미정"?"⏰ 미정":time}</div>
                    <div style={{fontSize:9,color:T.textMuted,marginTop:4,fontWeight:500,textAlign:"center"}}>{exams.length}개{rowExp>0?` · ${rowSub}/${rowExp}`:""}</div>
                  </div>
                  {/* 시험 카드들 (같은 시간 = 가로 펼침) */}
                  <div style={{flex:1,padding:"10px",display:"flex",flexWrap:"wrap",gap:8}}>
                    {exams.map((ex,i)=>{
                      const subjEmoji = ex.subject==="영어"?"🇬🇧":ex.subject==="수학"?"🔢":ex.subject==="국어"?"📖":ex.subject==="과학"?"🔬":ex.subject==="사회"?"🌏":"📚";
                      const lvLabel = ex.level?(ex.level==="전체"?"전체":ex.level+"반"):"";
                      const expected = ex.studentCount||0;
                      const submitted = ex.submitted||0;
                      const pct = expected>0?Math.min(100,(submitted/expected)*100):0;
                      const isDone = expected>0 && submitted>=expected;
                      const fkey = `${time}_${i}`;
                      const isOpen = !!openFiles[fkey];
                      const hasExam = !!ex.hasExamFile;
                      const hasAns = !!ex.hasAnswerFile;
                      const filesArr = ex.files||[];
                      // 파일 상태 색상
                      const fileBadge = hasExam&&hasAns?{txt:"📎 완료",bg:T.accentLight,c:T.accent}
                        :hasExam||hasAns?{txt:hasAns?"🔑 답지만":"📄 시험지만",bg:T.goldLight,c:T.goldDark}
                        :{txt:"⚠️ 파일 없음",bg:T.dangerLight,c:T.danger};
                      return(
                        <div key={i} style={{flex:"1 1 280px",minWidth:260,maxWidth:380,background:T.white,border:`1.5px solid ${isDone?T.accent+"60":T.border}`,borderRadius:8,padding:"10px 12px",position:"relative"}}>
                          {/* 헤더: 과목·학년·반 + 선생님 */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:800,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                {subjEmoji} {ex.subject||""} {ex.grade||""} {lvLabel}
                              </div>
                              <div style={{fontSize:11,color:T.textSub,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                {ex.examType||""}{ex.round?` · ${ex.round}`:""}
                              </div>
                            </div>
                            <span style={{padding:"2px 7px",fontSize:10,fontWeight:700,background:T.blueLight,color:T.blue,borderRadius:10,whiteSpace:"nowrap"}}>👤 {ex.teacher||"-"}</span>
                          </div>
                          {/* 메모 */}
                          {ex.memo&&(
                            <div style={{fontSize:10,color:T.goldDeep,background:T.goldPale,borderLeft:`2px solid ${T.goldDark}`,padding:"4px 7px",borderRadius:3,marginBottom:6,lineHeight:1.4}}>💬 {ex.memo}</div>
                          )}
                          {/* 진행도 바 + 제출 수 */}
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                            <div style={{flex:1,height:6,background:T.borderLight,borderRadius:3,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${pct}%`,background:isDone?T.accent:expected>0?T.gold:T.borderLight,transition:"width .3s"}}/>
                            </div>
                            <div style={{fontSize:11,fontWeight:700,color:isDone?T.accent:expected>0?T.goldDark:T.textMuted,whiteSpace:"nowrap",minWidth:48,textAlign:"right"}}>
                              {expected>0?`${submitted}/${expected}`:"-"}
                            </div>
                          </div>
                          {/* 메타 칩 */}
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",fontSize:10,marginBottom:5,alignItems:"center"}}>
                            <span style={{padding:"2px 6px",borderRadius:8,background:T.bg,color:T.textSub,fontWeight:600}}>📝 {ex.totalQuestions||0}문항</span>
                            <span style={{padding:"2px 6px",borderRadius:8,background:fileBadge.bg,color:fileBadge.c,fontWeight:700}}>{fileBadge.txt}</span>
                            {/* ★ v23.1: 정답 보기 버튼 */}
                            <button onClick={()=>openAnswerModal({...ex, date:dashDate})} style={{marginLeft:"auto",padding:"3px 8px",fontSize:10,fontWeight:700,borderRadius:8,border:`1px solid ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer",fontFamily:"inherit"}} title="등록된 정답 확인 (관리자/선생님 검토용)">🔑 정답 보기</button>
                            {/* ★ v23.7: 시험 전체 취소 — 정답목록 행 삭제 → 학생앱에서 즉시 사라짐 */}
                            <button onClick={()=>cancelDashExam(ex)} style={{padding:"3px 8px",fontSize:10,fontWeight:700,borderRadius:8,border:`1px solid ${T.danger}`,background:T.white,color:T.danger,cursor:"pointer",fontFamily:"inherit"}} title="시험 취소 — 학생앱에서 이 시험을 즉시 숨김 (잘못 등록한 경우)">🚫 시험 취소</button>
                          </div>
                          {/* 첨부 파일 (펼침) */}
                          {filesArr.length>0&&(
                            <div style={{borderTop:`1px dashed ${T.border}`,paddingTop:5,marginTop:5}}>
                              <button onClick={()=>toggleFiles(fkey)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:10,fontWeight:700,color:T.textSub,background:"none",border:"none",cursor:"pointer",padding:"2px 0",fontFamily:"inherit",width:"100%"}}>
                                <span>📎 첨부 {filesArr.length}개</span>
                                <span style={{color:T.goldDark}}>{isOpen?"▲":"▼"}</span>
                              </button>
                              {isOpen&&(
                                <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:4}}>
                                  {filesArr.map((fl,fi)=>(
                                    <div key={fi} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 6px",background:T.bg,borderRadius:5,fontSize:10}}>
                                      <span>{fl.kind==="answer"?"🔑":"📄"}</span>
                                      <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                                        <div style={{fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fl.name}</div>
                                      </div>
                                      <button onClick={()=>proxyDownload(fl.id,fl.name)} style={{padding:"2px 6px",fontSize:9,fontWeight:700,background:T.goldDark,color:T.white,borderRadius:4,border:"none",cursor:"pointer",fontFamily:"inherit"}} title="다운로드">⬇</button>
                                      <button onClick={()=>proxyPreview(fl.id,fl.name)} style={{padding:"2px 6px",fontSize:9,fontWeight:700,background:T.white,color:T.blue,border:`1px solid ${T.blue}`,borderRadius:4,cursor:"pointer",fontFamily:"inherit"}} title="미리보기">👁</button>
                                      {/* ★ v23.7: 잘못 올린 파일 삭제 — 2차 확인 후 휴지통 이동 */}
                                      <button onClick={()=>deleteDashFile(fl, `${ex.subject||""} ${ex.grade||""} ${ex.level||""}반 · ${ex.examType||""}`)} style={{padding:"2px 6px",fontSize:9,fontWeight:700,background:T.white,color:T.danger,border:`1px solid ${T.danger}`,borderRadius:4,cursor:"pointer",fontFamily:"inherit"}} title="이 파일 삭제 (휴지통 이동)">🗑</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
  // ★ v23.2: 시험 종류 자동 "시험" — UI에서 선택 제거됨 (CONE 연동 후 재도입 예정)
  const[examType,setExamType]=useState("시험");
  // ★ v22.7: 주관식 채점 모드 (loose=해석/번역, strict=단답형)
  const[gradingMode,setGradingMode]=useState("strict");
  const[gradingModeAuto,setGradingModeAuto]=useState(true); // 자동 추천 상태 (선생님이 수동 변경 시 false)
  // examType 변경 시 자동 추천 — "해석/번역/독해" 키워드 감지
  useEffect(()=>{
    if(!gradingModeAuto)return; // 선생님이 수동 변경한 경우 자동 추천 비활성화
    const looseKeywords=["해석","번역","독해","translation","interpretation"];
    const isLoose=looseKeywords.some(k=>(examType||"").toLowerCase().includes(k.toLowerCase()));
    setGradingMode(isLoose?"loose":"strict");
  },[examType,gradingModeAuto]);
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
    {label:"",examFiles:[],answerFiles:[],totalQ:30,startNum:1,endNum:30},
  ]);
  const updateRound=(i,key,val)=>setRounds(p=>{
    const n=[...p];n[i]={...n[i],[key]:val};
    // ★ v17: totalQ/startNum/endNum 자동 동기화 (startNum + totalQ - 1 = endNum)
    if(key==="totalQ"){const t=Math.max(1,parseInt(val)||1);const s=Math.max(1,parseInt(n[i].startNum)||1);n[i].totalQ=t;n[i].endNum=s+t-1;}
    if(key==="startNum"){const s=Math.max(1,parseInt(val)||1);const t=Math.max(1,parseInt(n[i].totalQ)||1);n[i].startNum=s;n[i].endNum=s+t-1;}
    if(key==="endNum"){const e=Math.max(1,parseInt(val)||1);const s=Math.max(1,parseInt(n[i].startNum)||1);n[i].endNum=Math.max(s,e);n[i].totalQ=n[i].endNum-s+1;}
    return n;
  });
  // ★ 반별 업로드 그룹 (다른 시험지일 때)
  const[classRounds,setClassRounds]=useState({});
  const initClassRounds=(clsList)=>{const m={};clsList.forEach(c=>{if(!m[c.name])m[c.name]=[{label:"",examFiles:[],answerFiles:[],totalQ:30,startNum:1,endNum:30}];});setClassRounds(m);};
  const updateClassRound=(clsName,i,key,val)=>setClassRounds(p=>{
    const arr=[...(p[clsName]||[])];arr[i]={...arr[i],[key]:val};
    // ★ v17: totalQ/startNum/endNum 자동 동기화 (rounds와 동일 로직)
    if(key==="totalQ"){const t=Math.max(1,parseInt(val)||1);const s=Math.max(1,parseInt(arr[i].startNum)||1);arr[i].totalQ=t;arr[i].endNum=s+t-1;}
    if(key==="startNum"){const s=Math.max(1,parseInt(val)||1);const t=Math.max(1,parseInt(arr[i].totalQ)||1);arr[i].startNum=s;arr[i].endNum=s+t-1;}
    if(key==="endNum"){const e=Math.max(1,parseInt(val)||1);const s=Math.max(1,parseInt(arr[i].startNum)||1);arr[i].endNum=Math.max(s,e);arr[i].totalQ=arr[i].endNum-s+1;}
    return{...p,[clsName]:arr};
  });
  const[memo,setMemo]=useState("");
  // v21.2: 업로드 모드는 AI가 객관식·주관식을 자동 판별 → state 는 호환성용으로만 유지
  // (수동입력은 직접입력 화면에서 문항별 객/주 토글 사용)
  const[subjMode,setSubjMode]=useState("auto"); // auto | direct (직접입력 시)
  const[subjRanges,setSubjRanges]=useState("");
  const[objRanges,setObjRanges]=useState("");
  // 상태
  const[saving,setSaving]=useState(false);const[done,setDone]=useState(false);const[error,setError]=useState("");
  // [v21.0] AI 답지 자동 검수 상태
  const[aiRunning,setAiRunning]=useState(false);
  const[aiResults,setAiResults]=useState([]); // [{label, unanimous, mismatchCount, rowIndex, error}]
  const[aiTasks,setAiTasks]=useState([]); // ★ v21.6: 원본 task 보관 (재검수 버튼용)
  // v21.3: AI 검수 호출 — Vercel Edge Function 우선, 실패 시 GAS 폴백
  // 1) Vercel /api/ai-extract 로 PDF 보내서 3개 AI 응답 받기 (GAS 데이터 한도 우회)
  // 2) 받은 응답을 GAS 로 보내 검수/저장 (action=ai_extract_answers + aiResults)
  // 3) Vercel 호출 실패 시 → 기존 GAS 직접 호출 방식으로 폴백
  const callAiExtract = async (answerFile, examInfo) => {
    if(!answerFile) return null;
    try {
      const base64 = await fileToBase64(answerFile);
      // ── 1단계: Vercel 에서 AI 추출 ──
      let aiResults = null;
      let usedVercel = false;
      if (AI_EXTRACT_URL) {
        try {
          const vRes = await fetch(AI_EXTRACT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pdfBase64: base64,
              examInfo: {
                subject: examInfo.subject || "",
                grade: examInfo.grade || "",
                level: examInfo.level || "",
                examType: examInfo.examType || "",
                totalQuestions: examInfo.totalQuestions || examInfo.totalQ || 0,
                // ★ v22.7: 채점 모드 전달 (loose=해석/번역 — AI가 한국어 해석만 추출)
                gradingMode: examInfo.gradingMode || ""
              }
            })
          });
          if (vRes.ok) {
            const vJson = await vRes.json();
            if (vJson && vJson.ok && vJson.results) {
              aiResults = vJson.results;
              usedVercel = true;
            }
          }
        } catch(vErr) {
          // Vercel 실패 — GAS 폴백
          console.warn("[AI] Vercel 호출 실패, GAS 폴백:", vErr);
        }
      }
      // ── 2단계: GAS 로 결과 저장 ──
      const gasBody = usedVercel
        ? { action: "ai_extract_answers", aiResults, ...examInfo }
        : { action: "ai_extract_answers", answerFileBase64: base64, ...examInfo };
      const res = await fetch(SHEETS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(gasBody)
      });
      const data = await res.json();
      if (data && data.result === "success") data._aiSource = usedVercel ? "vercel" : "gas";
      return data;
    } catch(e) {
      return { result: "error", message: String(e) };
    }
  };
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
    setClassRounds(p=>({...p,[name]:[{label:"",examFiles:[],answerFiles:[],totalQ:30,startNum:1,endNum:30}]}));
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
          body:JSON.stringify({action:"save_answer_key",subject:cls.subject,grade:cls.grade,level:cls.level,examType,setType:"",round:"",totalQuestions:qc,answers:answersObj,types:typesObj,teacher,studentCount:cls.count,date:dateStr,className:cls.name,startNumber:startNum,gradingMode})});
      }
      // 2) 파일(시험지/정답지)이 있으면 Drive에도 업로드 — 반별 개별 업로드
      if(examFiles.length>0||answerFiles.length>0){
        const aData=await Promise.all(answerFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
        const eData=await Promise.all(examFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
        for(const cls of classes){
          await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({action:"upload_exam",classes:[{subject:cls.subject,grade:cls.grade,level:cls.level,count:cls.count}],classNames:cls.name,examType,setType:"",round:"",date:dateStr,memo:"(직접 입력 모드 · 시험지/정답지 업로드)",teacher,studentCount:cls.count,subjMode:"direct",subjRanges:"",objRanges:"",answerFiles:aData,examFiles:eData,gradingMode})});
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
      // 파일명 휴리스틱
      for(const rd of active){
        const suspAns=rd.answerFiles.find(f=>/(시험지|문제지|problem|question|quiz)/i.test(f.name)&&!/(정답|답지|답안|해설|풀이|answer|solution|key)/i.test(f.name));
        if(suspAns){if(!confirm(`⚠️ 정답지로 올린 파일 "${suspAns.name}"이 시험지처럼 보입니다.\n시험지·답지를 바꿔 올리신 건 아닌가요?\n그대로 진행하시겠습니까?`))return;}
        const suspExam=rd.examFiles.find(f=>/(정답|답지|답안|해설|풀이|answer|solution|key)/i.test(f.name));
        if(suspExam){if(!confirm(`⚠️ 시험지로 올린 파일 "${suspExam.name}"이 답지처럼 보입니다.\n시험지·답지를 바꿔 올리신 건 아닌가요?\n그대로 진행하시겠습니까?`))return;}
      }
      setSaving(true);setError("");
      try{
        const aiTasks=[]; // [v21.0] AI 검수 호출용 (반×round)
        for(const rd of active){
          const aData=await Promise.all(rd.answerFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
          const eData=await Promise.all(rd.examFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
          for(const cls of classes){
            await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({action:"upload_exam",classes:[{subject:cls.subject,grade:cls.grade,level:cls.level,count:cls.count}],classNames:cls.name,examType,setType:rd.label||"",round:rd.label||"",date:dateStr,memo,teacher,studentCount:cls.count,subjMode,subjRanges,objRanges,answerFiles:aData,examFiles:eData,totalQuestions:0,startNumber:0,endNumber:0,gradingMode})});
            // [v21.0] AI 검수 task 등록 (첫 답지 1개 사용)
            if(rd.answerFiles[0]){
              aiTasks.push({
                file: rd.answerFiles[0],
                examInfo: { subject:cls.subject, grade:cls.grade, level:cls.level, examType, teacher, setType:rd.label||"", totalQuestions:0, subjMode, subjRanges, date:dateStr, className:cls.name, studentCount:cls.count, startNumber:0, gradingMode },
                label: `${cls.name}${rd.label?" ("+rd.label+")":""}`
              });
            }
          }
        }
        setDone(true);setScreen("done");
        // [v21.0] AI 자동 검수 — done 화면 표시 후 백그라운드 실행
        if(aiTasks.length>0) runAiExtractTasks(aiTasks);
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
      setSaving(true);setError("");
      try{
        const aiTasks=[];
        for(const cls of classes){
          const cRds=(classRounds[cls.name]||[]).filter(r=>r.answerFiles.length>0||r.examFiles.length>0);
          for(const rd of cRds){
            const aData=await Promise.all(rd.answerFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
            const eData=await Promise.all(rd.examFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
            await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({action:"upload_exam",classes:[{subject:cls.subject,grade:cls.grade,level:cls.level,count:cls.count}],classNames:cls.name,examType,setType:rd.label||"",round:rd.label||"",date:dateStr,memo,teacher,studentCount:cls.count,subjMode,subjRanges,objRanges,answerFiles:aData,examFiles:eData,totalQuestions:0,startNumber:0,endNumber:0,gradingMode})});
            if(rd.answerFiles[0]){
              aiTasks.push({
                file: rd.answerFiles[0],
                examInfo: { subject:cls.subject, grade:cls.grade, level:cls.level, examType, teacher, setType:rd.label||"", totalQuestions:0, subjMode, subjRanges, date:dateStr, className:cls.name, studentCount:cls.count, startNumber:0, gradingMode },
                label: `${cls.name}${rd.label?" ("+rd.label+")":""}`
              });
            }
          }
        }
        setDone(true);setScreen("done");
        if(aiTasks.length>0) runAiExtractTasks(aiTasks);
      }catch(e){setError("업로드 실패. 다시 시도해주세요.");}
      setSaving(false);
    }
  };
  // [v21.0] AI 검수 task 일괄 실행 (병렬 호출)
  // ★ v21.5: Gemini 분당 15회 한도(429) 방지 — 2개씩 묶어 호출 + 청크 간 4초 대기
  // ★ v21.6: 원본 tasks 보관 — 재검수 버튼이 동일 file/examInfo로 다시 호출
  const runAiExtractTasks = async (tasks) => {
    setAiTasks(tasks); // 원본 보관 (재검수용)
    setAiRunning(true);
    setAiResults(tasks.map(t=>({label:t.label, status:"pending"})));
    const CHUNK=2; // 4 → 2 로 감소 (Gemini rate limit 여유)
    const allResults=[];
    for(let i=0; i<tasks.length; i+=CHUNK){
      // 첫 청크 아니면 청크 사이 4초 대기 — 분당 한도 회복 시간
      if(i>0) await new Promise(r=>setTimeout(r,4000));
      const chunk = tasks.slice(i, i+CHUNK);
      const chunkResults = await Promise.all(chunk.map(async (t,idx)=>{
        const r = await callAiExtract(t.file, t.examInfo);
        if(!r) return {label:t.label, status:"error", error:"호출 실패"};
        if(r.result==="success") return {label:t.label, status:r.unanimous?"ok":"mismatch", unanimous:r.unanimous, mismatchCount:r.mismatchCount, rowIndex:r.rowIndex};
        return {label:t.label, status:"error", error:r.message||"알 수 없음"};
      }));
      allResults.push(...chunkResults);
      setAiResults(prev=>{
        const next=[...prev];
        chunkResults.forEach((cr,k)=>{ next[i+k]=cr; });
        return next;
      });
    }
    setAiRunning(false);
  };
  // ★ v21.6: 단일 task 재검수 — error/mismatch 행에서 호출
  // 같은 PDF로 Gemini+Claude 다시 돌려서 정답 재추출.
  // 이전 PENDING 행이 시트에 남아있어도 새 행이 추가되어 최신 결과로 덮어씀.
  const retryAiTask = async (idx) => {
    const t = aiTasks[idx];
    if(!t || !t.file){
      alert("재검수할 답지 정보가 사라졌습니다.\n페이지 새로고침 후 \"검수 대기\" 카드에서 \"🔄 불일치 재요청\" 버튼을 사용하세요.");
      return;
    }
    // 해당 항목만 pending 으로 표시 (다른 항목은 그대로)
    setAiResults(prev=>{
      const next=[...prev];
      next[idx]={label:t.label, status:"pending"};
      return next;
    });
    setAiRunning(true);
    try{
      const r = await callAiExtract(t.file, t.examInfo);
      setAiResults(prev=>{
        const next=[...prev];
        if(!r){
          next[idx]={label:t.label, status:"error", error:"호출 실패"};
        }else if(r.result==="success"){
          next[idx]={
            label:t.label,
            status:r.unanimous?"ok":"mismatch",
            unanimous:r.unanimous,
            mismatchCount:r.mismatchCount,
            rowIndex:r.rowIndex
          };
        }else{
          next[idx]={label:t.label, status:"error", error:r.message||"알 수 없음"};
        }
        return next;
      });
    }catch(e){
      setAiResults(prev=>{
        const next=[...prev];
        next[idx]={label:t.label, status:"error", error:String(e)};
        return next;
      });
    }
    setAiRunning(false);
  };
  // 대시보드 조회
  // 프록시 다운로드 — Apps Script가 base64로 파일을 서빙 → blob으로 변환해서 저장
  // 다른 구글 계정(권한 없는 선생님)도 다운 가능
  // ★ v22.9: 큰 파일은 GAS가 mode:"url" 로 응답 → Drive 직접 링크 사용
  const fetchFileMeta=async(fileId)=>{
    let res, d;
    try {
      res = await fetch(`${SHEETS_URL}?action=download_file&id=${encodeURIComponent(fileId)}`);
    } catch(eFetch) {
      throw new Error("네트워크 오류: "+String(eFetch));
    }
    const ct = res.headers.get("content-type")||"";
    if (!ct.includes("json")) {
      // GAS가 HTML(로그인/오류 페이지) 반환한 경우
      throw new Error("GAS 응답 형식 오류 (HTML 반환). 배포된 Web App URL을 확인하세요.");
    }
    try { d = await res.json(); }
    catch(eJson) { throw new Error("JSON 파싱 실패: "+String(eJson)); }
    if(d.result!=="ok") throw new Error(d.message||"파일 접근 실패");
    return d;
  };
  const fetchFileBlob=async(fileId)=>{
    const d = await fetchFileMeta(fileId);
    if (d.mode === "url") {
      // 큰 파일 — Drive 직접 링크 (blob 변환 불가, 호출자가 url 처리해야 함)
      return {url: d.downloadUrl, viewUrl: d.viewUrl, mimeType: d.mimeType||"", name: d.name||"", mode:"url"};
    }
    const bin=atob(d.data);const u8=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
    const blob=new Blob([u8],{type:d.mimeType||"application/octet-stream"});
    return{blob,mimeType:d.mimeType||"",name:d.name||"",mode:"base64"};
  };
  // 다운로드 (구글 계정 없이도 가능 — Apps Script 프록시)
  const proxyDownload=async(fileId,fileName)=>{
    try{
      const r = await fetchFileBlob(fileId);
      if (r.mode === "url") {
        // 큰 파일 — Drive 직접 다운로드 URL을 새 탭에서 열기
        window.open(r.url, "_blank");
        return;
      }
      const url=URL.createObjectURL(r.blob);
      const a=document.createElement("a");a.href=url;a.download=fileName||r.name||"download";
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(err){
      console.error("[proxyDownload]", err);
      // ★ v23.0: Drive 직접 링크 fallback 제거 — 권한 없는 사용자에게 빨간 X 페이지 보여주는 원인
      alert("다운로드 실패\n\n" + (err.message||err) + "\n\n파일이 매우 크면 관리자에게 문의해 주세요.");
    }
  };
  // 미리보기 (구글 계정 없이도 가능 — Blob URL로 새 탭 열기)
  const proxyPreview=async(fileId,fileName)=>{
    try{
      const r = await fetchFileBlob(fileId);
      if (r.mode === "url") {
        // 큰 파일 — Drive 보기 URL을 새 탭에서 열기
        window.open(r.viewUrl || `https://drive.google.com/file/d/${fileId}/view`, "_blank");
        return;
      }
      // PDF·이미지는 브라우저에서 바로 표시
      const previewable=["application/pdf","image/png","image/jpeg","image/gif","image/webp"];
      const url=URL.createObjectURL(r.blob);
      if(previewable.includes(r.mimeType)){
        const w=window.open("","_blank");
        if(w){
          if(r.mimeType==="application/pdf"){
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
    }catch(err){
      console.error("[proxyPreview]", err);
      // ★ v23.0: Drive 직접 링크 fallback 제거 — 권한 없는 사용자에게 빨간 X 페이지 보여주는 원인
      alert("미리보기 실패\n\n" + (err.message||err) + "\n\n파일이 매우 크면 관리자에게 문의해 주세요.");
    }
  };
  // (loadDashboard, schStatus, 대시보드 useEffect는 DashboardTab 컴포넌트 내부로 이동됨)
  const reset=()=>{setScreen("home");setTs("");setTg("");setTl("");setTcl("");setTlCat("level");setTlMulti([]);setTcount("");setClasses([]);setExamType("시험");setExamFiles([]);setAnswerFiles([]);setRounds([{label:"",examFiles:[],answerFiles:[],totalQ:30,startNum:1,endNum:30}]);setSameExam(true);setClassRounds({});setMemo("");setAnswers([]);setTypes([]);setSubAns({});setDone(false);setError("");setTotalQ(50);setCustomQ("");setStartNum(1);setSubjMode("auto");setSubjRanges("");setObjRanges("");setAiResults([]);setAiRunning(false);setAiTasks([]);setGradingMode("strict");setGradingModeAuto(true);
    const d=new Date();setExamDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);setExamTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`);};
  // ★ v23.4: 탭 메타 정보 (사이드바 + 모바일 하단탭 공유)
  const _navTabs = [
    {k:"register",  label:"시험 등록",   icon:"📋", section:"main"},
    {k:"dashboard", label:"오늘의 현황", icon:"📊", section:"main"},
    {k:"stats",     label:"반별 성적",   icon:"📈", section:"main"},
    {k:"generator", label:"문제 생성",   icon:"📚", section:"tools"},
    {k:"teachers",  label:"선생님 관리", icon:"👥", section:"tools"}
  ];
  return(
    <div style={S.app} className="app-shell">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:'Noto Sans KR',-apple-system,sans-serif;background:${T.bg}}
input:focus,textarea:focus{outline:none;border-color:${T.gold}!important;box-shadow:0 0 0 3px ${T.goldLight}!important}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
.fade-up{animation:fadeUp .3s ease-out}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:${T.gold}}

/* ★ v23.4: 반응형 — 데스크탑은 사이드바, 모바일/태블릿은 하단탭 */
.app-shell{display:flex;min-height:100vh;max-width:1400px;margin:0 auto;background:${T.bg}}
.main-content{flex:1;min-width:0;padding-bottom:0}

/* ── 사이드바 (데스크탑 전용 ≥ 769px) ── */
.sidebar{width:228px;background:linear-gradient(180deg,${T.goldDeep} 0%,${T.goldDark} 100%);padding:22px 14px;color:#fff;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;display:flex;flex-direction:column}
.sb-logo-row{display:flex;align-items:center;gap:10px;margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,.18)}
.sb-logo-icon{width:38px;height:38px;border-radius:10px;background:#fff;color:${T.goldDark};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0;letter-spacing:-0.5px}
.sb-brand{font-size:14px;font-weight:800;line-height:1.2}
.sb-brand .sub{font-size:10px;opacity:.8;font-weight:500;display:block;margin-top:2px}
.sb-section{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:rgba(255,255,255,.55);margin:14px 0 6px;padding:0 8px}
.sb-item{padding:10px 12px;display:flex;align-items:center;gap:10px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;margin-bottom:3px;color:rgba(255,255,255,.85);transition:all .15s;font-family:inherit;border:none;background:transparent;width:100%;text-align:left}
.sb-item:hover{background:rgba(255,255,255,.12)}
.sb-item.active{background:#fff;color:${T.goldDeep};box-shadow:0 4px 14px rgba(0,0,0,.12);font-weight:800}
.sb-item .ic{font-size:15px;width:20px;text-align:center}
.sb-teacher{margin-top:auto;padding:11px 12px;background:rgba(0,0,0,.18);border-radius:10px;font-size:11px;line-height:1.5}
.sb-teacher b{font-weight:800;font-size:12.5px}

/* ── 모바일 상단바 + 하단탭 (≤ 768px) ── */
.mobile-topbar{display:none;padding:14px 16px;background:#fff;border-bottom:1px solid ${T.border};position:sticky;top:0;z-index:99;align-items:center;gap:10px}
.mobile-topbar .logo-icon{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,${T.gold},${T.goldDark});color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px;letter-spacing:-0.5px}
.mobile-topbar h1{flex:1;font-size:14px;font-weight:800;color:${T.text};letter-spacing:-.2px}
.mobile-topbar h1 .sub{font-size:10px;color:${T.textMuted};font-weight:500;display:block;margin-top:1px}
.mobile-teacher{padding:5px 10px;background:${T.goldLight};color:${T.goldDark};border-radius:8px;font-size:10.5px;font-weight:700;white-space:nowrap}
.mobile-tabbar{display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid ${T.border};padding:6px 0 max(10px,env(safe-area-inset-bottom));z-index:200;box-shadow:0 -4px 20px rgba(0,0,0,.06)}
.mobile-tabbar-inner{display:flex;max-width:540px;margin:0 auto}
.mb-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:7px 0;background:none;border:none;font-family:inherit}
.mb-tab .ic{font-size:18px;color:${T.textMuted};transition:all .15s}
.mb-tab .lb{font-size:9.5px;color:${T.textMuted};font-weight:700}
.mb-tab.active .ic{color:${T.goldDark};transform:translateY(-2px)}
.mb-tab.active .lb{color:${T.goldDark}}

@media (max-width: 768px){
  .app-shell{flex-direction:column}
  .sidebar{display:none}
  .mobile-topbar{display:flex}
  .mobile-tabbar{display:block}
  .main-content{padding-bottom:80px}
  .wrap, [class*="wrap"]{padding-left:14px !important;padding-right:14px !important}
}
@media (min-width: 769px){
  .mobile-topbar, .mobile-tabbar{display:none !important}
}
`}</style>

      {/* ════ 데스크탑: 좌측 사이드바 (≥ 769px) ════ */}
      <nav className="sidebar">
        <div className="sb-logo-row">
          <div className="sb-logo-icon">C-ONE</div>
          <div className="sb-brand">채움학원<span className="sub">선생님 콘솔 v23.4</span></div>
        </div>
        <div className="sb-section">메인</div>
        {_navTabs.filter(t=>t.section==="main").map(t=>(
          <button key={t.k} className={"sb-item"+(tab===t.k?" active":"")} onClick={()=>setTab(t.k)}>
            <span className="ic">{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
        <div className="sb-section">도구</div>
        {_navTabs.filter(t=>t.section==="tools").map(t=>(
          <button key={t.k} className={"sb-item"+(tab===t.k?" active":"")} onClick={()=>setTab(t.k)}>
            <span className="ic">{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
        {teacher && (
          <div className="sb-teacher">
            <b>👤 {teacher}</b>
            <div style={{opacity:.75,marginTop:2}}>{(teacherList||[]).find(t=>(t.name||t["이름"])===teacher)?.category||(teacherList||[]).find(t=>(t.name||t["이름"])===teacher)?.subject||"-"}</div>
          </div>
        )}
      </nav>

      <div className="main-content">
        {/* ════ 모바일: 상단바 (≤ 768px) ════ */}
        <div className="mobile-topbar">
          <div className="logo-icon">C-ONE</div>
          <h1>채움학원<span className="sub">선생님 콘솔</span></h1>
          {teacher && <div className="mobile-teacher">👤 {teacher}</div>}
        </div>
      {/* ═══ 일괄 프린트 탭 ═══ */}
      {/* ★ v23.1: 일괄 프린트 탭 제거 — 오늘의 현황의 "파일 일괄 다운로드" 버튼으로 대체 */}
      {/* ═══ 반별 성적 탭 (v20.4) ═══ */}
      {screen==="home"&&tab==="stats"&&(<StatsTab sheetsUrl={SHEETS_URL} T={T} S={S} teacherList={teacherList} proxyDownload={proxyDownload} proxyPreview={proxyPreview}/>)}
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
              <select style={S.inp} value={teacher} onChange={e=>{
                const newName = e.target.value;
                setTeacher(newName);
                // ★ v23.2: 선생님 선택 시 과목 자동 매칭 (관리자는 수동)
                const t = teacherList.find(x=>(x.name||x["이름"])===newName);
                if (t) {
                  const cat = String(t.category||t.subject||"").trim();
                  const isAdmin = cat==="관리자" || cat==="기타" || /실장|데스크|원장|관리/.test(cat);
                  if (!isAdmin && ["국어","영어","수학","과학","사회"].includes(cat)) {
                    setTs(cat);
                  }
                }
              }}>
                <option value="">-- 선생님 선택 --</option>
                {/* ★ 카테고리(관리자/국어/영어/수학) 우선 그룹핑, fallback 과목 */}
                {["관리자","국어","영어","수학"].map(cat=>{
                  const catTeachers=teacherList.filter(t=>(t.category||t.subject)===cat);
                  if(catTeachers.length===0)return null;
                  return(<optgroup key={cat} label={cat==="관리자"?cat+" (직접 과목 선택)":cat+"과 (자동)"}>{catTeachers.map(t=>(<option key={t.name} value={t.name}>{t.name}</option>))}</optgroup>);
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
          {/* ★ v23.2: 시험 종류 선택 제거 — 자동 "시험"으로 통일. CONE 연결 후 반/시험 분류 도입 예정.
              과거 ExamTypeSelect 컴포넌트는 유지 (반별 성적 등 다른 화면에서 사용 가능). */}
          {/* ★ v22.7: 주관식 채점 모드 — examType 으로 자동 추천 + 수동 토글 */}
          <div style={{marginBottom:16,padding:"12px 14px",borderRadius:10,background:T.goldPale,border:`1px solid ${T.goldMuted}`}}>
            <div style={{fontSize:13,fontWeight:700,color:T.goldDeep,marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
              📝 주관식 채점 모드
              {gradingModeAuto && <span style={{fontSize:10,padding:"2px 6px",borderRadius:6,background:T.gold,color:T.white,fontWeight:700}}>자동 추천</span>}
            </div>
            <div style={{fontSize:11,color:T.textMuted,marginBottom:8,lineHeight:1.5}}>
              {gradingModeAuto ? `"${examType}" → AI가 ${gradingMode==="loose"?"해석/번역":"단답"} 시험으로 인식했어요. 다르면 변경하세요.` : "직접 선택해주세요."}
            </div>
            <div style={{display:"flex",gap:6}}>
              {[
                {v:"strict",label:"엄격",desc:"단어/영작/단답 (정확도 중심)"},
                {v:"loose",label:"유연",desc:"해석/번역 (의역 인정) ⭐"}
              ].map(o=>{
                const a=gradingMode===o.v;
                const recommend=gradingModeAuto&&a;
                return(<button key={o.v} onClick={()=>{setGradingMode(o.v);setGradingModeAuto(false);}} style={{flex:1,padding:"10px 8px",borderRadius:10,border:`1.5px solid ${a?T.goldDark:T.border}`,background:a?T.goldDark:T.white,cursor:"pointer",fontFamily:"inherit",textAlign:"left",position:"relative"}}>
                  <div style={{fontSize:13,fontWeight:a?800:600,color:a?T.white:T.text,marginBottom:2}}>{o.label}{recommend&&" ⭐"}</div>
                  <div style={{fontSize:10,color:a?T.goldLight:T.textMuted,lineHeight:1.4}}>{o.desc}</div>
                </button>);
              })}
            </div>
          </div>
          <div style={{marginBottom:16}}>
            <div style={S.label}>시험 날짜 / 시간 <span style={{color:T.danger}}>*</span></div>
            <div style={{display:"flex",gap:8,marginBottom:6}}>
              <input type="date" style={{...S.dateInp,flex:"1 1 55%"}} value={examDate} onChange={e=>setExamDate(e.target.value)}/>
              <input type="time" style={{...S.dateInp,flex:"1 1 40%",minWidth:0}} value={examTime} onChange={e=>setExamTime(e.target.value)}/>
            </div>
            {/* ★ v23.2: 빠른 시간 선택 — 주중 + 주말 분리 */}
            <div style={{marginBottom:4,fontSize:10,color:T.textMuted,fontWeight:600}}>주중 (월~금)</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
              {["17:00","18:00","19:00","20:00","21:00","22:00"].map(t=>{
                const a = examTime===t;
                return(<button key={t} type="button" onClick={()=>setExamTime(t)} style={{padding:"4px 10px",fontSize:11,fontWeight:700,borderRadius:14,border:`1px solid ${a?T.goldDark:T.border}`,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>{t}</button>);
              })}
            </div>
            <div style={{marginBottom:4,fontSize:10,color:T.textMuted,fontWeight:600}}>주말 (토)</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {["11:00","12:00","13:00","14:00","15:00","16:00"].map(t=>{
                const a = examTime===t;
                return(<button key={t} type="button" onClick={()=>setExamTime(t)} style={{padding:"4px 10px",fontSize:11,fontWeight:700,borderRadius:14,border:`1px solid ${a?T.goldDark:T.border}`,background:a?T.gold:T.white,color:a?T.white:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>{t}</button>);
              })}
              <button type="button" onClick={()=>{const now=new Date();setExamTime(`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`);}} style={{padding:"4px 10px",fontSize:11,fontWeight:700,borderRadius:14,border:`1px solid ${T.blue}`,background:T.white,color:T.blue,cursor:"pointer",fontFamily:"inherit"}}>🕐 지금</button>
            </div>
          </div>
        </div>
        <button style={S.btnG} onClick={goToMode}>다음 →</button>
      </div>)}
      {/* ═══ 오늘의 현황 대시보드 — 별도 컴포넌트 ═══ */}
      {screen==="home"&&tab==="dashboard"&&(<DashboardTab sheetsUrl={SHEETS_URL} T={T} S={S} teacherList={teacherList} proxyDownload={proxyDownload} proxyPreview={proxyPreview} currentTeacher={teacher}/>)}
      {/* ═══ 스케줄 관리 탭 — 별도 컴포넌트 ═══ */}
      {/* ★ v23.0: 스케줄 탭 제거 — DB 연결 후 재구현 예정 */}
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
        {/* 시작번호 설정 — 직접 입력 모드만 (PDF 업로드 모드는 AI 자동 추출) */}
        <div style={S.card}>
          <div style={S.secLabel}>시작 번호 <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:4}}>(시험지 첫 번호가 1이 아닌 경우)</span></div>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <input type="number" min="1" value={startNum} onChange={e=>setStartNum(Math.max(1,parseInt(e.target.value)||1))} style={{...S.chInp,width:100,textAlign:"center",fontSize:16,fontWeight:700}} placeholder="1"/>
            <span style={{fontSize:12,color:T.textSub}}>번부터 시작</span>
            {startNum>1&&<span style={{fontSize:11,color:T.accent,fontWeight:600}}>→ OMR에 {startNum}(1), {startNum+1}(2)... 표시</span>}
          </div>
          <div style={{fontSize:10,color:T.textMuted,marginTop:4}}>💡 PDF 업로드 모드는 AI가 답지에서 시작번호를 자동 인식합니다.</div>
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
                {/* v21.5: 문항수/시작번호 모두 AI가 자동 인식 (입력 불필요) */}
                <div style={{padding:"8px 10px",marginBottom:8,borderRadius:6,background:T.accentLight+"55",fontSize:10,color:T.accent,fontWeight:600,lineHeight:1.5}}>
                  🤖 문항수와 시작번호는 AI가 답지에서 자동 인식합니다 (201번부터 시작 등도 OK)
                </div>
                <FileUploadMulti label={`시험지${rd.label?" ("+rd.label+")":""}`} files={rd.examFiles} onFilesChange={v=>updateRound(ri,"examFiles",v)} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
                <FileUploadMulti label={`정답지${rd.label?" ("+rd.label+")":""}`} files={rd.answerFiles} onFilesChange={v=>updateRound(ri,"answerFiles",v)} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
              </div>
            ))}
            <button onClick={()=>setRounds(p=>[...p,{label:"",examFiles:[],answerFiles:[],totalQ:30,startNum:1,endNum:30}])} style={{width:"100%",padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,borderRadius:10,border:`2px dashed ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer",fontFamily:"inherit"}}>+ 차수 추가</button>
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
                      {/* v21.5: 문항수/시작번호 모두 AI가 자동 인식 (입력 불필요) */}
                      <div style={{padding:"6px 8px",marginBottom:6,borderRadius:5,background:T.accentLight+"55",fontSize:10,color:T.accent,fontWeight:600,lineHeight:1.4}}>
                        🤖 문항수와 시작번호는 AI가 자동 인식
                      </div>
                      <FileUploadMulti label={`시험지${rd.label?" ("+rd.label+")":""}`} files={rd.examFiles} onFilesChange={v=>updateClassRound(cls.name,ri,"examFiles",v)} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
                      <FileUploadMulti label={`정답지${rd.label?" ("+rd.label+")":""}`} files={rd.answerFiles} onFilesChange={v=>updateClassRound(cls.name,ri,"answerFiles",v)} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.hwp,.hwpx"/>
                    </div>
                  ))}
                  <button onClick={()=>setClassRounds(p=>({...p,[cls.name]:[...(p[cls.name]||[]),{label:"",examFiles:[],answerFiles:[],totalQ:30,startNum:1,endNum:30}]}))} style={{width:"100%",padding:"8px 12px",fontSize:12,fontWeight:700,borderRadius:8,border:`2px dashed ${T.goldDark}`,background:T.white,color:T.goldDark,cursor:"pointer",fontFamily:"inherit"}}>+ 차수 추가</button>
                </div>
              </div>
            ))}
          </>)}
          <div style={{padding:"12px 14px",borderRadius:10,background:T.blueLight,border:`1px solid ${T.blue}30`,marginTop:8}}>
            <div style={{fontSize:12,fontWeight:700,color:T.blue,marginBottom:4}}>💡 이렇게 처리됩니다</div>
            <div style={{fontSize:12,color:T.textSub,lineHeight:1.7}}>1. 드라이브에 저장됩니다.<br/>2. Claude가 정답지를 분석하여 정답을 추출합니다.<br/>3. 학생 앱에서 시험 선택 시 <b>차수</b>가 표시됩니다.</div>
          </div>
        </div>
        {/* v21.2: 객관식·주관식 자동 판별 안내 (선생님 입력 불필요) */}
        <div style={{padding:"12px 14px",borderRadius:10,background:T.accentLight,border:`1px solid ${T.accent}40`,marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:T.accent,marginBottom:4}}>🤖 객관식·주관식은 AI가 답지에서 자동 판별합니다</div>
          <div style={{fontSize:11,color:T.textSub,lineHeight:1.6}}>
            Gemini·GPT·Claude 3개 AI가 각 문항을 보고 <b>① 답이 1~5 숫자면 객관식</b>, <b>② 텍스트면 주관식</b>으로 분류합니다.<br/>
            잘못 판별되면 검수 화면에서 직접 수정할 수 있어요.
          </div>
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
            {filled>0?"✅ 학생들이 이 시험을 선택하면 즉시 채점됩니다!":"📄 답지가 업로드되었습니다. AI가 자동 검수합니다."}
          </div>
          {/* [v21.0] AI 검수 진행 상황 */}
          {(aiRunning||aiResults.length>0)&&(
            <div style={{...S.card,padding:"14px 16px",marginBottom:16,textAlign:"left"}}>
              <div style={{fontSize:14,fontWeight:800,color:T.goldDark,marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                <span>🔍 AI 답지 자동 검수</span>
                {aiRunning&&<span style={{fontSize:11,fontWeight:600,color:T.textMuted}}>진행 중... ({aiResults.filter(r=>r.status&&r.status!=="pending").length}/{aiResults.length})</span>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {aiResults.map((r,i)=>{
                  const canRetry = (r.status==="error"||r.status==="mismatch") && !aiRunning && aiTasks[i] && aiTasks[i].file;
                  return(
                  <div key={i} style={{padding:"8px 10px",borderRadius:8,background:r.status==="ok"?T.accentLight:r.status==="mismatch"?"#fff5f0":r.status==="error"?T.dangerLight:T.borderLight,fontSize:12,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:140,fontWeight:600,color:T.text}}>{r.label}</div>
                    {r.status==="pending"&&<span style={{color:T.textMuted}}>⏳ 분석 중...</span>}
                    {r.status==="ok"&&<span style={{color:T.accent,fontWeight:700}}>✅ 만장일치 자동 등록</span>}
                    {r.status==="mismatch"&&<span style={{color:"#d97706",fontWeight:700}}>⚠️ 불일치 {r.mismatchCount}개 (검수 필요)</span>}
                    {r.status==="error"&&<span style={{color:T.danger,fontWeight:700,wordBreak:"break-all",fontSize:11}}>❌ {r.error||"오류"}</span>}
                    {canRetry&&(
                      <button onClick={()=>retryAiTask(i)} title="같은 PDF로 AI 재검수 (Gemini + Claude 다시 호출)"
                        style={{padding:"5px 12px",fontSize:11,fontWeight:700,borderRadius:6,border:"none",background:r.status==="error"?T.danger:"#d97706",color:T.white,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                        🔄 재검수
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
              {!aiRunning&&aiResults.some(r=>r.status==="mismatch"||r.status==="error")&&(
                <div style={{marginTop:10,padding:"10px 12px",borderRadius:8,background:T.goldPale,fontSize:12,color:T.goldDeep,fontWeight:600,lineHeight:1.6}}>
                  💡 <b>실패/불일치 항목</b>은 위 <b>🔄 재검수</b> 버튼으로 즉시 다시 시도할 수 있어요.<br/>
                  여전히 안 풀리면 <b>"오늘의 현황" 탭 → AI 검수 대기</b> 카드에서 직접 답안을 입력해 확정하세요.
                </div>
              )}
            </div>
          )}
          <button style={{...S.btnG,maxWidth:320,margin:"0 auto"}} onClick={reset}>다른 시험 등록하기</button>
        </div>
      </div>)}
      {error&&<div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:T.dangerLight,color:T.danger,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:600,zIndex:999}}>{error}</div>}
      </div> {/* /.main-content */}

      {/* ════ 모바일/태블릿: 하단 탭바 (≤ 768px) ════ */}
      <nav className="mobile-tabbar">
        <div className="mobile-tabbar-inner">
          {_navTabs.map(t=>(
            <button key={t.k} className={"mb-tab"+(tab===t.k?" active":"")} onClick={()=>setTab(t.k)}>
              <span className="ic">{t.icon}</span>
              <span className="lb">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
const S={
  // ★ v23.4: app shell 은 CSS 클래스(.app-shell)에서 flex 처리, max-width 1400으로 확장
  app:{fontFamily:"'Noto Sans KR',-apple-system,sans-serif",background:T.bg,minHeight:"100vh"},
  hdr:{background:T.white,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,zIndex:100},
  hdrIn:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px"},
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
  subBar:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:960,background:T.white,borderTop:`1px solid ${T.border}`,padding:"10px 16px",paddingBottom:"max(10px,env(safe-area-inset-bottom))",display:"flex",alignItems:"center",gap:10,zIndex:200}, /* sub-bar-fix 클래스로 PC 반응형 */
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
