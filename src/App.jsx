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
// ★ v23.20 (2026-05-13): 시험 날짜 수정 기능
//   - 오늘의 현황 카드에 "📅 날짜 수정" 버튼 추가
//   - 잘못 등록한 날짜 (예: 내일 시험을 오늘 날짜로) 즉시 변경 가능
//   - editExamDate 핸들러 + GAS update_exam_date 호출
// ★ v23.19 (2026-05-13): "초록=추가/빨강=빼야 함" 반복 안내 삭제 + safeTeacher 헬퍼
// ★ v23.18: Top 7 PDF — 5명 미만 응시 시에도 학생 개인 wrongQs 로 pseudo-hardest 생성
// ★ v23.17: Top 7 PDF 오답노트 다운로드 (Phase 7-B)
//   v23.17 변경점 (2026-05-13):
//   - StatsTab 카드에 "🔥 Top 7 오답" 버튼 추가 (반별·기간 누적 모두)
//   - downloadTop7Pdf() 헬퍼: view_answer_key로 explanations 조회 → 인쇄용 HTML 생성
//   - 영어: 문제 본문 + 풀이 + 선택지별 분석 + 자주 하는 실수
//   - 수학: 문항번호·풀이만 (원본 시험지 별도 안내)
// ★ v23.16: 보강 시험 현황 탭 추가 + Top 7 통계 (Phase 5+7)
//   v23.16 변경점 (2026-05-13):
//   - 새 탭 "📚 보강 현황" — 학생 약점 미니 시험 진행 추적
//   - MiniExamProgressTab 컴포넌트: 반별 표 + 자동 새로고침 + 필터 + 비활성 일괄푸시
//   - GAS list_mini_exam_progress 호출 (v24.11)
//   - StatsTab의 Top 5 → Top 7 (GAS 사이드 통계 버그도 함께 수정)
// ★ v23.15: 문제 생성 — 시험 등록과 100% 동일 UI + 막대바 추가 축소
//   v23.15 변경점 (2026-05-12):
//   - 레벨/학교: LV_CATS 다중선택 (시험 등록과 동일) — 여러 학교 한 번에 등록 가능
//   - 막대바 너비 360px 고정 (가로 화면에서도 작게)
//   - 챕터 자동 로드 강화 (GAS v24.3 KNOWN_CHAPTERS_LIST 확장)
//   v23.14: UI 통합 개선 (시험등록 동일 양식 + 진행상황 대시보드 + 막대바 축소)
//   v23.13: 챕터 입력 강화 (수동 토글 + 퍼지 매칭 + 결합 챕터 자동 분리)
//   v23.12: Drive 교재 자동 로드 (GAS list_textbooks/list_chapters)
//   - 카테고리 자동 분류 + 사용자 수동 변경
//   - 1회용 PDF 첨부 슬롯 (즉시 생성에만 사용)
//   - 클로드가 별도 환경에서 GAS 큐 처리 → 완료 시 자동 학생앱 등록
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
/* ═══════════════════════════════════════════════════════════
   📚 문제 생성 — 공용 데이터 정의 (교재·챕터·유형·세부유형)
   ═══════════════════════════════════════════════════════════
   GeneratorTab(v23.12 Drive 자동 로드 방식)이 사용.
   - AI_BOOKS/AI_BOOK_CHAPTERS: Drive 로드 실패 시 ★폴백★ 용도 (메인은 GAS list_textbooks)
   - AI_CAT_KR: 카테고리 라벨 (필터·표시 공용)
   - AI_TYPE_META: 시험 유형 메타 (아이콘·이름·색)
   - AI_SUBTYPES: 시험 유형별 세부 유형
   ═══════════════════════════════════════════════════════════ */
const AI_BOOKS = {
  grammar: ['채움문법 1권 (기초)','채움문법 2권','채움문법 3권','채움문법 4권','채움문법 5권','채움문법 6권 (심화)','채움문법 7권 (고급)'],
  writing: ['채움서술형 Basic','채움서술형 1권','채움서술형 2권','채움서술형 3권 (심화)'],
  syntax:  ['채움구문 Basic 30차','채움구문 1권','채움구문 2권','채움구문 3권 (심화)'],
  vocab:   ['채움VOCA Basic 1','채움VOCA Basic 2','채움VOCA 중등 1권','채움VOCA 중등 2권','채움VOCA 중등 3권','채움VOCA 고등 필수'],
  reading: ['채움리딩 Level 1','채움리딩 Level 2','채움리딩 Level 3','채움리딩 Level 4'],
  mock:    ['2025 수능','2024 수능','2023 수능','2025 고1 3월 모의고사','2025 고1 6월 모의고사','2025 고2 3월 모의고사','2025 고2 6월 모의고사']
};
const AI_BOOK_CHAPTERS = {
  '채움문법 1권 (기초)': ['Ch01 품사','Ch02 명사','Ch03 관사','Ch04 형용사','Ch05 부사','Ch06 동사','Ch07 시제'],
  '채움문법 2권': ['Ch01 시제','Ch02 조동사','Ch03 수동태','Ch04 부정사','Ch05 동명사','Ch06 분사'],
  '채움문법 3권': ['Ch01 관계대명사','Ch02 관계부사','Ch03 가정법','Ch04 비교','Ch05 일치와 화법'],
  '채움문법 4권': ['Ch01 분사구문','Ch02 도치','Ch03 강조','Ch04 생략','Ch05 문장 구조'],
  '채움문법 5권': ['Ch01 시제 종합','Ch02 조동사 종합','Ch03 수동태','Ch04 부정사·동명사','Ch05 분사·분사구문','Ch06 관계사 종합'],
  '채움문법 6권 (심화)': ['Ch01 가정법 종합','Ch02 도치·강조','Ch03 비교 구문','Ch04 특수 구문','Ch05 화법 전환'],
  '채움문법 7권 (고급)': ['Ch01 고난도 어법','Ch02 추론형 어법','Ch03 통합 문제'],
  '채움서술형 Basic': ['Ch01 단문 영작','Ch02 어순 배열','Ch03 빈칸 채우기','Ch04 문장 변형'],
  '채움서술형 1권': ['Ch01 영작 입문','Ch02 어순','Ch03 변형','Ch04 요약'],
  '채움서술형 2권': ['Ch01 중급 영작','Ch02 빈칸 추론 영작','Ch03 답안형'],
  '채움서술형 3권 (심화)': ['Ch01 고급 영작','Ch02 통합 서술형'],
  '채움구문 Basic 30차': Array.from({length:30}, (_,i) => `${i+1}차 구문`),
  '채움구문 1권': ['Ch01 5형식','Ch02 시제 구문','Ch03 조동사 구문','Ch04 to부정사','Ch05 동명사'],
  '채움구문 2권': ['Ch01 분사 구문','Ch02 관계사 구문','Ch03 가정법','Ch04 비교 구문'],
  '채움구문 3권 (심화)': ['Ch01 도치·강조','Ch02 분사구문 심화','Ch03 특수 구문'],
  '채움VOCA Basic 1': ['Day 1~5','Day 6~10','Day 11~15','Day 16~20'],
  '채움VOCA Basic 2': ['Day 1~5','Day 6~10','Day 11~15','Day 16~20'],
  '채움VOCA 중등 1권': Array.from({length:10}, (_,i) => `Week ${i+1}`),
  '채움VOCA 중등 2권': Array.from({length:10}, (_,i) => `Week ${i+1}`),
  '채움VOCA 중등 3권': Array.from({length:10}, (_,i) => `Week ${i+1}`),
  '채움VOCA 고등 필수': Array.from({length:12}, (_,i) => `Day ${i+1}`),
  '채움리딩 Level 1': ['Unit 1','Unit 2','Unit 3','Unit 4','Unit 5'],
  '채움리딩 Level 2': ['Unit 1','Unit 2','Unit 3','Unit 4','Unit 5'],
  '채움리딩 Level 3': ['Unit 1','Unit 2','Unit 3','Unit 4','Unit 5'],
  '채움리딩 Level 4': ['Unit 1','Unit 2','Unit 3','Unit 4','Unit 5'],
  '2025 수능': ['18~20번','21~24번','25~28번','29~31번','32~34번','35~37번','38~39번','40~42번','43~45번'],
  '2024 수능': ['18~20번','21~24번','25~28번','29~31번','32~34번','35~37번','38~39번','40~42번','43~45번'],
  '2023 수능': ['18~20번','21~24번','25~28번','29~31번','32~34번','35~37번','38~39번','40~42번','43~45번'],
  '2025 고1 3월 모의고사': ['18~20번','21~24번','25~28번','29~31번','32~34번','35~37번','38~39번','40~45번'],
  '2025 고1 6월 모의고사': ['18~20번','21~24번','25~28번','29~31번','32~34번','35~37번','38~39번','40~45번'],
  '2025 고2 3월 모의고사': ['18~20번','21~24번','25~28번','29~31번','32~34번','35~37번','38~39번','40~45번'],
  '2025 고2 6월 모의고사': ['18~20번','21~24번','25~28번','29~31번','32~34번','35~37번','38~39번','40~45번']
};
const AI_CAT_KR = { grammar: "📝 문법", writing: "✍️ 서술형", syntax: "🔗 구문", vocab: "🔤 단어", reading: "📖 리딩", mock: "📋 모의고사" };
const AI_TYPE_META = {
  grammar: { icon: "📝", name: "문법", color: "#C08A2E" },
  vocab:   { icon: "🔤", name: "단어", color: "#1890FF" },
  reading: { icon: "📖", name: "리딩", color: "#52C41A" },
  writing: { icon: "✍️", name: "서술형", color: "#722ED1" },
  translation: { icon: "🌐", name: "해석", color: "#EB2F96" }
};
const AI_SUBTYPES = {
  grammar:     ["어법 옳/그른 것 고르기","빈칸에 알맞은 어법","문장 변형 (능동→수동 등)","어순 배열","단문 영작"],
  vocab:       ["영어 → 한국어 뜻 쓰기","한국어 → 영어 단어 쓰기","빈칸에 알맞은 단어","객관식 의미 고르기","동의어 / 반의어","단어로 문장 만들기"],
  reading:     ["주제 / 제목 / 요지","빈칸 추론","함의 / 심정","글의 순서","문장 삽입","일치 / 불일치","어법·어휘 어색한 곳"],
  writing:     ["영작 (한 → 영)","어순 배열","빈칸에 단어·구 쓰기","한 줄 요약","답안형 쓰기"],
  translation: ["영 → 한 번역","구문 분석 (S/V/수식어)","본문 의미 일치 고르기"]
};

/* ═══════════════════════════════════════════════════════════
   📚 문제 생성 예약 탭 (v23.12) — Drive 자동 로드 + 큐 방식
   ═══════════════════════════════════════════════════════════
   v23.12 변경점:
   - 교재 = GAS list_textbooks 액션으로 Drive에서 자동 로드
   - 카테고리 = 폴더/파일명 키워드 기반 자동 분류 + 사용자 변경 가능
   - 챕터 = GAS list_chapters 액션으로 자동 로드 (체크박스 선택)
   - GAS 액션 미구현 시 → AI_BOOKS/AI_BOOK_CHAPTERS 로컬 폴백
   - test-generator 가이드 v17: A세트 1개만 생성 (B세트 폐기)
   - examDate/examTime 필드로 폴더 분기, mcRatio로 객/서 비율 강제
   - 1회용 PDF 첨부 슬롯 (이번 생성에만 사용)
   ═══════════════════════════════════════════════════════════ */
function GeneratorTab({ sheetsUrl, T, S, teacherList, currentTeacher }) {
  // ── 화면 ──
  const [screen, setScreen] = useState("form"); // form | queue

  // ── 폼 상태 (★ v23.12: Drive 자동 로드 방식) ──
  const [bookCategory, setBookCategory] = useState("all"); // 필터: all | grammar | writing | syntax | vocab | reading | mock
  const [textbooks, setTextbooks] = useState([]);          // GAS에서 받아온 Drive 교재 [{id, name, category, fileType, parentName}]
  const [textbooksLoading, setTextbooksLoading] = useState(true);
  const [textbooksError, setTextbooksError] = useState("");
  const [selectedBook, setSelectedBook] = useState(null);  // {id, name, category, ...} | null
  const [showCatChangeFor, setShowCatChangeFor] = useState(null); // 카테고리 변경 메뉴 표시할 교재 id

  const [rangeMode, setRangeMode] = useState("chapter");
  const [chapters, setChapters] = useState([]);            // GAS에서 받아온 챕터 [{id, name}]
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState([]); // 선택된 챕터 name 배열
  const [chapterFallbackText, setChapterFallbackText] = useState(""); // 수동 입력 텍스트
  const [chapterManualMode, setChapterManualMode] = useState(false);  // ★ v23.13: 자동 로드 무시하고 수동 입력 사용
  const [pageFrom, setPageFrom] = useState("");
  const [pageTo, setPageTo] = useState("");

  const [selectedTypes, setSelectedTypes] = useState([{ type: "grammar", percentage: 100, subtypes: [] }]);
  const [questionCount, setQuestionCount] = useState(30);
  const [customCountMode, setCustomCountMode] = useState(false);
  const [mcRatio, setMcRatio] = useState(60);
  const [difficulty, setDifficulty] = useState({ easy: 30, mid: 50, hard: 20 });
  const [setType, setSetType] = useState(""); // 이론편 | 실전편 | 혼합 | (기본)
  const [memo, setMemo] = useState("");
  const [pdfFiles, setPdfFiles] = useState([]);            // 1회용 PDF [{name, base64, sizeMB}]
  const [pdfPanelOpen, setPdfPanelOpen] = useState(false);  // ★ v23.14: PDF 슬롯 기본 접힘
  const [showAllBooks, setShowAllBooks] = useState(false);  // ★ v23.14: 교재 5권 초과 더보기

  // ── 학생앱 등록 정보 (★ v23.14: 시험 등록 양식과 동일하게 확장) ──
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
  const [regSubject, setRegSubject] = useState("영어");
  const [regGrade, setRegGrade] = useState("중2");
  // ★ v23.15: 시험 등록과 동일한 학교 다중선택 (LV_CATS)
  const [regLevelCat, setRegLevelCat] = useState("level"); // level | middle | high | etc
  const [regLevelMulti, setRegLevelMulti] = useState(["A"]); // 체크박스 다중선택
  const [regLevelCustom, setRegLevelCustom] = useState(""); // 기타 직접 입력
  // 호환성: 단일 레벨 (handleSubmit에서 derive)
  const regLevel = regLevelCat === "etc" ? regLevelCustom : (regLevelMulti.join("+") || "A");
  const [regTeacher, setRegTeacher] = useState(currentTeacher || "");
  const [examDate, setExamDate] = useState(todayIso);
  const [examTime, setExamTime] = useState("19:00");
  const [studentCount, setStudentCount] = useState("");        // ★ v23.14: 예상 응시 인원
  const [subjectiveMode, setSubjectiveMode] = useState("auto"); // ★ v23.14: 주관식 채점 모드 (auto|strict|flexible)

  // ── 큐 상태 ──
  const [queue, setQueue] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registeringRow, setRegisteringRow] = useState(null);
  const [autoRegister, setAutoRegister] = useState(true); // 완료 시 자동 학생앱 등록

  // ★ v23.12: 컴포넌트 마운트 시 Drive 교재 목록 자동 로드
  useEffect(() => {
    const load = async () => {
      setTextbooksLoading(true);
      setTextbooksError("");
      try {
        const r = await fetch(`${sheetsUrl}?action=list_textbooks`);
        const text = await r.text();
        let json;
        try { json = JSON.parse(text); } catch { json = {}; }
        if (Array.isArray(json.textbooks)) {
          setTextbooks(json.textbooks);
          if (json.textbooks.length === 0) {
            setTextbooksError("Drive 폴더 「채움학원 시험자료/교재」 가 비어있거나 찾을 수 없습니다.");
          }
        } else if (json.result === "error") {
          setTextbooksError(json.message || "교재 로드 실패");
        } else {
          // GAS 액션 미구현 또는 폴백: AI_BOOKS 로컬 데이터 사용
          const fallback = [];
          Object.entries(AI_BOOKS).forEach(([cat, books]) => {
            books.forEach((name, i) => {
              fallback.push({ id: `local_${cat}_${i}`, name, category: cat, fileType: "local" });
            });
          });
          setTextbooks(fallback);
          setTextbooksError("⚠ GAS list_textbooks 액션 미등록 — 로컬 목록을 표시합니다. _GAS_v24_교재로드_안내.md 참고");
        }
      } catch (e) {
        setTextbooksError(`네트워크 오류: ${e.message}`);
      } finally {
        setTextbooksLoading(false);
      }
    };
    load();
  }, [sheetsUrl]);

  // ★ v23.13: AI_BOOK_CHAPTERS 퍼지 매칭 (정확한 이름 일치 안 해도 부분 매칭)
  const findFallbackChapters = (bookName) => {
    if (!bookName) return [];
    const direct = AI_BOOK_CHAPTERS[bookName];
    if (direct) return direct;
    // 공백·괄호 제거 후 비교
    const normalize = (s) => String(s || "").replace(/\s+/g, "").replace(/[()（）]/g, "").toLowerCase();
    const target = normalize(bookName);
    if (!target) return [];
    for (const key of Object.keys(AI_BOOK_CHAPTERS)) {
      const keyNorm = normalize(key);
      if (keyNorm === target || keyNorm.includes(target) || target.includes(keyNorm)) {
        return AI_BOOK_CHAPTERS[key];
      }
    }
    return [];
  };

  // ★ v23.13: GAS 챕터 응답 정규화 ("Ch01~05" 같은 결합 챕터 자동 분리)
  const normalizeChapterList = (raw) => {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((ch, idx) => {
      const rawName = String(ch?.name || ch || "").trim();
      if (!rawName) return;
      // 페이지 정보 제거 옵션은 두지 않음 (원본 정보 유지)
      // 단, "Ch01-Ch05" 또는 "Ch01~Ch05" 같은 범위 패턴은 분리 시도
      const rangeMatch = rawName.match(/^(Ch|Chapter|Unit|Day|Week|단원)\s*0?(\d+)\s*[-~∼–]\s*(?:Ch|Chapter|Unit|Day|Week|단원)?\s*0?(\d+)(.*)$/i);
      if (rangeMatch) {
        const prefix = rangeMatch[1];
        const start = parseInt(rangeMatch[2], 10);
        const end = parseInt(rangeMatch[3], 10);
        const suffix = rangeMatch[4].trim();
        if (!isNaN(start) && !isNaN(end) && end >= start && end - start <= 30) {
          for (let n = start; n <= end; n++) {
            const num = String(n).padStart(2, "0");
            out.push({ id: `${ch?.id || idx}_${n}`, name: `${prefix}${num}${suffix ? " " + suffix : ""}` });
          }
          return;
        }
      }
      out.push({ id: ch?.id || `ch_${idx}`, name: rawName });
    });
    return out;
  };

  // ★ v23.12: 교재 선택 시 챕터 자동 로드
  useEffect(() => {
    if (!selectedBook) {
      setChapters([]);
      setSelectedChapters([]);
      setChapterFallbackText("");
      setChapterManualMode(false);
      return;
    }
    // 로컬 폴백 교재: AI_BOOK_CHAPTERS에서 즉시 사용
    if (selectedBook.fileType === "local" || String(selectedBook.id || "").startsWith("local_")) {
      const localChs = findFallbackChapters(selectedBook.name);
      setChapters(localChs.map((name, i) => ({ id: `local_ch_${i}`, name })));
      setSelectedChapters([]);
      setChapterManualMode(false);
      return;
    }
    const load = async () => {
      setChaptersLoading(true);
      try {
        const r = await fetch(`${sheetsUrl}?action=list_chapters&textbookId=${encodeURIComponent(selectedBook.id)}`);
        const text = await r.text();
        let json;
        try { json = JSON.parse(text); } catch { json = {}; }
        const fromServer = normalizeChapterList(json.chapters || []);
        if (fromServer.length > 0) {
          setChapters(fromServer);
        } else {
          const fallback = findFallbackChapters(selectedBook.name);
          setChapters(fallback.map((name, i) => ({ id: `local_ch_${i}`, name })));
        }
      } catch (e) {
        console.error("[list_chapters]", e);
        const fallback = findFallbackChapters(selectedBook.name);
        setChapters(fallback.map((name, i) => ({ id: `local_ch_${i}`, name })));
      } finally {
        setChaptersLoading(false);
      }
    };
    load();
    setSelectedChapters([]);
    setChapterFallbackText("");
    setChapterManualMode(false);
  }, [selectedBook, sheetsUrl]);

  // ★ v23.12: 카테고리 변경 (사용자가 직접 분류 변경)
  const handleChangeCategory = async (textbookId, newCategory) => {
    // 즉시 로컬 업데이트 (UX)
    setTextbooks(books => books.map(b => b.id === textbookId ? { ...b, category: newCategory } : b));
    if (selectedBook?.id === textbookId) {
      setSelectedBook(b => ({ ...b, category: newCategory }));
    }
    setShowCatChangeFor(null);
    // 서버에도 저장 (GAS set_textbook_category 미구현이어도 무시)
    try {
      await fetch(sheetsUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "set_textbook_category", textbookId, category: newCategory })
      });
    } catch (e) {
      console.warn("[set_textbook_category] 서버 저장 실패 — 로컬에만 적용:", e.message);
    }
  };

  // ★ v23.12: 챕터 토글
  const toggleChapter = (chapterName) => {
    setSelectedChapters(prev =>
      prev.includes(chapterName) ? prev.filter(c => c !== chapterName) : [...prev, chapterName]
    );
  };

  // ── 유형 토글 ──
  const toggleType = (type) => {
    const idx = selectedTypes.findIndex(t => t.type === type);
    let next;
    if (idx >= 0) {
      if (selectedTypes.length === 1) { alert("최소 1개의 시험 유형은 선택해야 합니다."); return; }
      next = selectedTypes.filter((_, i) => i !== idx);
    } else {
      next = [...selectedTypes, { type, percentage: 0, subtypes: [] }];
    }
    const each = Math.floor(100 / next.length);
    const extra = 100 - each * next.length;
    next.forEach((t, i) => { t.percentage = each + (i === 0 ? extra : 0); });
    setSelectedTypes(next);
  };

  // ── 유형 % 변경 ──
  const setTypePct = (idx, newVal) => {
    if (selectedTypes.length === 1) return;
    const v = parseInt(newVal);
    const diff = v - selectedTypes[idx].percentage;
    const next = selectedTypes.map((t, i) => i === idx ? { ...t, percentage: v } : { ...t });
    const others = next.filter((_, i) => i !== idx);
    const totalOthers = others.reduce((s, t) => s + t.percentage, 0);
    if (totalOthers === 0 && diff < 0) return;
    let rem = -diff;
    others.forEach((t, i) => {
      const share = i === others.length - 1 ? rem : Math.round((t.percentage / totalOthers) * -diff);
      t.percentage = Math.max(0, t.percentage + share);
      rem -= share;
    });
    const total = next.reduce((s, t) => s + t.percentage, 0);
    if (total !== 100) {
      const lastIdx = next.findIndex((_, i) => i !== idx && next[i].percentage > 0);
      if (lastIdx >= 0) next[lastIdx].percentage += (100 - total);
    }
    setSelectedTypes(next);
  };

  // ── 서브타입 토글 ──
  const toggleSubtype = (typeIdx, subName) => {
    const next = selectedTypes.map((t, i) => {
      if (i !== typeIdx) return t;
      const exIdx = t.subtypes.findIndex(s => s.name === subName);
      let subs = exIdx >= 0 ? t.subtypes.filter((_, k) => k !== exIdx) : [...t.subtypes, { name: subName, percentage: 0 }];
      const n = subs.length;
      if (n > 0) {
        const each = Math.floor(100 / n);
        const extra = 100 - each * n;
        subs = subs.map((s, k) => ({ ...s, percentage: each + (k === 0 ? extra : 0) }));
      }
      return { ...t, subtypes: subs };
    });
    setSelectedTypes(next);
  };

  // ── 서브타입 비중 슬라이더 ──
  const setSubtypePct = (typeIdx, subIdx, newVal) => {
    const v = Math.max(0, Math.min(100, parseInt(newVal) || 0));
    const next = selectedTypes.map((t, i) => {
      if (i !== typeIdx) return t;
      if (t.subtypes.length < 2) return t;
      const oldVal = t.subtypes[subIdx].percentage;
      const diff = v - oldVal;
      const updated = t.subtypes.map((s, k) => k === subIdx ? { ...s, percentage: v } : { ...s });
      const others = updated.map((s, k) => ({ ...s, _idx: k })).filter(s => s._idx !== subIdx);
      const totalOthers = others.reduce((acc, s) => acc + s.percentage, 0);
      if (totalOthers === 0 && diff < 0) return t;
      let rem = -diff;
      others.forEach((s, k) => {
        const share = k === others.length - 1
          ? rem
          : Math.round((s.percentage / Math.max(1, totalOthers)) * -diff);
        const idx2 = s._idx;
        updated[idx2].percentage = Math.max(0, updated[idx2].percentage + share);
        rem -= share;
      });
      const total = updated.reduce((acc, s) => acc + s.percentage, 0);
      if (total !== 100) {
        const otherIdx = updated.findIndex((_, k) => k !== subIdx && updated[k].percentage > 0);
        if (otherIdx >= 0) updated[otherIdx].percentage += (100 - total);
      }
      return { ...t, subtypes: updated };
    });
    setSelectedTypes(next);
  };

  // ── 난이도 변경 ──
  const diffChanged = (which, val) => {
    const v = parseInt(val);
    const { easy, mid, hard } = difficulty;
    let ne = easy, nm = mid, nh = hard;
    if (which === "easy") { ne = v; nh = 100 - ne - nm; if (nh < 0) { nm = Math.max(0, 100 - ne); nh = 0; } }
    else if (which === "mid") { nm = v; nh = 100 - ne - nm; if (nh < 0) { ne = Math.max(0, 100 - nm); nh = 0; } }
    else { nh = v; nm = 100 - ne - nh; if (nm < 0) { ne = Math.max(0, 100 - nh); nm = 0; } }
    setDifficulty({ easy: ne, mid: nm, hard: nh });
  };

  // ── 큐 로드 ──
  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const r = await fetch(`${sheetsUrl}?action=list_exam_gen`);
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = {}; }
      if (Array.isArray(json.requests)) {
        const sorted = [...json.requests].sort((a, b) => {
          const ta = new Date(a.requestedAt || 0).getTime();
          const tb = new Date(b.requestedAt || 0).getTime();
          return tb - ta;
        });
        setQueue(sorted);
      }
    } catch (e) {
      console.error("[loadQueue]", e);
    } finally {
      setLoadingQueue(false);
    }
  }, [sheetsUrl]);

  // ── 큐 자동 새로고침 (10초마다) ──
  useEffect(() => {
    if (screen !== "queue") return;
    loadQueue();
    const t = setInterval(loadQueue, 10000);
    return () => clearInterval(t);
  }, [screen, loadQueue]);

  // ── 비용/카운트 ──
  const mcCount = Math.round((questionCount * mcRatio) / 100);
  const ssCount = questionCount - mcCount;

  // ★ v23.11: 1회용 PDF 업로드 핸들러
  const handlePdfUpload = async (fileList) => {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;
    if (pdfFiles.length + arr.length > 3) {
      alert("PDF는 최대 3개까지 첨부 가능합니다.");
      return;
    }
    const newFiles = [];
    for (const f of arr) {
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        alert(`${f.name} 은(는) PDF가 아닙니다.`);
        continue;
      }
      const sizeMB = f.size / 1024 / 1024;
      if (sizeMB > 10) {
        alert(`${f.name} 은(는) ${sizeMB.toFixed(1)}MB로 너무 큽니다 (최대 10MB).\n큰 PDF는 Drive에 직접 업로드하세요.`);
        continue;
      }
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            const idx = result.indexOf('base64,');
            resolve(idx >= 0 ? result.substring(idx + 7) : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        newFiles.push({ name: f.name, base64, sizeMB: parseFloat(sizeMB.toFixed(2)) });
      } catch (e) {
        alert(`${f.name} 읽기 실패: ${e.message}`);
      }
    }
    if (newFiles.length > 0) setPdfFiles(p => [...p, ...newFiles]);
  };

  const removePdf = (idx) => setPdfFiles(p => p.filter((_, i) => i !== idx));

  // ── 예약 신청 ──
  const handleSubmit = async () => {
    if (!selectedBook) return alert("교재를 선택하세요.");
    if (rangeMode === "page" && (!pageFrom || !pageTo)) return alert("페이지 범위를 입력하세요.");
    if (!regTeacher) return alert("선생님을 선택하세요.");
    if (!regSubject || !regGrade || !regLevel) return alert("과목·학년·반을 모두 입력하세요.");

    // 챕터 → 배열 분리 (수동 모드 우선, 그 외엔 체크박스 선택, 마지막에 폴백)
    let ranges;
    if (rangeMode === "chapter") {
      if (chapterManualMode) {
        // 수동 입력 모드: 텍스트 박스 값만 사용
        ranges = chapterFallbackText.split(/[,，;；\n]/).map(s => s.trim()).filter(Boolean);
        if (ranges.length === 0) return alert("챕터를 직접 입력하세요.");
      } else if (selectedChapters.length > 0) {
        ranges = selectedChapters;
      } else if (chapterFallbackText.trim()) {
        ranges = chapterFallbackText.split(/[,，;；\n]/).map(s => s.trim()).filter(Boolean);
      } else {
        return alert("챕터를 1개 이상 선택하거나, 직접 입력해주세요.");
      }
    } else {
      ranges = [`p.${pageFrom}-${pageTo}`];
    }
    const rangeDesc = ranges.join(", ");

    // 시험 유형 직렬화 (memo에 기록 — Claude가 읽을 수 있도록)
    const typeBlock = selectedTypes.map(t => {
      const tCount = Math.round(questionCount * t.percentage / 100);
      const subBlock = t.subtypes.length > 0
        ? t.subtypes.map(s => `      • ${s.name}: ${s.percentage}% (약 ${Math.round(tCount * s.percentage / 100)}개)`).join("\n")
        : "      • (전체 세부 유형 균등 분포)";
      return `  - ${AI_TYPE_META[t.type]?.name || t.type}: ${t.percentage}% (약 ${tCount}개)\n${subBlock}`;
    }).join("\n");

    const mainType = selectedTypes[0]?.type || "grammar";

    // memo: [출제형태] + [유형분포] + [단일세트] + [채점모드] + 사용자 memo
    const modeLabel = subjectiveMode === "strict" ? "엄격 (단어·영작, 정확도 중심)"
      : subjectiveMode === "flexible" ? "유연 (해석·번역, 의역 인정)"
      : "자동 추천 (유형에 따라 자동)";
    const directive =
      `[출제형태] 객관식 ${mcCount}문제 + 서술형 ${ssCount}문제 (mcRatio=${mcRatio}%) — 절대 어기지 말 것.\n` +
      `[유형 분포]\n${typeBlock}\n` +
      `[단일세트] A세트 1개만 생성 (B세트 생성 금지 — v17)\n` +
      `[예상 인원] ${parseInt(studentCount) || 0}명\n` +
      `[주관식 채점 모드] ${modeLabel}`;
    const fullMemo = memo.trim() ? `${directive}\n[추가 메모]\n${memo}` : directive;

    const body = {
      action: "request_exam_gen",
      textbook: selectedBook.name,
      textbookId: selectedBook.id || "",                    // ★ v23.12: Drive 파일 ID 직접 전달
      bookCategory: selectedBook.category || mainType,      // ★ v23.12: 카테고리 정보 보존
      rangeType: rangeMode,
      rangeDesc,
      testType: mainType,
      setType: setType || "",
      questionCount,
      mcRatio,
      difficulty: { easy: difficulty.easy, medium: difficulty.mid, hard: difficulty.hard },
      teacher: regTeacher,
      targetClass: `${regSubject} ${regGrade} ${regLevel}반`,
      subject: regSubject,
      grade: regGrade,
      level: regLevel,
      examDate,
      examTime,
      studentCount: parseInt(studentCount) || 0,    // ★ v23.14
      subjectiveMode: subjectiveMode,                // ★ v23.14
      memo: fullMemo,
      requestedBy: currentTeacher || regTeacher,
      requestedAt: new Date().toISOString(),
      autoRegister: autoRegister,
      singleSet: true,
      // ★ v23.11: 1회용 PDF (있을 때만)
      pdfFiles: pdfFiles.map(f => ({ name: f.name, base64: f.base64, sizeMB: f.sizeMB }))
    };

    setSubmitting(true);
    try {
      const r = await fetch(sheetsUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body)
      });
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { result: "error", message: text.substring(0, 200) }; }

      if (json.result === "success" || json.result === "ok") {
        alert(`✅ 예약 등록 완료!\n\n📚 ${body.targetClass} · ${selectedBook.name}\n📝 ${questionCount}문항 (객관식 ${mcCount} + 서술형 ${ssCount})\n📅 ${examDate} ${examTime}\n👤 ${regTeacher}\n\n클로드가 큐를 처리하면${autoRegister ? " 자동으로 학생앱에 등록" : " 미리보기 후 수동 등록"}됩니다.\n\n진행 상황은 "📋 진행 상황" 메뉴에서 확인하세요.`);
        // ★ v23.14: 즉시 새로고침 + 화면 전환 → 새 예약이 바로 보임
        // 시트 반영이 약간 지연될 수 있어 200ms + 1500ms 두 번 호출
        setScreen("queue");
        setTimeout(() => loadQueue(), 200);
        setTimeout(() => loadQueue(), 1500);
      } else {
        alert(`❌ 예약 실패: ${json.message || "알 수 없음"}`);
      }
    } catch (e) {
      alert(`네트워크 오류: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── 완료된 요청을 학생앱에 수동 등록 ──
  const handleManualRegister = async (request) => {
    const ad = request.answerData;
    const qs = ad?.sets?.[0]?.questions;
    if (!qs || !Array.isArray(qs) || qs.length === 0) {
      alert("이 요청은 결과 데이터가 없습니다.\n클로드가 아직 완료하지 않았거나 오류가 발생했을 수 있습니다.");
      return;
    }

    const answersObj = {};
    const typesObj = {};
    qs.forEach(q => {
      const qNum = String(q.number);
      answersObj[qNum] = String(q.answer != null ? q.answer : "");
      typesObj[qNum] = q.type === "multiple_choice" ? "obj" : "sub";
    });

    const cls = String(request.targetClass || "");
    let subject = request.subject || "영어";
    let grade = request.grade || "";
    let level = request.level || "";
    if (!grade || !level) {
      // "영어 중1 A반" → 파싱
      const m = cls.match(/^(\S+)\s+(\S+)\s+(\S+)반?$/);
      if (m) { subject = m[1]; grade = m[2]; level = m[3].replace(/반$/, ''); }
    }

    const body = {
      action: "save_answer_key",
      subject, grade, level,
      examType: "문제생성기",
      setType: request.setType || "",
      round: "AI생성",
      totalQuestions: qs.length,
      answers: answersObj, types: typesObj,
      teacher: request.teacher || "",
      studentCount: 0,
      className: cls,
      date: String(request.examDate || "").replace(/-/g, ".")
    };

    setRegisteringRow(request.rowIndex);
    try {
      const r = await fetch(sheetsUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body)
      });
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { result: "error", message: text.substring(0, 200) }; }

      if (json.result === "success" || json.result === "ok") {
        const objCnt = Object.values(typesObj).filter(t => t === "obj").length;
        const subCnt = Object.values(typesObj).filter(t => t === "sub").length;
        const verify = (json.savedAnswers === qs.length) ? `\n✅ 서버 검증 OK — 행 #${json.rowIndex}에 ${json.savedAnswers}문항 저장됨` : "";
        alert(`✅ 학생앱 등록 완료!\n\n📚 ${cls}\n📝 ${qs.length}문항 (객관식 ${objCnt} · 주관식 ${subCnt})${verify}`);
        loadQueue();
      } else {
        alert(`❌ 등록 실패: ${json.message || "알 수 없음"}`);
      }
    } catch (e) {
      alert(`네트워크 오류: ${e.message}`);
    } finally {
      setRegisteringRow(null);
    }
  };

  // ── 요청 취소 (대기 상태인 것만) ──
  const handleCancel = async (request) => {
    if (!window.confirm(`이 예약을 취소하시겠습니까?\n\n📚 ${request.textbook}\n📅 ${request.examDate} ${request.examTime}`)) return;
    try {
      const r = await fetch(sheetsUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "cancel_exam_gen", rowIndex: request.rowIndex })
      });
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { result: "error", message: text.substring(0, 200) }; }

      if (json.result === "success" || json.result === "ok") {
        alert("✅ 예약 취소됨");
        loadQueue();
      } else {
        alert(`❌ 취소 실패: ${json.message || "알 수 없음"}`);
      }
    } catch (e) {
      alert(`네트워크 오류: ${e.message}`);
    }
  };

  // ════════════════════════════════════════════════════════════
  // 화면 1: 예약 폼
  // ════════════════════════════════════════════════════════════
  if (screen === "form") {
    const totalTypePct = selectedTypes.reduce((s, t) => s + t.percentage, 0);
    const pendingCount = queue.filter(q => q.status === "대기" || q.status === "생성중").length;
    const rangeSummary = rangeMode === "chapter"
      ? (selectedChapters.length > 0
          ? (selectedChapters.length > 3 ? `${selectedChapters.slice(0, 3).join(", ")} 외 ${selectedChapters.length - 3}개` : selectedChapters.join(", "))
          : (chapterFallbackText.trim() || "(미선택)"))
      : (pageFrom && pageTo ? `p.${pageFrom}-${pageTo}` : "(미입력)");
    const filteredBooks = bookCategory === "all"
      ? textbooks
      : textbooks.filter(b => b.category === bookCategory);

    return (
      <div style={S.wrap} className="fade-up">
        <div style={{ textAlign: "center", padding: "20px 0 12px" }}>
          <div style={{ fontSize: 36, marginBottom: 4 }}>📚</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: T.text, marginBottom: 4 }}>문제 생성 예약</h1>
          <p style={{ fontSize: 13, color: T.textMuted }}>클로드 큐 처리 · 고품질 문항 · 단일 세트 (v17)</p>
        </div>

        {/* 진행 상황 보기 버튼 (대기/생성중 카운트 표시) */}
        <button onClick={() => { setScreen("queue"); loadQueue(); }}
          style={{ ...S.btnO, width: "100%", marginBottom: 12, padding: "12px", fontSize: 14, fontWeight: 700 }}>
          📋 진행 상황 확인 {pendingCount > 0 && <span style={{ color: T.danger, marginLeft: 8 }}>(처리 중 {pendingCount}건)</span>}
        </button>

        {/* STEP 1: 교재 (★ v23.12 — Drive 자동 로드) */}
        <div style={S.card}>
          <div style={S.secLabel}>1. 교재 선택</div>

          {/* 카테고리 필터 */}
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6, fontWeight: 700 }}>📂 카테고리 필터</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <button onClick={() => { setBookCategory("all"); setShowAllBooks(false); }}
              style={{ padding: "8px 14px", borderRadius: 20, border: `1.5px solid ${bookCategory === "all" ? T.goldDark : T.border}`, background: bookCategory === "all" ? T.goldLight : T.white, color: bookCategory === "all" ? T.goldDark : T.textSub, fontWeight: bookCategory === "all" ? 700 : 500, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
              📚 전체 ({textbooks.length})
            </button>
            {Object.keys(AI_CAT_KR).map(cat => {
              const count = textbooks.filter(b => b.category === cat).length;
              return (
                <button key={cat} onClick={() => { setBookCategory(cat); setShowAllBooks(false); }}
                  style={{ padding: "8px 14px", borderRadius: 20, border: `1.5px solid ${bookCategory === cat ? T.goldDark : T.border}`, background: bookCategory === cat ? T.goldLight : T.white, color: bookCategory === cat ? T.goldDark : T.textSub, fontWeight: bookCategory === cat ? 700 : 500, fontSize: 13, cursor: "pointer", fontFamily: "inherit", opacity: count === 0 ? 0.5 : 1 }}>
                  {AI_CAT_KR[cat]} ({count})
                </button>
              );
            })}
          </div>

          {/* 교재 목록 */}
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6, fontWeight: 700 }}>
            📖 교재 ({filteredBooks.length}{bookCategory !== "all" ? ` / 전체 ${textbooks.length}` : ""})
            {textbooksLoading && <span style={{ marginLeft: 8, color: T.goldDark }}>⏳ 로딩 중...</span>}
          </div>
          {textbooksError && (
            <div style={{ padding: "8px 10px", background: T.dangerLight, borderRadius: 6, fontSize: 11, color: T.danger, marginBottom: 8, lineHeight: 1.5 }}>
              ⚠ {textbooksError}
            </div>
          )}
          {!textbooksLoading && filteredBooks.length === 0 ? (
            <div style={{ padding: "16px", background: T.bg, borderRadius: 6, fontSize: 12, color: T.textSub, textAlign: "center" }}>
              {bookCategory === "all" ? "Drive에서 교재를 찾을 수 없습니다." : `「${AI_CAT_KR[bookCategory]}」 카테고리의 교재가 없습니다. 다른 카테고리를 확인하거나 카테고리를 변경해주세요.`}
            </div>
          ) : (() => {
            /* ★ v23.14: 기본 5권 + 더보기 (45권도 안 부담스럽게) */
            const BOOK_LIMIT = 5;
            const visibleBooks = showAllBooks ? filteredBooks : filteredBooks.slice(0, BOOK_LIMIT);
            const hiddenCount = filteredBooks.length - visibleBooks.length;
            return (
              <>
                <div style={{ display: "grid", gap: 4, border: `1px solid ${T.borderLight}`, borderRadius: 6, padding: 4 }}>
                  {visibleBooks.map(b => {
                    const isSel = selectedBook?.id === b.id;
                    const isShowingCat = showCatChangeFor === b.id;
                    return (
                      <div key={b.id} style={{ position: "relative" }}>
                        <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
                          <button onClick={() => setSelectedBook(b)}
                            style={{ flex: 1, padding: "10px 12px", borderRadius: 6, border: `1.5px solid ${isSel ? T.goldDark : T.border}`, background: isSel ? T.goldLight : T.white, color: isSel ? T.goldDark : T.text, fontSize: 13, fontWeight: isSel ? 700 : 500, cursor: "pointer", fontFamily: "inherit", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                            {isSel && <span style={{ color: T.goldDark, fontWeight: 900 }}>✓</span>}
                            <span style={{ fontSize: 14 }}>{AI_CAT_KR[b.category]?.split(" ")[0] || "📄"}</span>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                          </button>
                          <button onClick={() => setShowCatChangeFor(isShowingCat ? null : b.id)}
                            title="카테고리 변경"
                            style={{ padding: "0 10px", borderRadius: 6, border: `1.5px solid ${isShowingCat ? T.goldDark : T.border}`, background: isShowingCat ? T.goldLight : T.white, color: T.textSub, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                            📂
                          </button>
                        </div>
                        {isShowingCat && (
                          <div style={{ marginTop: 4, padding: "6px 8px", background: T.bg, borderRadius: 6, border: `1px solid ${T.border}` }}>
                            <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 4 }}>카테고리 변경:</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {Object.keys(AI_CAT_KR).map(cat => (
                                <button key={cat} onClick={() => handleChangeCategory(b.id, cat)}
                                  style={{ padding: "4px 10px", borderRadius: 12, border: `1px solid ${b.category === cat ? T.goldDark : T.border}`, background: b.category === cat ? T.goldLight : T.white, color: b.category === cat ? T.goldDark : T.textSub, fontSize: 11, fontWeight: b.category === cat ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                                  {AI_CAT_KR[cat]}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {filteredBooks.length > BOOK_LIMIT && (
                  <button onClick={() => setShowAllBooks(o => !o)}
                    style={{ marginTop: 6, width: "100%", padding: "6px", borderRadius: 6, border: `1px dashed ${T.border}`, background: T.bg, color: T.textSub, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                    {showAllBooks ? `▲ 접기 (5권만 보기)` : `▼ 더 보기 (+${hiddenCount}권)`}
                  </button>
                )}
              </>
            );
          })()}

          {/* 선택된 교재 정보 */}
          {selectedBook && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: T.goldPale, borderRadius: 6, fontSize: 12, color: T.text, lineHeight: 1.6 }}>
              ✓ 선택됨: <strong>{selectedBook.name}</strong> <span style={{ color: T.textMuted }}>({AI_CAT_KR[selectedBook.category] || "분류 없음"})</span><br />
              <span style={{ fontSize: 11, color: T.textSub }}>💡 클로드가 이 교재 PDF를 분석해서 문제를 만듭니다.</span>
            </div>
          )}
        </div>

        {/* STEP 2: 범위 (★ v23.12 — Drive 자동 로드 챕터) */}
        <div style={S.card}>
          <div style={S.secLabel}>2. 범위</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button onClick={() => setRangeMode("chapter")} style={{ padding: "8px 16px", borderRadius: 20, border: `1.5px solid ${rangeMode === "chapter" ? T.goldDark : T.border}`, background: rangeMode === "chapter" ? T.goldLight : T.white, color: rangeMode === "chapter" ? T.goldDark : T.textSub, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>📖 챕터로</button>
            <button onClick={() => setRangeMode("page")} style={{ padding: "8px 16px", borderRadius: 20, border: `1.5px solid ${rangeMode === "page" ? T.goldDark : T.border}`, background: rangeMode === "page" ? T.goldLight : T.white, color: rangeMode === "page" ? T.goldDark : T.textSub, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>📄 페이지로</button>
          </div>
          {rangeMode === "chapter" ? (
            !selectedBook ? (
              <div style={{ padding: 16, background: T.bg, borderRadius: 6, fontSize: 12, color: T.textSub, textAlign: "center" }}>
                ⬆ 먼저 교재를 선택하세요
              </div>
            ) : chaptersLoading ? (
              <div style={{ padding: 16, background: T.bg, borderRadius: 6, fontSize: 12, color: T.goldDark, textAlign: "center" }}>
                ⏳ 챕터 분석 중...
              </div>
            ) : (
              <>
                {/* ★ v23.13: 모드 토글 — 자동 로드 vs 직접 입력 */}
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <button onClick={() => setChapterManualMode(false)}
                    style={{ padding: "6px 12px", borderRadius: 16, border: `1.5px solid ${!chapterManualMode ? T.goldDark : T.border}`, background: !chapterManualMode ? T.goldLight : T.white, color: !chapterManualMode ? T.goldDark : T.textSub, fontSize: 12, fontWeight: !chapterManualMode ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                    ☑ 자동 로드 ({chapters.length})
                  </button>
                  <button onClick={() => setChapterManualMode(true)}
                    style={{ padding: "6px 12px", borderRadius: 16, border: `1.5px solid ${chapterManualMode ? T.goldDark : T.border}`, background: chapterManualMode ? T.goldLight : T.white, color: chapterManualMode ? T.goldDark : T.textSub, fontSize: 12, fontWeight: chapterManualMode ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                    ✏ 직접 입력
                  </button>
                </div>

                {chapterManualMode || chapters.length === 0 ? (
                  /* 직접 입력 모드 */
                  <>
                    {chapters.length === 0 && !chapterManualMode && (
                      <div style={{ padding: "8px 10px", background: T.dangerLight, borderRadius: 6, fontSize: 11, color: T.danger, marginBottom: 8, lineHeight: 1.5 }}>
                        ⚠ 이 교재의 챕터를 자동 분석하지 못했습니다. 수동으로 입력해주세요.
                      </div>
                    )}
                    <input style={S.inp} type="text" value={chapterFallbackText}
                      onChange={e => setChapterFallbackText(e.target.value)}
                      placeholder="예: Ch01, Ch02, Ch05 또는 1단원~3단원" />
                    <div style={{ marginTop: 8, fontSize: 10, color: T.textMuted, lineHeight: 1.5 }}>
                      💡 쉼표(,) 또는 세미콜론(;)으로 여러 챕터를 구분하세요. 자유롭게 입력 가능합니다.
                    </div>
                    {chapters.length > 0 && (
                      <div style={{ marginTop: 10, padding: "6px 10px", background: T.bg, borderRadius: 4, fontSize: 10, color: T.textMuted, lineHeight: 1.5 }}>
                        💡 참고용 자동 로드 챕터: {chapters.slice(0, 5).map(c => c.name).join(", ")}{chapters.length > 5 ? ` 외 ${chapters.length - 5}개` : ""}
                      </div>
                    )}
                  </>
                ) : (
                  /* 자동 로드 체크박스 모드 */
                  <>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
                      <button onClick={() => setSelectedChapters(chapters.map(c => c.name))}
                        style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.white, color: T.textSub, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                        ✓ 전체 선택
                      </button>
                      <button onClick={() => setSelectedChapters([])}
                        style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.white, color: T.textSub, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                        ✕ 전체 해제
                      </button>
                      <div style={{ marginLeft: "auto", fontSize: 11, color: T.textMuted }}>
                        {selectedChapters.length} / {chapters.length} 선택됨
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4, maxHeight: 320, overflowY: "auto", border: `1px solid ${T.borderLight}`, borderRadius: 6, padding: 4 }}>
                      {chapters.map(ch => {
                        const checked = selectedChapters.includes(ch.name);
                        return (
                          <button key={ch.id} onClick={() => toggleChapter(ch.name)}
                            style={{ padding: "8px 10px", borderRadius: 4, border: `1.5px solid ${checked ? T.goldDark : T.border}`, background: checked ? T.goldLight : T.white, color: checked ? T.goldDark : T.text, fontSize: 12, fontWeight: checked ? 700 : 500, cursor: "pointer", fontFamily: "inherit", textAlign: "left", display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 900 }}>{checked ? "☑" : "☐"}</span>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 10, color: T.textMuted, lineHeight: 1.5 }}>
                      💡 자동 분석된 챕터 목록입니다. 원하는 목록이 안 보이면 ✏ 직접 입력 으로 전환하세요.
                    </div>
                  </>
                )}
              </>
            )
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="number" placeholder="시작" value={pageFrom} onChange={e => setPageFrom(e.target.value)} style={{ ...S.inp, width: 90 }} />
              <span>~</span>
              <input type="number" placeholder="끝" value={pageTo} onChange={e => setPageTo(e.target.value)} style={{ ...S.inp, width: 90 }} />
              <span style={{ color: T.textMuted, fontSize: 13 }}>p.</span>
            </div>
          )}
        </div>

        {/* ★ v23.14: STEP 2.5 — 1회용 PDF (축소형 + 접기) */}
        <div style={{ ...S.card, padding: "8px 12px" }}>
          <button onClick={() => setPdfPanelOpen(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textSub }}>
              🎫 1회용 PDF 첨부 {pdfFiles.length > 0 && <span style={{ color: T.goldDark }}>({pdfFiles.length}개)</span>}
              <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 400, marginLeft: 6 }}>(선택)</span>
            </span>
            <span style={{ fontSize: 12, color: T.textMuted }}>{pdfPanelOpen ? "▲" : "▼"}</span>
          </button>
          {pdfPanelOpen && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.borderLight}` }}>
              <div style={{ fontSize: 10, color: T.textSub, marginBottom: 6, lineHeight: 1.5 }}>
                💡 이번 생성에만 사용 (Drive 저장 X) · 최대 3개 · 각 10MB
              </div>
              <input type="file" accept="application/pdf,.pdf" multiple
                onChange={e => { handlePdfUpload(e.target.files); e.target.value = ''; }}
                style={{ display: "block", marginBottom: 6, fontSize: 11 }} />
              {pdfFiles.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {pdfFiles.map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: T.bg, borderRadius: 4, marginBottom: 3, fontSize: 11 }}>
                      <span>🎫</span>
                      <span style={{ flex: 1, color: T.text, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      <span style={{ color: T.textMuted, fontSize: 10 }}>{f.sizeMB}MB</span>
                      <button onClick={() => removePdf(i)}
                        style={{ padding: "1px 6px", borderRadius: 3, border: `1px solid ${T.danger}`, background: T.white, color: T.danger, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!pdfPanelOpen && pdfFiles.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 10, color: T.accent, fontWeight: 600 }}>
              ✓ {pdfFiles.length}개 첨부됨
            </div>
          )}
        </div>

        {/* STEP 3: 시험 유형 + 세부 비중 슬라이더 */}
        <div style={S.card}>
          <div style={S.secLabel}>3. 시험 유형 <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 400 }}>(여러 개 선택 가능)</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 12 }}>
            {Object.keys(AI_TYPE_META).map(type => {
              const m = AI_TYPE_META[type];
              const active = selectedTypes.some(t => t.type === type);
              return (
                <button key={type} onClick={() => toggleType(type)}
                  style={{ padding: "14px 4px", borderRadius: 10, border: `2px solid ${active ? T.goldDark : T.border}`, background: active ? T.goldLight : T.white, cursor: "pointer", fontFamily: "inherit", position: "relative", textAlign: "center" }}>
                  {active && <span style={{ position: "absolute", top: 4, right: 6, color: T.goldDark, fontWeight: 900, fontSize: 12 }}>✓</span>}
                  <div style={{ fontSize: 20, marginBottom: 2 }}>{m.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: active ? T.goldDark : T.text }}>{m.name}</div>
                </button>
              );
            })}
          </div>
          {selectedTypes.map((t, idx) => {
            const m = AI_TYPE_META[t.type];
            return (
              <div key={t.type} style={{ padding: 12, background: T.bg, borderRadius: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 16 }}>{m.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{m.name}</span>
                  <input type="range" min="0" max="100" step="5" value={t.percentage} disabled={selectedTypes.length === 1}
                    onChange={e => setTypePct(idx, e.target.value)} style={{ flex: 1, accentColor: T.goldDark }} />
                  <span style={{ fontWeight: 700, color: T.goldDark, minWidth: 36, textAlign: "right", fontSize: 13 }}>{t.percentage}%</span>
                </div>
                <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 6 }}>세부 유형 (체크하면 비중 조절 가능)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                  {AI_SUBTYPES[t.type].map(sn => {
                    const checked = t.subtypes.some(s => s.name === sn);
                    return (
                      <button key={sn} onClick={() => toggleSubtype(idx, sn)}
                        style={{ padding: "4px 10px", borderRadius: 14, border: `1px solid ${checked ? T.goldDark : T.border}`, background: checked ? T.goldLight : T.white, color: checked ? T.goldDark : T.textSub, fontSize: 11, fontWeight: checked ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                        {checked ? "✓ " : ""}{sn}
                      </button>
                    );
                  })}
                </div>
                {t.subtypes.length >= 1 && (
                  <div style={{ padding: 10, background: T.white, borderRadius: 6, border: `1px dashed ${T.border}` }}>
                    <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, marginBottom: 8 }}>
                      📊 선택한 세부 유형 비중 ({t.subtypes.length}개)
                    </div>
                    {t.subtypes.map((s, sIdx) => {
                      const typeTotal = Math.round((questionCount * t.percentage) / 100);
                      const subCount = Math.round((typeTotal * s.percentage) / 100);
                      return (
                        <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: T.text, flex: 1, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.name}
                          </span>
                          <input type="range" min="0" max="100" step="5" value={s.percentage}
                            disabled={t.subtypes.length === 1}
                            onChange={e => setSubtypePct(idx, sIdx, e.target.value)}
                            style={{ width: 90, accentColor: m.color }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: m.color, minWidth: 36, textAlign: "right" }}>
                            {s.percentage}%
                          </span>
                          <span style={{ fontSize: 10, color: T.textMuted, minWidth: 38, textAlign: "right" }}>
                            ≈{subCount}개
                          </span>
                        </div>
                      );
                    })}
                    {t.subtypes.length > 1 && (() => {
                      const sumSub = t.subtypes.reduce((acc, s) => acc + s.percentage, 0);
                      return (
                        <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: sumSub === 100 ? T.accent : T.danger, textAlign: "right" }}>
                          합계 {sumSub}% {sumSub === 100 ? "✓" : "(자동 보정 중)"}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
          {selectedTypes.length > 1 && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: totalTypePct === 100 ? T.accentLight : T.dangerLight, borderRadius: 6, fontSize: 11, fontWeight: 700, color: totalTypePct === 100 ? T.accent : T.danger, textAlign: "right" }}>
              합계 {totalTypePct}% {totalTypePct === 100 ? "✓" : "(100%로 맞춰주세요)"}
            </div>
          )}
        </div>

        {/* STEP 4: 문제 수 */}
        <div style={S.card}>
          <div style={S.secLabel}>4. 문제 수</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {[10, 15, 20, 25, 30, 40, 50].map(n => (
              <button key={n} onClick={() => { setQuestionCount(n); setCustomCountMode(false); }}
                style={{ padding: "8px 16px", borderRadius: 20, border: `1.5px solid ${!customCountMode && questionCount === n ? T.goldDark : T.border}`, background: !customCountMode && questionCount === n ? T.goldLight : T.white, color: !customCountMode && questionCount === n ? T.goldDark : T.textSub, fontWeight: !customCountMode && questionCount === n ? 700 : 500, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                {n}
              </button>
            ))}
            <button onClick={() => setCustomCountMode(true)}
              style={{ padding: "8px 16px", borderRadius: 20, border: `1.5px solid ${customCountMode ? T.goldDark : T.border}`, background: customCountMode ? T.goldLight : T.white, color: customCountMode ? T.goldDark : T.textSub, fontWeight: customCountMode ? 700 : 500, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
              ✏️ 직접 입력
            </button>
          </div>
          {customCountMode && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <input type="number" min="1" max="150" value={questionCount}
                onChange={e => { const v = Math.max(1, Math.min(150, parseInt(e.target.value) || 1)); setQuestionCount(v); }}
                style={{ ...S.inp, width: 120 }} placeholder="문제수" />
              <span style={{ fontSize: 12, color: T.textSub }}>문제 (1~150)</span>
            </div>
          )}
        </div>

        {/* STEP 5: 객/서 비율 (★ v23.15 — 막대바 50% 축소) */}
        <div style={S.card}>
          <div style={S.secLabel}>5. 객관식 / 서술형 비율</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 360 }}>
            <span style={{ fontSize: 11, color: T.textSub, minWidth: 32 }}>서술형</span>
            <input type="range" min="0" max="100" step="10" value={mcRatio} onChange={e => setMcRatio(parseInt(e.target.value))} style={{ flex: 1, accentColor: T.goldDark }} />
            <span style={{ fontSize: 11, color: T.textSub, minWidth: 32 }}>객관식</span>
            <span style={{ fontWeight: 700, color: T.goldDark, minWidth: 36, textAlign: "right", fontSize: 13 }}>{mcRatio}%</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: T.textSub }}>
            👉 객관식 <strong style={{ color: T.goldDark }}>{mcCount}</strong>문제 · 서술형 <strong>{ssCount}</strong>문제
          </div>
        </div>

        {/* STEP 6: 난이도 (★ v23.15 — 막대바·전체 색깔 바 모두 축소) */}
        <div style={S.card}>
          <div style={S.secLabel}>6. 난이도 분포</div>
          {/* 전체 색깔 바 (★ v23.15 — 최대 너비 360px) */}
          <div style={{ maxWidth: 360 }}>
            <div style={{ height: 8, borderRadius: 4, overflow: "hidden", display: "flex", marginBottom: 6 }}>
              <div style={{ flex: difficulty.easy || 0.01, background: "#52C41A" }} />
              <div style={{ flex: difficulty.mid || 0.01, background: "#FAAD14" }} />
              <div style={{ flex: difficulty.hard || 0.01, background: "#FF4D4F" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 700, marginBottom: 12 }}>
              <span style={{ color: "#52C41A" }}>쉬움 {difficulty.easy}%</span>
              <span style={{ color: "#FAAD14" }}>보통 {difficulty.mid}%</span>
              <span style={{ color: "#FF4D4F" }}>어려움 {difficulty.hard}%</span>
            </div>
          </div>
          {/* 슬라이더 3개 (★ v23.15 — maxWidth 360px) */}
          {["easy", "mid", "hard"].map(level => {
            const colors = { easy: "#52C41A", mid: "#FAAD14", hard: "#FF4D4F" };
            const names = { easy: "쉬움", mid: "보통", hard: "어려움" };
            return (
              <div key={level} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, maxWidth: 360 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 14, background: colors[level] + "22", color: colors[level], minWidth: 48, textAlign: "center" }}>{names[level]}</span>
                <input type="range" min="0" max="100" step="5" value={difficulty[level]} onChange={e => diffChanged(level, e.target.value)} style={{ flex: 1, accentColor: colors[level] }} />
                <span style={{ fontWeight: 700, fontSize: 12, color: colors[level], minWidth: 36, textAlign: "right" }}>{difficulty[level]}%</span>
              </div>
            );
          })}
        </div>

        {/* STEP 7: 출제 스타일 */}
        <div style={S.card}>
          <div style={S.secLabel}>7. 출제 스타일 <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 400 }}>(선택)</span></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { val: "", label: "기본형", desc: "균형 잡힌 출제" },
              { val: "이론편", label: "📘 이론편", desc: "개념·문법 위주" },
              { val: "실전편", label: "📝 실전편", desc: "응용·종합 문제" },
              { val: "혼합", label: "📚 혼합", desc: "이론 + 실전" }
            ].map(opt => (
              <button key={opt.val} onClick={() => setSetType(opt.val)}
                title={opt.desc}
                style={{ padding: "8px 14px", borderRadius: 18, border: `1.5px solid ${setType === opt.val ? T.goldDark : T.border}`, background: setType === opt.val ? T.goldLight : T.white, color: setType === opt.val ? T.goldDark : T.textSub, fontSize: 12, fontWeight: setType === opt.val ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* STEP 8: 학생앱 등록 정보 (★ v23.15 — 시험 등록 양식과 100% 동일) */}
        <div style={S.card}>
          <div style={S.secLabel}>8. 학생앱 등록 정보</div>

          {/* 과목·학년 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>과목 *</div>
              <select style={S.inp} value={regSubject} onChange={e => setRegSubject(e.target.value)}>
                {SUBJECTS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>학년 *</div>
              <select style={S.inp} value={regGrade} onChange={e => setRegGrade(e.target.value)}>
                {GRADES.map(g => <option key={g}>{g}</option>)}
              </select>
            </div>
          </div>

          {/* ★ v23.15: 레벨/학교 카테고리 + 다중선택 (시험 등록과 동일) */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>레벨 / 학교 * <span style={{ color: T.textMuted, fontWeight: 400 }}>(같은 시험지 = 여러 학교 다중선택)</span></div>
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              {LV_CATS.map(c => {
                const a = regLevelCat === c.key;
                return (
                  <button key={c.key} onClick={() => { setRegLevelCat(c.key); setRegLevelMulti([]); setRegLevelCustom(""); }}
                    style={{ padding: "6px 10px", fontSize: 11, fontWeight: a ? 700 : 500, borderRadius: 8, border: `1.5px solid ${a ? T.goldDark : T.border}`, background: a ? T.goldDark : T.white, color: a ? T.white : T.textSub, cursor: "pointer", fontFamily: "inherit" }}>
                    {c.label}
                  </button>
                );
              })}
            </div>
            {regLevelCat !== "etc" ? (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(LV_CATS.find(c => c.key === regLevelCat)?.opts || []).map(o => {
                    const a = regLevelMulti.includes(o);
                    return (
                      <button key={o} onClick={() => setRegLevelMulti(p => p.includes(o) ? p.filter(x => x !== o) : [...p, o])}
                        style={{ padding: "5px 10px", borderRadius: 14, border: `1.5px solid ${a ? T.goldDark : T.border}`, background: a ? T.goldDark : T.white, color: a ? T.white : T.textSub, fontSize: 11, fontWeight: a ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                        {a ? "☑ " : "☐ "}{o}
                      </button>
                    );
                  })}
                </div>
                {regLevelMulti.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 10, color: T.textSub }}>
                    선택됨: <strong style={{ color: T.goldDark }}>{regLevelMulti.join(" + ")}</strong>
                    <button onClick={() => setRegLevelMulti([])} style={{ marginLeft: 8, padding: "2px 8px", fontSize: 10, borderRadius: 4, border: `1px solid ${T.border}`, background: T.white, color: T.textSub, cursor: "pointer", fontFamily: "inherit" }}>초기화</button>
                  </div>
                )}
                {regLevelMulti.length >= 2 && (
                  <div style={{ marginTop: 6, padding: "6px 10px", background: "#FFF8E6", border: `1px solid ${T.goldMuted}`, borderRadius: 6, fontSize: 10, color: T.textSub, lineHeight: 1.5 }}>
                    ⚠ <strong>{regLevelMulti.length}개</strong>를 하나의 반으로 등록. 반드시 <strong>같은 시험지</strong>를 공유할 때만 사용하세요.
                  </div>
                )}
              </>
            ) : (
              <input style={S.inp} type="text" value={regLevelCustom} onChange={e => setRegLevelCustom(e.target.value)} placeholder="직접 입력 (예: 특별반)" />
            )}
          </div>

          {/* 선생님 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>선생님 *</div>
            <select style={S.inp} value={regTeacher} onChange={e => setRegTeacher(e.target.value)}>
              <option value="">-- 선택 --</option>
              {(teacherList || []).map(t => <option key={t.name || t["이름"]}>{t.name || t["이름"]}</option>)}
            </select>
          </div>

          {/* ★ v23.14: 예상 응시 인원 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>예상 응시 인원 * <span style={{ color: T.textMuted, fontWeight: 400 }}>(실장님 프린트 장수 산출)</span></div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input style={{ ...S.inp, width: 110 }} type="number" min="0" max="200" value={studentCount}
                onChange={e => setStudentCount(e.target.value)} placeholder="예: 12" />
              <span style={{ fontSize: 12, color: T.textSub }}>명</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: T.danger, lineHeight: 1.4 }}>
              ⚠️ 인원을 입력해야 실장님이 시험지를 몇 장 프린트할지 알 수 있습니다.
            </div>
          </div>

          {/* ★ v23.14: 주관식 채점 모드 */}
          {ssCount > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>📝 주관식 채점 모드 <span style={{ color: T.textMuted, fontWeight: 400 }}>(서술형 {ssCount}문제 자동 채점 기준)</span></div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  { val: "auto", label: "자동 추천 ✨", desc: "유형에 따라 자동" },
                  { val: "strict", label: "엄격 ⭐", desc: "단어/영작 (정확도 중심)" },
                  { val: "flexible", label: "유연", desc: "해석/번역 (의역 인정)" }
                ].map(opt => (
                  <button key={opt.val} onClick={() => setSubjectiveMode(opt.val)}
                    title={opt.desc}
                    style={{ padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${subjectiveMode === opt.val ? T.goldDark : T.border}`, background: subjectiveMode === opt.val ? T.goldLight : T.white, color: subjectiveMode === opt.val ? T.goldDark : T.textSub, fontSize: 11, fontWeight: subjectiveMode === opt.val ? 700 : 500, cursor: "pointer", fontFamily: "inherit", flex: 1, minWidth: 0, textAlign: "center", lineHeight: 1.3 }}>
                    <div>{opt.label}</div>
                    <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2, color: subjectiveMode === opt.val ? T.goldDeep : T.textMuted }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 시험 날짜 / 시각 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>시험 날짜 *</div>
              <input style={S.inp} type="date" value={examDate} onChange={e => setExamDate(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>시험 시각 *</div>
              <input style={S.inp} type="time" value={examTime} onChange={e => setExamTime(e.target.value)} />
            </div>
          </div>

          {/* ★ v23.14: 시간 그리드 (주중/주말) */}
          <div style={{ background: T.bg, borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>주중 (월~금)</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
              {["17:00","18:00","19:00","20:00","21:00","22:00"].map(t => (
                <button key={t} onClick={() => setExamTime(t)}
                  style={{ padding: "4px 10px", borderRadius: 12, border: `1px solid ${examTime === t ? T.goldDark : T.border}`, background: examTime === t ? T.goldLight : T.white, color: examTime === t ? T.goldDark : T.textSub, fontSize: 11, fontWeight: examTime === t ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                  {t}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 4, fontWeight: 700 }}>주말 (토)</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
              {["11:00","12:00","13:00","14:00","15:00","16:00"].map(t => (
                <button key={t} onClick={() => setExamTime(t)}
                  style={{ padding: "4px 10px", borderRadius: 12, border: `1px solid ${examTime === t ? T.goldDark : T.border}`, background: examTime === t ? T.goldLight : T.white, color: examTime === t ? T.goldDark : T.textSub, fontSize: 11, fontWeight: examTime === t ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                  {t}
                </button>
              ))}
            </div>
            <button onClick={() => {
              const d = new Date();
              setExamTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`);
            }}
              style={{ padding: "4px 10px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.white, color: T.textSub, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
              🕐 지금
            </button>
          </div>
        </div>

        {/* STEP 9: 추가 메모 (선택) */}
        <div style={S.card}>
          <div style={S.secLabel}>9. 추가 메모 <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 400 }}>(선택 — 클로드에게 특별 지시)</span></div>
          <textarea value={memo} onChange={e => setMemo(e.target.value)}
            placeholder="예: 어려운 문법 위주로 출제해주세요. 빈칸 추론을 많이 넣어주세요."
            style={{ ...S.inp, minHeight: 60, fontFamily: "inherit", resize: "vertical" }} />
        </div>

        {/* STEP 10: 완료 후 처리 옵션 */}
        <div style={S.card}>
          <div style={S.secLabel}>10. 완료 후 처리</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setAutoRegister(true)}
              style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${autoRegister ? T.goldDark : T.border}`, background: autoRegister ? T.goldLight : T.white, color: autoRegister ? T.goldDark : T.textSub, fontSize: 12, fontWeight: autoRegister ? 700 : 500, cursor: "pointer", fontFamily: "inherit", flex: 1, textAlign: "center" }}>
              {autoRegister && "✓ "}🚀 자동 등록<br /><span style={{ fontSize: 10, fontWeight: 400 }}>완료 즉시 학생앱에</span>
            </button>
            <button onClick={() => setAutoRegister(false)}
              style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${!autoRegister ? T.goldDark : T.border}`, background: !autoRegister ? T.goldLight : T.white, color: !autoRegister ? T.goldDark : T.textSub, fontSize: 12, fontWeight: !autoRegister ? 700 : 500, cursor: "pointer", fontFamily: "inherit", flex: 1, textAlign: "center" }}>
              {!autoRegister && "✓ "}👁 수동 검토<br /><span style={{ fontSize: 10, fontWeight: 400 }}>완료 후 확인하고 등록</span>
            </button>
          </div>
        </div>

        {/* 신청 버튼 */}
        <div style={S.card}>
          <div style={{ padding: 12, background: T.goldPale, border: `1px solid ${T.gold}`, borderRadius: 10, marginBottom: 12, fontSize: 12, color: T.textSub, lineHeight: 1.7 }}>
            📚 <strong>{selectedBook?.name || "(교재 미선택)"}</strong> · {rangeSummary}{pdfFiles.length > 0 ? ` · 🎫 PDF ${pdfFiles.length}개` : ""}<br />
            📝 {questionCount}문제 (객관식 {mcCount} · 서술형 {ssCount}) · {regSubject} {regGrade} {regLevel}반<br />
            📅 {examDate} {examTime} · 👤 {regTeacher || "(미선택)"}
          </div>
          <button onClick={handleSubmit} disabled={submitting}
            style={{ ...S.btnG, width: "100%", opacity: submitting ? 0.7 : 1, cursor: submitting ? "wait" : "pointer", padding: 14, fontSize: 15 }}>
            {submitting ? "📡 예약 등록 중..." : "📋 예약 신청하기"}
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // 화면 2: 큐 모니터링
  // ════════════════════════════════════════════════════════════
  if (screen === "queue") {
    const statusMeta = {
      "대기":   { color: "#FAAD14", bg: "#FFFBE6", icon: "⏳", label: "대기 중" },
      "생성중": { color: "#1890FF", bg: "#E6F7FF", icon: "🤖", label: "생성 중" },
      "완료":   { color: "#52C41A", bg: "#F6FFED", icon: "✅", label: "완료" },
      "실패":   { color: "#FF4D4F", bg: "#FFF1F0", icon: "❌", label: "실패" }
    };

    // ★ v23.14: 진행상황 그룹화 — 오늘/어제 vs 과거
    const todayY = new Date(); todayY.setHours(0,0,0,0);
    const yest = new Date(todayY); yest.setDate(yest.getDate() - 1);
    const cutoffMs = yest.getTime();

    const recentQueue = queue.filter(q => {
      const d = q.examDate ? new Date(q.examDate).getTime() : (q.requestedAt ? new Date(q.requestedAt).getTime() : 0);
      const isActive = q.status === "대기" || q.status === "생성중" || q.status === "실패";
      return isActive || d >= cutoffMs;
    });
    const pastQueue = queue.filter(q => {
      const d = q.examDate ? new Date(q.examDate).getTime() : 0;
      const isActive = q.status === "대기" || q.status === "생성중" || q.status === "실패";
      return !isActive && d < cutoffMs;
    });

    // 그룹: examDate별로 묶기
    const groupByDate = (items) => {
      const groups = {};
      items.forEach(q => {
        const k = (q.examDate || q.requestedAt || "").substring(0, 10) || "(날짜 없음)";
        if (!groups[k]) groups[k] = [];
        groups[k].push(q);
      });
      // 같은 날짜 안에서 시간순 정렬 (examTime 기준)
      Object.keys(groups).forEach(k => {
        groups[k].sort((a, b) => String(a.examTime || "").localeCompare(String(b.examTime || "")));
      });
      // 날짜 키를 최신순으로 정렬
      return Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(k => ({ date: k, items: groups[k] }));
    };

    const formatDate = (d) => {
      if (!d || d === "(날짜 없음)") return "(날짜 없음)";
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return d;
      const [_, yy, mm, dd] = m;
      const cmp = new Date(`${yy}-${mm}-${dd}`); cmp.setHours(0,0,0,0);
      const dayDiff = Math.round((cmp - todayY) / 86400000);
      const labels = { 0: "오늘", 1: "내일", "-1": "어제", "-2": "그저께" };
      const label = labels[dayDiff] || (dayDiff > 0 ? `${dayDiff}일 뒤` : `${-dayDiff}일 전`);
      return `${yy}.${mm}.${dd} (${label})`;
    };

    // 카드 1개 렌더링
    const renderCard = (req, i) => {
      const meta = statusMeta[req.status] || statusMeta["대기"];
      const isDone = req.status === "완료";
      const hasResult = isDone && req.answerData?.sets?.[0]?.questions?.length > 0;
      const elapsed = req.requestedAt ? (() => {
        const diff = Math.floor((Date.now() - new Date(req.requestedAt).getTime()) / 1000);
        if (diff < 60) return `${diff}초 전`;
        if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
        return `${Math.floor(diff / 86400)}일 전`;
      })() : "";
      return (
        <div key={req.rowIndex || i} style={{ padding: 12, background: T.white, border: `1px solid ${T.borderLight}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 8, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ padding: "2px 10px", borderRadius: 12, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 700 }}>
              {meta.icon} {meta.label}
            </span>
            <span style={{ fontSize: 11, color: T.textMuted }}>{elapsed}</span>
            {req.examTime && <span style={{ fontSize: 11, color: T.goldDark, fontWeight: 600 }}>🕐 {req.examTime}</span>}
            <span style={{ marginLeft: "auto", fontSize: 10, color: T.textMuted }}>#{req.rowIndex}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            🇬🇧 {req.targetClass || "?"}<span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: T.textSub }}>· 문제생성기 · 세트A</span>
          </div>
          <div style={{ fontSize: 12, color: T.textSub, marginBottom: 4, lineHeight: 1.6 }}>
            👤 {req.teacher || "?"} · 📚 {req.textbook || "?"}<br />
            <span style={{ fontSize: 11, color: T.textMuted }}>{req.rangeDesc || "(범위 미설정)"}</span><br />
            📝 {req.questionCount || "?"}문항 (객관식 {Math.round((req.questionCount || 0) * (req.mcRatio || 0) / 100)} · 서술형 {(req.questionCount || 0) - Math.round((req.questionCount || 0) * (req.mcRatio || 0) / 100)})
          </div>
          {req.answerData?.error && (
            <div style={{ padding: 8, background: "#FFF1F0", border: `1px solid ${T.danger}`, borderRadius: 6, fontSize: 11, color: T.danger, marginTop: 6 }}>
              ⚠️ 오류: {req.answerData.error}
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {isDone && hasResult && (
              <>
                <button onClick={() => handleManualRegister(req)} disabled={registeringRow === req.rowIndex}
                  style={{ ...S.btnG, flex: 1, minWidth: 130, fontSize: 12, padding: "6px 12px", opacity: registeringRow === req.rowIndex ? 0.5 : 1 }}>
                  {registeringRow === req.rowIndex ? "📡 등록 중..." : "📚 학생앱에 등록"}
                </button>
                {req.resultFileId && (
                  <button onClick={() => window.open(`https://drive.google.com/file/d/${req.resultFileId}/view`, "_blank")}
                    style={{ ...S.btnO, fontSize: 11, padding: "6px 10px" }}>
                    📄 JSON
                  </button>
                )}
              </>
            )}
            {req.status === "대기" && (
              <button onClick={() => handleCancel(req)} style={{ ...S.btnO, fontSize: 11, padding: "6px 12px", borderColor: T.danger, color: T.danger }}>
                🚫 예약 취소
              </button>
            )}
            {isDone && !hasResult && (
              <div style={{ flex: 1, padding: 6, background: T.bg, borderRadius: 6, fontSize: 11, color: T.textMuted, textAlign: "center" }}>
                결과 데이터 없음
              </div>
            )}
          </div>
        </div>
      );
    };

    const recentGroups = groupByDate(recentQueue);
    const pastGroups = groupByDate(pastQueue);

    return (
      <div style={S.wrap} className="fade-up">
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text }}>📋 진행 상황</h2>
          <p style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>10초마다 자동 새로고침 · 오늘/어제만 표시</p>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setScreen("form")} style={{ ...S.btnO, flex: 1 }}>← 새 예약 만들기</button>
          <button onClick={loadQueue} disabled={loadingQueue} style={{ ...S.btnO, flex: 1, opacity: loadingQueue ? 0.5 : 1 }}>
            {loadingQueue ? "🔄 새로고침 중..." : "🔄 지금 새로고침"}
          </button>
        </div>

        {recentQueue.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: T.textMuted, background: T.bg, borderRadius: 10 }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>📭</div>
            <p style={{ fontSize: 14 }}>최근 예약된 요청이 없습니다.</p>
            <button onClick={() => setScreen("form")} style={{ ...S.btnG, padding: "8px 24px", marginTop: 12 }}>새 예약 만들기</button>
          </div>
        ) : (
          /* 📅 날짜별 그룹 — 오늘의 현황과 같은 UI */
          recentGroups.map(g => (
            <div key={g.date} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: T.goldPale, borderRadius: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: T.goldDark }}>🕐 {formatDate(g.date)}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: T.textSub, fontWeight: 600 }}>{g.items.length}건</span>
              </div>
              {g.items.map((q, i) => renderCard(q, i))}
            </div>
          ))
        )}

        {/* ★ v23.14: 과거 데이터 — 접힌 채로 별도 분리 */}
        {pastQueue.length > 0 && (
          <details style={{ marginTop: 20, padding: 12, background: T.bg, borderRadius: 8, border: `1px solid ${T.borderLight}` }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: T.textSub, padding: "4px 0" }}>
              📚 과거 완료 데이터 ({pastQueue.length}건) — 클릭해서 펼치기
            </summary>
            <div style={{ marginTop: 12 }}>
              {pastGroups.map(g => (
                <div key={g.date} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, padding: "4px 8px", background: T.white, borderRadius: 6, marginBottom: 6 }}>
                    📅 {formatDate(g.date)} <span style={{ marginLeft: 6, color: T.textMuted, fontWeight: 400 }}>({g.items.length}건)</span>
                  </div>
                  {g.items.map((q, i) => renderCard(q, i))}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

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
  // ★ v23.19 (2026-05-13): 선생님 이름 안전장치 — JSON 데이터 표시 차단
  //   (옛 GAS 버그로 P열에 JSON 들어간 데이터 대응. GAS v25.2 + repairStudentTeacherColumn() 실행으로 근본 해결)
  const safeTeacher = (t) => {
    if (!t) return "";
    const s = String(t).trim();
    if (s.charAt(0) === "[" || s.charAt(0) === "{") return "";
    if (s.length > 80) return "";  // 정상 선생님 이름은 80자 이하
    return s;
  };
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
    out.push(row("시험 정보", `${c.subject||""} ${c.grade||""} ${c.level||""}반`, c.examType||"", `${c.date||""}`, `담당: ${safeTeacher(c.teacher)||"-"}`, `응시: ${c.total||0}명`));
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
    lines.push(`<tr><td colspan="6" class="meta"><b>${esc(c.subject)} ${esc(c.grade)} ${esc(c.level||"")}반 · ${esc(c.examType)}</b> | 📅 ${esc(c.date)} | 👨‍🏫 ${esc(safeTeacher(c.teacher)||"-")} | 응시 ${c.total}명</td></tr>`);
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
    lines.push(`📅 ${esc(c.date)} &nbsp;&nbsp; 👨‍🏫 ${esc(safeTeacher(c.teacher)||"-")} &nbsp;&nbsp; 응시: ${c.total}명</div>`);
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
  // ★ v23.17: Top 7 어려운 문항 PDF (오답노트 인쇄용)
  //   - 영어: 텍스트 기반 오답노트 (학생들이 자주 틀린 7문항 + 풀이 + 선택지 분석)
  //   - 수학: Top 7 문항번호 안내 + 학원에서 원본 시험지 첨부
  //   GAS view_answer_key 호출하여 explanations(choiceExplanations + gradingGuide) 수집
  const downloadTop7Pdf = async (c)=>{
    // ★ v23.18 (2026-05-13): 5명 미만 응시 시에도 학생 개인 오답 데이터로 PDF 생성
    //   c.hardest 가 비어있으면 c.students[].wrongQs 를 집계해 pseudo-hardest 생성
    let hardest = (c.hardest && c.hardest.length > 0) ? c.hardest.slice() : null;
    if (!hardest) {
      // students 배열에서 wrongQs 집계
      const wrongCnt = {};
      let totalStudents = 0;
      (c.students || []).forEach(s => {
        totalStudents++;
        (s.wrongQs || []).forEach(q => {
          wrongCnt[q] = (wrongCnt[q] || 0) + 1;
        });
      });
      if (totalStudents === 0) {
        alert("응시한 학생이 없어요. 학생이 답안 제출 후 다시 시도해주세요.");
        return;
      }
      const list = Object.keys(wrongCnt).map(q => ({
        q: Number(q),
        wrong: wrongCnt[q],
        pct: Math.round((wrongCnt[q] / totalStudents) * 100)
      })).sort((a,b) => b.wrong - a.wrong || b.pct - a.pct).slice(0, 7);
      if (list.length === 0) {
        alert("🎉 틀린 문항이 없어요! 모든 학생이 만점이에요.");
        return;
      }
      hardest = list;
      // 사용자에게 안내
      if (totalStudents < 5) {
        if (!window.confirm(`응시 인원이 ${totalStudents}명입니다 (5명 미만).\n\n개인 오답 데이터 기반으로 Top ${list.length} PDF를 만들까요? (통계적 의미는 약하지만 풀이 정리에는 유용)`)) {
          return;
        }
      }
    }
    // 원본 c 의 hardest 를 임시 교체 (HTML 생성용)
    const cWithHardest = {...c, hardest: hardest};
    c = cWithHardest;
    // explanations 조회
    let explanations={};
    try{
      const sp=new URLSearchParams({action:"view_answer_key"});
      if(c.folderId)sp.set("folderId",c.folderId);
      else{
        sp.set("subject",c.subject||"");
        sp.set("grade",c.grade||"");
        sp.set("level",c.level||"");
        sp.set("examType",c.examType||"");
        if(c.teacher)sp.set("teacher",c.teacher);
        if(c.date)sp.set("date",c.date);
      }
      const rr=await fetch(`${sheetsUrl}?${sp.toString()}`);
      const dd=await rr.json();
      if(dd.result==="ok"&&dd.explanations)explanations=dd.explanations;
    }catch(_e){}
    const isMath=(c.subject||"").indexOf("수학")>=0;
    const esc=(s)=>String(s||"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]));
    const lines=[];
    lines.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>오답노트 Top '+c.hardest.length+'</title>');
    lines.push('<style>body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#333;padding:0;margin:0;font-size:11pt;line-height:1.6}.page{max-width:680px;margin:0 auto;padding:24pt}.cover{text-align:center;padding:40pt 20pt;border-bottom:3px solid #B8860B;margin-bottom:24pt}.cover h1{font-size:24pt;color:#5D4037;margin-bottom:8pt}.cover .sub{font-size:13pt;color:#8D6E63;margin-bottom:4pt}.cover .meta{font-size:11pt;color:#999;margin-top:14pt}.q{margin-bottom:24pt;page-break-inside:avoid;border:1.5pt solid #B8860B;border-radius:6pt;padding:14pt;background:#FFFEF7}.qHead{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1pt dashed #E0C97A;padding-bottom:6pt;margin-bottom:10pt}.qNum{font-size:14pt;font-weight:800;color:#B8860B}.qStat{font-size:10pt;color:#C62828;font-weight:600}.qBody{font-size:11pt;color:#333;margin-bottom:10pt;white-space:pre-wrap}.qExp{background:#E3F2FD;border-left:3pt solid #1976D2;padding:8pt 10pt;border-radius:4pt;font-size:10.5pt;color:#0D47A1;margin-bottom:8pt}.ce{margin-top:6pt}.ce-row{padding:5pt 8pt;margin-bottom:3pt;border-radius:4pt;font-size:10pt;border:0.5pt solid #ccc}.ce-correct{background:#E8F5E9;border-color:#4CAF50}.ce-wrong{background:#FFEBEE;border-color:#C62828}.foot{margin-top:24pt;padding:10pt;text-align:center;font-size:9pt;color:#999;border-top:1pt solid #ccc}.math-note{background:#FFF3E0;border:1.5pt solid #E65100;padding:14pt;border-radius:6pt;margin-bottom:14pt;font-size:11pt;color:#5D4037;line-height:1.7}@media print{.q{page-break-inside:avoid}}</style></head><body><div class="page">');
    lines.push('<div class="cover"><h1>🔥 어려운 문항 Top '+c.hardest.length+'</h1>');
    lines.push('<div class="sub">'+esc(c.subject||"")+' '+esc(c.grade||"")+' '+esc(c.level||"")+'반 · '+esc(c.examType||"")+'</div>');
    lines.push('<div class="sub">'+esc(safeTeacher(c.teacher))+' 선생님</div>');
    lines.push('<div class="meta">시험일: '+esc(c.date||"")+' · 응시 '+(c.total||0)+'명</div>');
    lines.push('<div class="meta" style="margin-top:8pt;font-weight:600;color:#666">학생들이 자주 틀린 문항만 모은 오답노트입니다.<br/>다시 풀어보고 풀이를 확인하세요!</div></div>');
    if(isMath){
      lines.push('<div class="math-note">📌 <b>수학 시험 안내</b><br/>수학 문제는 그래프·도형이 포함될 수 있어 원본 시험지를 함께 확인하세요.<br/>아래 문항번호와 풀이를 보고 원본 시험지에서 해당 문제를 다시 풀어보세요.</div>');
    }
    c.hardest.forEach((h,hi)=>{
      const qe=explanations[String(h.q)]||{};
      lines.push('<div class="q"><div class="qHead"><span class="qNum">'+(hi+1)+'위. '+h.q+'번</span><span class="qStat">'+h.wrong+'명 틀림 ('+h.pct+'%)</span></div>');
      // 영어: 문제 본문 + 풀이 + 선택지별 분석
      if(qe.question){
        lines.push('<div class="qBody"><b>📝 문제:</b> '+esc(qe.question)+'</div>');
      }
      if(qe.answer){
        lines.push('<div style="font-size:10.5pt;color:#388E3C;margin-bottom:8pt"><b>✅ 정답:</b> '+esc(qe.answer)+'</div>');
      }
      if(qe.explanation){
        lines.push('<div class="qExp"><b>💡 풀이:</b> '+esc(qe.explanation)+'</div>');
      }
      if(qe.choiceExplanations&&Object.keys(qe.choiceExplanations).length>0){
        lines.push('<div class="ce"><b style="font-size:10pt;color:#666">📋 선택지별 분석:</b>');
        for(let n=1;n<=5;n++){
          const ce=qe.choiceExplanations[String(n)]||qe.choiceExplanations[n];
          if(!ce)continue;
          const isCorrect=String(qe.answer)===String(n);
          const tag=isCorrect?"✅ 정답":"";
          lines.push('<div class="ce-row '+(isCorrect?'ce-correct':'')+'"><b>'+["①","②","③","④","⑤"][n-1]+' '+tag+'</b> '+esc(ce)+'</div>');
        }
        lines.push('</div>');
      }
      if(qe.gradingGuide){
        const gg=qe.gradingGuide;
        if(gg.commonMistakes&&gg.commonMistakes.length>0){
          lines.push('<div style="background:#FFF8E1;border-left:3pt solid #F57C00;padding:6pt 10pt;border-radius:4pt;font-size:10pt;color:#5D4037;margin-top:6pt"><b>⚠️ 자주 하는 실수:</b> '+gg.commonMistakes.map(esc).join(", ")+'</div>');
        }
      }
      if(!qe.question&&!qe.explanation){
        lines.push('<div class="qBody" style="color:#999;font-style:italic">풀이 데이터가 등록되지 않은 문항입니다. (선생님께 풀이를 받아 적어주세요)</div>');
      }
      lines.push('</div>');
    });
    lines.push('<div class="foot">채움학원 자동 채점 시스템 · '+new Date().toLocaleString("ko-KR")+'</div>');
    lines.push('</div></body></html>');
    const html=lines.join("\n");
    const w=window.open("","_blank");
    if(w){w.document.open();w.document.write(html);w.document.close();}
    else alert("팝업이 차단되었어요. 주소창의 팝업 차단을 해제해 주세요.");
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
        {safeTeacher(c.teacher) && <span style={{fontSize:12,fontWeight:600,color:T.goldDark,marginLeft:6}}>(👤 {safeTeacher(c.teacher)})</span>}
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
    lines.push(`<div class="meta"><b>${esc(s.name||"?")}</b> (#${s.rank}) · ${esc(c.subject)} ${esc(c.grade)} ${esc(c.level||"")}반 · ${esc(c.examType)}<br/>📅 ${esc(c.date)} &nbsp; 👨‍🏫 ${esc(safeTeacher(c.teacher)||"-")}</div>`);
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
                                  {/* ★ v23.19 (2026-05-13): "초록=추가/빨강=빼야 함" 안내 삭제 (반복 노이즈) */}
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
        {/* 액션 — ★ v22.8: Word/CSV 다운로드 + 시험지/답지 파일 모달 / v23.17: Top 7 오답노트 */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button onClick={()=>downloadWord(c)} style={{...S.btn,flex:"1 1 22%",fontSize:12,minWidth:90,background:T.goldDark}} title="새 탭에서 인쇄용 페이지 열기 (PDF 저장 / Word 복사 가능)">📄 인쇄·PDF</button>
          <button onClick={()=>downloadCsv(c)} style={{...S.btn,flex:"1 1 22%",fontSize:12,minWidth:80,background:T.accent}} title="CSV 다운로드 (Excel에서 바로 열기)">📊 CSV(엑셀)</button>
          <button onClick={()=>downloadTop7Pdf(c)} style={{...S.btn,flex:"1 1 22%",fontSize:12,minWidth:90,background:"#E65100",color:T.white}} title="학생들이 자주 틀린 Top 7 문항 풀이 PDF (오답노트 인쇄용 · 1명이라도 응시했으면 OK)">🔥 Top 7 오답</button>
          <button onClick={()=>openFileModal(c)} style={{...S.btn,flex:"1 1 22%",fontSize:12,minWidth:90,background:T.blue,color:T.white,cursor:"pointer"}} title="시험지/답지 파일 보기">📁 시험지·답지</button>
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
            {safeTeacher(m.teacher) && <span style={{fontSize:12,fontWeight:600,color:T.goldDark,marginLeft:6}}>(👤 {safeTeacher(m.teacher)})</span>}
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
          {/* ★ v23.18: 기간 누적 — Top 7 오답노트 (학생 개인 데이터 fallback) */}
          <button onClick={()=>{
            // 학생별 wrongs 누적해서 pseudo-students 생성
            const pseudoStudents = (g.studentRows || []).map(s => {
              const allWrongs = [];
              if (s.wrongs) {
                Object.values(s.wrongs).forEach(arr => {
                  if (Array.isArray(arr)) allWrongs.push(...arr);
                });
              }
              return {name: s.name, wrongQs: allWrongs};
            });
            const synth={
              subject:m.subject,grade:m.grade,level:m.level,examType:m.examType,
              teacher:m.teacher,date:(g.dates&&g.dates.length>0?g.dates[g.dates.length-1]:""),
              hardest:g.hardest,total:g.classCount*5,folderId:"",
              students: pseudoStudents
            };
            downloadTop7Pdf(synth);
          }} style={{...S.btn,flex:1,fontSize:12,background:"#E65100",color:T.white}} title="기간 누적 Top 7 오답노트">🔥 Top 7 오답</button>
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
/* ═══════════════════════════════════════════════════════════
   📚 보강 시험 현황 탭 (v23.16) — 학생 약점 보강 미니 시험 진행 추적
   ═══════════════════════════════════════════════════════════
   - GAS `list_mini_exam_progress` 액션 호출 (v24.11)
   - 반별 학생 진행 표 (학생 / 본시험 / 약점영역 / 상태 / 점수 / 마감일)
   - 일괄 푸시 / 부모 알림 버튼 — 비활성 (C-ONE 통합 후 활성화 예정)
   ═══════════════════════════════════════════════════════════ */
function MiniExamProgressTab({sheetsUrl, T, S, teacherList, currentTeacher}) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({total:0, waiting:0, completed:0, missed:0, avgScore:0});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // all | waiting | completed | missed

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const params = new URLSearchParams({action: "list_mini_exam_progress"});
      if (filterClass) params.set("className", filterClass);
      if (filterDate) params.set("date", filterDate);
      const r = await fetch(`${sheetsUrl}?${params.toString()}`);
      const j = await r.json();
      if (j.result === "ok") {
        setItems(j.items || []);
        setSummary(j.summary || {total:0, waiting:0, completed:0, missed:0, avgScore:0});
      } else {
        setErr(j.message || "조회 실패");
      }
    } catch(e) {
      setErr("네트워크 오류: " + String(e));
    }
    setLoading(false);
  }, [filterClass, filterDate, sheetsUrl]);

  useEffect(() => { load(); }, [load]);

  // 30초마다 자동 새로고침
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  // 반 목록 추출 (필터 옵션)
  const classOptions = useMemo(() => {
    const set = new Set();
    items.forEach(it => { if (it.className) set.add(it.className); });
    return Array.from(set).sort();
  }, [items]);

  // 상태별 필터링
  const filtered = useMemo(() => {
    if (filterStatus === "all") return items;
    if (filterStatus === "waiting") return items.filter(it => it.status === "대기");
    if (filterStatus === "completed") return items.filter(it => it.status === "완료");
    if (filterStatus === "missed") return items.filter(it => it.status === "미완료");
    return items;
  }, [items, filterStatus]);

  // 반별 그룹화
  const grouped = useMemo(() => {
    const m = {};
    filtered.forEach(it => {
      const k = it.className || "(반 미지정)";
      if (!m[k]) m[k] = [];
      m[k].push(it);
    });
    return Object.keys(m).sort().map(k => ({className: k, students: m[k]}));
  }, [filtered]);

  const statusColor = (it) => {
    if (it.status === "완료") return T.accent;
    if (it.status === "미완료") return T.danger;
    if (it.daysLeft != null && it.daysLeft <= 1) return T.danger;
    if (it.daysLeft != null && it.daysLeft <= 3) return T.goldDark;
    return T.textSub;
  };
  const statusIcon = (it) => {
    if (it.status === "완료") return "✅";
    if (it.status === "미완료") return "❌";
    if (it.daysLeft != null && it.daysLeft <= 1) return "🔥";
    if (it.daysLeft != null && it.daysLeft <= 3) return "⏰";
    return "⏳";
  };

  return (
    <div style={S.wrap} className="fade-up">
      <div style={{textAlign:"center", padding:"20px 0 12px"}}>
        <div style={{fontSize:36, marginBottom:4}}>📚</div>
        <h1 style={{fontSize:24, fontWeight:800, color:T.text}}>보강 시험 현황</h1>
        <p style={{fontSize:13, color:T.textMuted}}>학생 약점 영역 자동 보강 — 진행 상태 추적 (30초마다 자동 갱신)</p>
      </div>

      {/* 요약 KPI */}
      <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, marginBottom:14}}>
        {[
          {label:"📚 전체", value:summary.total, color:T.goldDark},
          {label:"⏳ 대기", value:summary.waiting, color:T.goldDark},
          {label:"✅ 완료", value:summary.completed, color:T.accent},
          {label:"📊 평균", value:summary.avgScore + "점", color:T.blue}
        ].map((kpi, i) => (
          <div key={i} style={{padding:"12px 14px", background:T.goldPale, borderRadius:8, textAlign:"center", borderBottom:`3px solid ${kpi.color}`}}>
            <div style={{fontSize:22, fontWeight:800, color:kpi.color, lineHeight:1}}>{kpi.value}</div>
            <div style={{fontSize:11, color:T.textSub, marginTop:4, fontWeight:600}}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* 필터 + 새로고침 */}
      <div style={{...S.card, padding:"12px 14px", marginBottom:12}}>
        <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
          <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{...S.inp, flex:"1 1 140px", maxWidth:200, padding:"6px 8px", fontSize:12}}>
            <option value="">전체 반</option>
            {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{...S.inp, flex:"0 0 auto", padding:"6px 8px", fontSize:12}} />
          <div style={{display:"flex", gap:4}}>
            {[
              {k:"all", label:"전체"},
              {k:"waiting", label:"⏳ 대기"},
              {k:"completed", label:"✅ 완료"},
              {k:"missed", label:"❌ 미완료"}
            ].map(o => (
              <button key={o.k} onClick={() => setFilterStatus(o.k)}
                style={{padding:"6px 10px", fontSize:11, fontWeight:filterStatus===o.k?700:500, borderRadius:6, border:`1px solid ${filterStatus===o.k?T.goldDark:T.border}`, background:filterStatus===o.k?T.goldLight:T.white, color:filterStatus===o.k?T.goldDark:T.textSub, cursor:"pointer", fontFamily:"inherit"}}>
                {o.label}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading} style={{...S.btnO, padding:"6px 12px", fontSize:11, marginLeft:"auto"}}>
            {loading ? "🔄 로딩 중..." : "🔄 새로고침"}
          </button>
        </div>
      </div>

      {/* 비활성 — C-ONE 통합 후 활성화 */}
      <div style={{...S.card, padding:"12px 14px", background:"#FAFAFA", border:`1px dashed ${T.border}`, marginBottom:12}}>
        <div style={{fontSize:12, fontWeight:700, color:T.textMuted, marginBottom:6}}>🚧 C-ONE 통합 후 활성화 예정</div>
        <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
          <button disabled style={{padding:"6px 12px", fontSize:11, fontWeight:600, borderRadius:6, border:`1px solid ${T.border}`, background:T.borderLight, color:T.textMuted, cursor:"not-allowed", fontFamily:"inherit"}}>
            📲 미완료 학생에게 일괄 푸시
          </button>
          <button disabled style={{padding:"6px 12px", fontSize:11, fontWeight:600, borderRadius:6, border:`1px solid ${T.border}`, background:T.borderLight, color:T.textMuted, cursor:"not-allowed", fontFamily:"inherit"}}>
            👨‍👩‍👧 부모 알림 발송
          </button>
          <button disabled style={{padding:"6px 12px", fontSize:11, fontWeight:600, borderRadius:6, border:`1px solid ${T.border}`, background:T.borderLight, color:T.textMuted, cursor:"not-allowed", fontFamily:"inherit"}}>
            📊 학생별 누적 분석
          </button>
        </div>
        <div style={{marginTop:6, fontSize:10, color:T.textMuted}}>
          현재는 데스크 쌤이 직접 학생에게 안내. C-ONE 통합 시 학부모 DB 연결 + 카카오 알림톡·푸시 자동화 예정.
        </div>
      </div>

      {loading && <div style={{textAlign:"center", padding:40, color:T.textMuted}}>로딩 중...</div>}
      {err && <div style={{padding:14, background:T.dangerLight, color:T.danger, borderRadius:10, fontSize:13, fontWeight:600, textAlign:"center", marginBottom:12}}>⚠️ {err}</div>}

      {!loading && filtered.length === 0 && (
        <div style={{padding:40, textAlign:"center", color:T.textMuted, background:T.bg, borderRadius:10}}>
          <div style={{fontSize:48, marginBottom:8}}>📭</div>
          <p style={{fontSize:14}}>{filterStatus === "all" ? "보강 시험 추천 이력이 없습니다." : "해당 상태의 보강 시험이 없습니다."}</p>
          <p style={{fontSize:11, marginTop:6, color:T.textMuted}}>학생이 시험을 보고 약점이 발견되면 자동 추천돼요.</p>
        </div>
      )}

      {!loading && grouped.map(g => (
        <div key={g.className} style={{marginBottom:14}}>
          <div style={{display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:T.goldPale, borderRadius:8, marginBottom:8}}>
            <span style={{fontSize:14, fontWeight:800, color:T.goldDark}}>🇬🇧 {g.className}</span>
            <span style={{marginLeft:"auto", fontSize:11, color:T.textSub, fontWeight:600}}>
              {g.students.length}건 · 대기 {g.students.filter(s=>s.status==="대기").length} · 완료 {g.students.filter(s=>s.status==="완료").length}
            </span>
          </div>
          {/* 학생 표 */}
          <div style={{background:T.white, border:`1px solid ${T.borderLight}`, borderRadius:8, overflow:"hidden"}}>
            <div style={{display:"flex", padding:"8px 12px", background:T.bg, fontSize:11, fontWeight:700, color:T.textSub, gap:8}}>
              <span style={{flex:"0 0 70px"}}>학생</span>
              <span style={{flex:"1 1 auto"}}>약점 / 본 시험</span>
              <span style={{flex:"0 0 60px", textAlign:"center"}}>마감</span>
              <span style={{flex:"0 0 60px", textAlign:"center"}}>점수</span>
              <span style={{flex:"0 0 70px", textAlign:"center"}}>상태</span>
            </div>
            {g.students.map((it, i) => (
              <div key={i} style={{display:"flex", padding:"8px 12px", borderTop:`1px solid ${T.borderLight}`, fontSize:12, gap:8, alignItems:"center"}}>
                <span style={{flex:"0 0 70px", fontWeight:700, color:T.text}}>{it.studentName}</span>
                <span style={{flex:"1 1 auto", color:T.textSub, fontSize:11}}>
                  <strong style={{color:statusColor(it)}}>{it.weakArea}</strong>
                  <br/>
                  <span style={{color:T.textMuted, fontSize:10}}>{it.examType} · {it.examDate}</span>
                </span>
                <span style={{flex:"0 0 60px", textAlign:"center", fontSize:11, color:it.daysLeft<=1?T.danger:it.daysLeft<=3?T.goldDark:T.textSub, fontWeight:600}}>
                  {it.daysLeft != null ? (it.daysLeft >= 0 ? `D-${it.daysLeft}` : `D+${-it.daysLeft}`) : "-"}
                </span>
                <span style={{flex:"0 0 60px", textAlign:"center", fontWeight:700, color:it.score!=null?(it.score>=80?T.accent:it.score>=60?T.goldDark:T.danger):T.textMuted}}>
                  {it.score != null ? `${it.score}점` : "-"}
                </span>
                <span style={{flex:"0 0 70px", textAlign:"center", fontWeight:700, color:statusColor(it)}}>
                  {statusIcon(it)} {it.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
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
  // ★ v23.7: loadDashboard 강화 — force 옵션으로 캐시 우회 가능
  //   useEffect의 자동 호출은 cache 사용 (빠른 로딩), 🔄 버튼·시험 취소 후 갱신은 force (fresh data)
  const loadDashboard = useCallback((dateOverride, force)=>{
    const d=(typeof dateOverride==="string"?dateOverride:null)||dashDate;
    const useForce = force===true || dateOverride===true;
    setDashLoading(true); setDashErr(""); setDashData(null);
    const cacheBust = useForce ? "&nocache=1&force_scan=1" : "";
    fetch(`${sheetsUrl}?action=teacher_dashboard&date=${encodeURIComponent(d)}${cacheBust}`)
      .then(r=>r.json()).then(d2=>{if(d2.result==="ok"){setDashData(d2);}else{setDashErr(d2.message||"조회 실패");}setDashLoading(false);})
      .catch(()=>{setDashErr("네트워크 오류");setDashLoading(false);});
    loadReviewCount();
  }, [dashDate, sheetsUrl, loadReviewCount]);
  useEffect(()=>{ loadDashboard(); }, [loadDashboard]);
  // ★ v23.7: 시험 전체 취소 — 강건 버전
  //   - rowIndex 없거나 stale 캐시라도 합성키(className+examType+setType+examDate)로 fallback
  //   - 정답목록 행 + 업로드기록 행 동시 삭제 → 학생앱·대시보드 모두 즉시 사라짐
  //   - (선택) Drive 파일도 휴지통으로
  // ★ v23.20 (2026-05-13): 시험 날짜 수정 — 잘못 올린 날짜 변경
  const editExamDate = useCallback(async (ex)=>{
    const examLabel = `${ex.subject||""} ${ex.grade||""} ${ex.level||""}반 · ${ex.examType||""}`;
    const curDate = ex.examDate || dashDate || "";
    const newDate = window.prompt(
      `📅 시험 날짜 변경\n\n${examLabel}\n현재 날짜: ${curDate}\n\n새 날짜를 입력하세요 (예: 2026-05-14):`,
      curDate.replace(/\./g, "-")
    );
    if (!newDate) return;
    const trimmed = newDate.trim();
    if (!/^\d{4}[-.]\d{1,2}[-.]\d{1,2}$/.test(trimmed)) {
      alert("⚠️ 날짜 형식이 잘못됐어요. YYYY-MM-DD 형식 (예: 2026-05-14)");
      return;
    }
    try {
      const body = {
        action: "update_exam_date",
        newDate: trimmed,
        folderId: ex.folderId || "",
        rowIndex: ex.rowIndex || 0
      };
      await fetch(sheetsUrl, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(body)
      });
      alert(`✅ 시험 날짜를 ${trimmed} 로 변경했어요.\n\n잠시 후 새로고침하면 반영됩니다.`);
      // 페이지 새로고침
      window.location.reload();
    } catch(e) {
      alert("네트워크 오류: " + String(e));
    }
  }, [sheetsUrl, dashDate]);
  const cancelDashExam = useCallback(async (ex)=>{
    const examLabel = `${ex.subject||""} ${ex.grade||""} ${ex.level||""}반 · ${ex.examType||""}${ex.setType?` (${ex.setType})`:""}`;
    // 최소 식별 정보 (rowIndex 또는 합성키 중 하나는 있어야 함)
    const hasComposite = !!(ex.className && ex.examType);
    if (!ex.rowIndex && !hasComposite) {
      alert(`⚠️ 이 시험은 식별 정보가 부족해 취소할 수 없습니다.\n\nclassName: ${ex.className||"(없음)"}\nexamType: ${ex.examType||"(없음)"}\n\n새로고침 버튼을 누른 뒤 다시 시도하세요.`);
      return;
    }
    // 1차 확인
    if (!window.confirm(`이 시험을 취소할까요?\n\n📚 ${examLabel}\n📝 ${ex.totalQuestions||0}문항\n\n취소하면 학생앱·대시보드에서 즉시 사라집니다.\n(잘못 등록했거나 답지를 교체해야 할 때 사용)`)) return;
    // Drive 파일 옵션 (folderId가 있을 때만 물어봄)
    let trashFiles = false;
    if (ex.folderId) {
      trashFiles = window.confirm(`Drive에 올린 시험지·답지 파일도 함께 휴지통으로 보낼까요?\n\n[확인] = 정답 + 파일 모두 정리 (휴지통, 30일 복구 가능)\n[취소] = 정답 데이터만 삭제 (파일은 Drive 그대로 유지)`);
    }
    // 2차 최종 확인
    if (!window.confirm(`정말 취소하시겠습니까? (마지막 확인)\n\n📚 ${examLabel}\n\n진행 후엔:\n· 학생앱·대시보드에서 즉시 사라짐\n· 정답·업로드기록은 백업 시트에 자동 보관\n${trashFiles?"· Drive 파일도 휴지통으로 (30일 내 복구 가능)":"· Drive 파일은 그대로 유지"}\n\n진행할까요?`)) return;
    // 호출 — rowIndex와 합성키 둘 다 보낸다 (서버가 알아서 우선순위 결정)
    try {
      const params = new URLSearchParams({
        action: "cancel_dash_exam",
        confirm: "YES",
        trashFiles: trashFiles ? "1" : "0",
        folderId: ex.folderId || ""
      });
      if (ex.rowIndex) params.append("rowIndex", String(ex.rowIndex));
      // 합성키도 항상 같이 보냄 (rowIndex가 stale일 때 자동 fallback)
      if (ex.className) params.append("className", ex.className);
      if (ex.examType) params.append("examType", ex.examType);
      if (ex.setType || ex.round) params.append("setType", ex.setType || ex.round || "");
      if (ex.examDate || dashDate) params.append("examDate", ex.examDate || dashDate || "");
      const r = await fetch(`${sheetsUrl}?${params.toString()}`);
      const d = await r.json();
      if (d.result === "ok") {
        const resolveTag = d.resolvedBy==="composite" ? " (합성키 fallback 사용)" : "";
        alert(
          `✅ 시험 취소 완료${resolveTag}\n\n` +
          `📚 ${examLabel}\n` +
          `학생앱·대시보드에서 즉시 사라집니다.\n` +
          (d.deletedUploads>0 ? `\n📤 업로드기록 ${d.deletedUploads}건 정리` : "") +
          (d.trashedFiles>0 ? `\n📁 Drive 파일 ${d.trashedFiles}개 휴지통 이동` : "") +
          `\n\n🛟 복구용 백업: ${d.backupSheet}`
        );
        // 즉시 갱신 — force=true 로 캐시 우회
        loadDashboard(null, true);
      } else {
        alert("❌ 취소 실패: " + (d.message||"알 수 없는 오류") + "\n\n다시 시도하시거나, 시트의 정답목록을 직접 확인하세요.");
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
        <button onClick={()=>loadDashboard(null, true)} style={{...S.btnO,padding:"6px 12px",fontSize:11,marginLeft:"auto"}} title="캐시 우회 + 강제 재조회 (방금 추가/취소한 시험 즉시 반영)">🔄 새로고침</button>
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
                            {/* ★ v23.20 (2026-05-13): 시험 날짜 수정 — 잘못 올린 날짜 변경 */}
                            <button onClick={()=>editExamDate({...ex, examDate: ex.examDate || dashDate})} style={{padding:"3px 8px",fontSize:10,fontWeight:700,borderRadius:8,border:`1px solid ${T.blue}`,background:T.white,color:T.blue,cursor:"pointer",fontFamily:"inherit"}} title="시험 날짜 수정 — 잘못 등록한 날짜를 변경 (내일 시험을 오늘로 등록했을 때)">📅 날짜 수정</button>
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
  // ★ v23.16: 탭 메타 정보 (사이드바 + 모바일 하단탭 공유)
  //   ★ v23.16: "보강 시험 현황" 탭 신규 — 학생 약점 보강 미니 시험 진행 추적
  const _navTabs = [
    {k:"register",  label:"시험 등록",   icon:"📋", section:"main"},
    {k:"dashboard", label:"오늘의 현황", icon:"📊", section:"main"},
    {k:"stats",     label:"반별 성적",   icon:"📈", section:"main"},
    {k:"miniexam",  label:"보강 현황",   icon:"📚", section:"main"},
    {k:"generator", label:"문제 생성",   icon:"✨", section:"tools"},
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
      {/* ★ v23.16: 보강 시험 현황 탭 (Phase 5) */}
      {screen==="home"&&tab==="miniexam"&&(<MiniExamProgressTab sheetsUrl={SHEETS_URL} T={T} S={S} teacherList={teacherList} currentTeacher={teacher}/>)}
      {/* ═══ 문제 생성기 탭 (v23.10: 큐 예약 + 모니터링 + 자동 등록) ═══ */}
      {screen==="home"&&tab==="generator"&&(<GeneratorTab sheetsUrl={SHEETS_URL} T={T} S={S} teacherList={teacherList} currentTeacher={teacher}/>)}
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
