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
const LS_KEY="chaeum_teacher";
function lsGet(){try{return JSON.parse(localStorage.getItem(LS_KEY)||"{}");}catch(e){return{};}}
function lsSet(o){try{localStorage.setItem(LS_KEY,JSON.stringify(o));}catch(e){}}

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

export default function App(){
  // 상단 탭 (등록 / 오늘의 현황)
  const[tab,setTab]=useState("register");
  // 화면 상태
  const[screen,setScreen]=useState("home"); // home, modeSelect, directSetup, direct, upload, done

  // 선생님 정보 (localStorage)
  const _ls=lsGet();
  const[teacher,setTeacher]=useState(_ls.teacher||"");

  // 반 추가
  const[ts,setTs]=useState("");const[tg,setTg]=useState("");const[tl,setTl]=useState("");const[tcl,setTcl]=useState("");const[tlCat,setTlCat]=useState("level");
  const[tcount,setTcount]=useState(""); // 반별 예상 인원
  const[classes,setClasses]=useState([]);

  // 시험 정보
  const[examType,setExamType]=useState("");
  const[examDate,setExamDate]=useState(()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;});
  const[examTime,setExamTime]=useState(()=>{const d=new Date();return`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;});

  // 직접입력 모드
  const[totalQ,setTotalQ]=useState(50);const[customQ,setCustomQ]=useState("");
  const qc=customQ?parseInt(customQ)||50:totalQ;
  const[answers,setAnswers]=useState([]);
  const[types,setTypes]=useState([]);
  const[subAns,setSubAns]=useState({});

  // 파일업로드 모드
  const[examFiles,setExamFiles]=useState([]);
  const[answerFiles,setAnswerFiles]=useState([]);
  const[memo,setMemo]=useState("");
  // 주관식 힌트 (업로드 모드)
  const[subjMode,setSubjMode]=useState("none"); // none | mixed | all
  const[subjRanges,setSubjRanges]=useState(""); // "21-30, 45, 50-55"
  const[objRanges,setObjRanges]=useState("");   // "1-20, 31-44"

  // 상태
  const[saving,setSaving]=useState(false);const[done,setDone]=useState(false);const[error,setError]=useState("");

  // 대시보드
  const[dashData,setDashData]=useState(null);const[dashLoading,setDashLoading]=useState(false);const[dashErr,setDashErr]=useState("");
  const todayIsoStr=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
  const[dashDate,setDashDate]=useState(todayIsoStr());

  const dateStr=examDate.replace(/-/g,".")+" "+examTime;
  const totalStudents=classes.reduce((s,c)=>s+(parseInt(c.count)||0),0);

  // 선생님 이름 저장
  useEffect(()=>{if(teacher)lsSet({teacher});},[teacher]);

  // 반 추가
  const addClass=()=>{
    if(!teacher.trim())return alert("먼저 선생님 이름을 입력하세요.");
    if(!ts)return alert("과목을 선택하세요.");if(!tg)return alert("학년을 선택하세요.");
    const lv=tlCat==="etc"?tcl:tl;if(!lv)return alert("레벨/학교를 선택하세요.");
    const name=`${ts} ${tg} ${lv}반`;
    if(classes.some(c=>c.name===name))return alert("이미 추가된 반입니다.");
    // ★ 예상 인원 필수 — 실장님 프린트 매수 산출에 필요
    const cnt=parseInt(tcount)||0;
    if(!cnt||cnt<=0)return alert("예상 인원을 입력하세요.\n(실장님이 시험지를 몇 장 프린트해야 할지 계산하기 위해 필수입니다.)");
    setClasses(p=>[...p,{subject:ts,grade:tg,level:lv,name,count:cnt}]);
    setTl("");setTcl("");setTcount("");
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
    if(filled===0)return alert("최소 1문항 이상 정답을 입력하세요.");
    setSaving(true);setError("");
    try{
      // 복수정답 배열은 "2,3" 형태 문자열로 직렬화
      const answersSer=answers.map(v=>Array.isArray(v)?v.join(","):v);
      // 1) 정답 데이터 시트 저장 (반별)
      for(const cls of classes){
        await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"save_answer_key",subject:cls.subject,grade:cls.grade,level:cls.level,examType,round:"",totalQuestions:qc,answers:answersSer,types,teacher,studentCount:cls.count,date:dateStr})});
      }
      // 2) 파일(시험지/정답지)이 있으면 Drive에도 업로드 — 실장님 프린트용
      if(examFiles.length>0||answerFiles.length>0){
        const aData=await Promise.all(answerFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
        const eData=await Promise.all(examFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
        await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"upload_exam",classes:classes.map(c=>({subject:c.subject,grade:c.grade,level:c.level,count:c.count})),classNames:classes.map(c=>c.name).join(", "),examType,date:dateStr,memo:"(직접 입력 모드 · 시험지/정답지 업로드)",teacher,studentCount:totalStudents,subjMode:"direct",subjRanges:"",objRanges:"",answerFiles:aData,examFiles:eData})});
      }
      setDone(true);setScreen("done");
    }catch(e){setError("저장 실패. 다시 시도해주세요.");}
    setSaving(false);
  };

  // 파일업로드 저장
  const saveUpload=async()=>{
    if(answerFiles.length===0)return alert("정답지 파일을 업로드하세요.");
    setSaving(true);setError("");
    try{
      const aData=await Promise.all(answerFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
      const eData=await Promise.all(examFiles.map(async f=>({name:f.name,type:f.type,data:await fileToBase64(f)})));
      await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"upload_exam",classes:classes.map(c=>({subject:c.subject,grade:c.grade,level:c.level,count:c.count})),classNames:classes.map(c=>c.name).join(", "),examType,date:dateStr,memo,teacher,studentCount:totalStudents,subjMode,subjRanges,objRanges,answerFiles:aData,examFiles:eData})});
      setDone(true);setScreen("done");
    }catch(e){setError("업로드 실패. 다시 시도해주세요.");}
    setSaving(false);
  };

  // 대시보드 조회
  // 프록시 다운로드 — Apps Script가 base64로 파일을 서빙 → blob으로 변환해서 저장
  // 다른 구글 계정(권한 없는 선생님)도 다운 가능
  const proxyDownload=async(fileId,fileName)=>{
    try{
      const res=await fetch(`${SHEETS_URL}?action=download_file&id=${encodeURIComponent(fileId)}`);
      const d=await res.json();
      if(d.result!=="ok")throw new Error(d.message||"다운 실패");
      // base64 → Uint8Array → Blob
      const bin=atob(d.data);const u8=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
      const blob=new Blob([u8],{type:d.mimeType||"application/octet-stream"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=fileName||d.name||"download";
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(err){alert("다운로드 실패: "+(err.message||err));}
  };

  const loadDashboard=(dateOverride)=>{
    const d=dateOverride||dashDate;
    setDashLoading(true);setDashErr("");setDashData(null);
    fetch(`${SHEETS_URL}?action=teacher_dashboard&date=${encodeURIComponent(d)}`)
      .then(r=>r.json()).then(d=>{if(d.result==="ok"){setDashData(d);}else{setDashErr(d.message||"조회 실패");}setDashLoading(false);})
      .catch(()=>{setDashErr("네트워크 오류");setDashLoading(false);});
  };
  useEffect(()=>{if(tab==="dashboard")loadDashboard();},[tab,dashDate]);

  const reset=()=>{setScreen("home");setTs("");setTg("");setTl("");setTcl("");setTlCat("level");setTcount("");setClasses([]);setExamType("");setExamFiles([]);setAnswerFiles([]);setMemo("");setAnswers([]);setTypes([]);setSubAns({});setDone(false);setError("");setTotalQ(50);setCustomQ("");setSubjMode("none");setSubjRanges("");setObjRanges("");
    const d=new Date();setExamDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);setExamTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`);};

  return(
    <div style={S.app}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}body{font-family:'Noto Sans KR',-apple-system,sans-serif;background:${T.bg}}input:focus,textarea:focus{outline:none;border-color:${T.gold}!important;box-shadow:0 0 0 3px ${T.goldLight}!important}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes spin{to{transform:rotate(360deg)}}.fade-up{animation:fadeUp .3s ease-out}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}`}</style>

      <header style={S.hdr}><div style={S.hdrIn}><div style={S.logoR}><div style={S.logoM}>채움</div><div><div style={S.hdrT}>채움학원</div><div style={S.hdrS}>시험 등록 (선생님용)</div></div></div>{teacher&&<div style={S.hdrB}>👤 {teacher}</div>}</div></header>

      {/* ═══ 상단 탭 (home 에서만 표시) ═══ */}
      {screen==="home"&&(<div style={{display:"flex",gap:6,padding:"10px 14px 0"}}>
        <button onClick={()=>setTab("register")} style={{flex:1,padding:"10px",fontSize:13,fontWeight:700,borderRadius:10,border:"none",cursor:"pointer",fontFamily:"inherit",background:tab==="register"?T.goldDark:T.white,color:tab==="register"?T.white:T.textSub,boxShadow:tab==="register"?"none":`inset 0 0 0 1.5px ${T.border}`}}>📋 시험 등록</button>
        <button onClick={()=>setTab("dashboard")} style={{flex:1,padding:"10px",fontSize:13,fontWeight:700,borderRadius:10,border:"none",cursor:"pointer",fontFamily:"inherit",background:tab==="dashboard"?T.goldDark:T.white,color:tab==="dashboard"?T.white:T.textSub,boxShadow:tab==="dashboard"?"none":`inset 0 0 0 1.5px ${T.border}`}}>📊 오늘의 현황</button>
      </div>)}

      {/* ═══ 홈: 시험 정보 설정 ═══ */}
      {screen==="home"&&tab==="register"&&(<div style={S.wrap} className="fade-up">
        <div style={{textAlign:"center",padding:"20px 0 12px"}}><div style={{fontSize:36,marginBottom:4}}>📋</div><h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:4}}>시험 등록</h1><p style={{fontSize:13,color:T.textMuted}}>시험 대상 반과 정보를 설정하세요</p></div>

        {/* 선생님 이름 */}
        <div style={S.card}>
          <div style={S.secLabel}>선생님 정보</div>
          <div style={{marginBottom:0}}>
            <div style={S.label}>선생님 이름 <span style={{color:T.danger}}>*</span><span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:6}}>(다음부터 자동 입력)</span></div>
            <input style={S.inp} placeholder="예: 김선생" value={teacher} onChange={e=>setTeacher(e.target.value)}/>
          </div>
        </div>

        <div style={S.card}>
          <div style={S.secLabel}>시험 대상 반 추가</div>
          <Chip label="과목" req opts={SUBJECTS} val={ts} onChange={setTs}/>
          <Chip label="학년" req opts={GRADES} val={tg} onChange={setTg}/>
          <div style={{marginBottom:14}}>
            <div style={S.label}>레벨 / 학교 <span style={{color:T.danger}}>*</span></div>
            <div style={{display:"flex",gap:5,marginBottom:8}}>{LV_CATS.map(c=>{const a=tlCat===c.key;return(<button key={c.key} onClick={()=>{setTlCat(c.key);setTl("");setTcl("");}} style={{padding:"6px 12px",fontSize:12,fontWeight:a?700:500,borderRadius:8,border:`1.5px solid ${a?T.goldDark:T.border}`,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,cursor:"pointer",fontFamily:"inherit"}}>{c.label}</button>);})}</div>
            {tlCat!=="etc"?(<div style={S.cw}>{(LV_CATS.find(c=>c.key===tlCat)?.opts||[]).map(o=>{const a=tl===o;return(<button key={o} onClick={()=>{setTl(tl===o?"":o);setTcl("");}} style={{...S.ch,background:a?T.goldDark:T.white,color:a?T.white:T.textSub,borderColor:a?T.goldDark:T.border,fontWeight:a?700:500,fontSize:12,padding:"7px 12px"}}>{o}</button>);})}</div>
            ):(<input style={{...S.inp,marginTop:4}} placeholder="직접 입력 (예: 특별반)" value={tcl} onChange={e=>{setTcl(e.target.value);setTl(e.target.value);}}/>)}
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
          {ts&&tg&&(tl&&tl!=="custom"||tcl)&&(<div style={S.addRow}>
            <div style={{fontSize:14,fontWeight:700,color:T.goldDark}}>{ts} {tg} {tlCat==="etc"?tcl:tl}반{tcount?` · ${tcount}명`:" · (인원 미입력)"}</div>
            <button onClick={addClass} style={{...S.addBtn,opacity:!tcount?.5:1,cursor:!tcount?"not-allowed":"pointer"}} disabled={!tcount}>+ 반 추가</button>
          </div>)}
          {classes.length>0&&(<div style={{marginTop:12}}>
            <div style={{fontSize:12,fontWeight:600,color:T.textMuted,marginBottom:6}}>추가된 반 ({classes.length}개 · 총 {totalStudents}명)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{classes.map((c,i)=>(<div key={i} style={S.tag}><span>{c.name}{c.count?` ${c.count}명`:""}</span><button onClick={()=>setClasses(p=>p.filter((_,j)=>j!==i))} style={S.tagX}>×</button></div>))}</div>
          </div>)}
        </div>

        <div style={S.card}>
          <div style={S.secLabel}>시험 정보</div>
          <Chip label="시험 종류" req opts={EXAM_TYPES} val={examType} onChange={setExamType} custom/>
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

      {/* ═══ 오늘의 현황 대시보드 (과목→학년→선생님 계층) ═══ */}
      {screen==="home"&&tab==="dashboard"&&(()=>{
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
        {dashLoading&&<div style={{textAlign:"center",padding:40,color:T.textMuted}}>불러오는 중...</div>}
        {dashErr&&<div style={{padding:14,background:T.dangerLight,borderRadius:10,color:T.danger,fontSize:13,fontWeight:600,textAlign:"center"}}>{dashErr}</div>}
        {dashData&&!dashLoading&&(()=>{
          const allExams=dashData.exams||[];
          const expTot=dashData.expectedTotal||dashData.summary?.totalExpected||0;
          const subTot=dashData.submissionTotal||dashData.summary?.totalSubmitted||0;
          // 계층 그룹화: 과목 → 학년 → 선생님 → 시험들
          const tree={};
          const subjOrder=["영어","수학","국어","과학","사회"];
          const gradeOrder=["초1","초2","초3","초4","초5","초6","초등","중1","중2","중3","고1","고2","고3"];
          allExams.forEach(ex=>{
            // subject 빈값/오기 fallback: examType, className, examName에서 과목 키워드 추출
            const guessSubj=(ex)=>{
              if(ex.subject&&["영어","국어","수학","과학","사회"].includes(ex.subject))return ex.subject;
              const keys=["영어","국어","수학","과학","사회"];
              const sources=[ex.examType,ex.className,ex.examName].filter(Boolean).join(" ");
              for(const k of keys){if(sources.indexOf(k)>=0)return k;}
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
            {/* 요약 카드 */}
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
            ):subjKeys.map(subj=>{
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
                            <div style={{display:"flex",gap:4,flexWrap:"wrap",fontSize:10,marginBottom:6}}>
                              <span style={S.pill}>📝 {ex.totalQuestions||0}문항</span>
                              <span style={S.pillBlue}>👥 예상 {expected}명</span>
                              <span style={S.pillGreen}>✅ 제출 {submitted}명</span>
                              <span style={{padding:"2px 8px",borderRadius:10,fontWeight:600,background:fileStatus.bg,color:fileStatus.c}}>{hasFile?"📎":"⚠️"} {fileStatus.t}</span>
                            </div>
                            {expected>0&&(<div style={{height:5,background:T.borderLight,borderRadius:3,overflow:"hidden",marginBottom:6}}><div style={{height:"100%",width:`${pct}%`,background:submitted>=expected?T.accent:T.gold,transition:"width .3s"}}/></div>)}
                            {/* 파일 다운로드 목록 */}
                            {(ex.files||[]).length>0&&(<div style={{marginTop:6,paddingTop:6,borderTop:`1px dashed ${T.border}`}}>
                              <div style={{fontSize:10,fontWeight:700,color:T.textSub,marginBottom:4}}>📎 첨부 파일 {ex.files.length}개</div>
                              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                                {ex.files.map((fl,fi)=>(<div key={fi} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:T.white,borderRadius:6,border:`1px solid ${T.borderLight}`}}>
                                  <span style={{fontSize:11}}>{fl.kind==="answer"?"🔑":"📄"}</span>
                                  <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                                    <div style={{fontSize:11,fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fl.name}</div>
                                    <div style={{fontSize:9,color:T.textMuted}}>{fl.kind==="answer"?"정답지":"시험지"} · {fl.size?Math.round(fl.size/1024)+"KB":""}</div>
                                  </div>
                                  <button onClick={()=>proxyDownload(fl.id,fl.name)} style={{padding:"3px 8px",fontSize:10,fontWeight:700,background:T.goldDark,color:T.white,borderRadius:5,textDecoration:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>⬇ 다운</button>
                                  <a href={fl.viewUrl} target="_blank" rel="noreferrer" style={{padding:"3px 8px",fontSize:10,fontWeight:700,background:T.white,color:T.blue,border:`1px solid ${T.blue}`,borderRadius:5,textDecoration:"none"}}>👁 보기</a>
                                </div>))}
                              </div>
                            </div>)}
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
      </div>);})()}

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
          <FileUploadMulti label="시험지 (선택사항)" files={examFiles} onFilesChange={setExamFiles} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"/>
          <FileUploadMulti label="정답지" req files={answerFiles} onFilesChange={setAnswerFiles} accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"/>
          <div style={{padding:"12px 14px",borderRadius:10,background:T.blueLight,border:`1px solid ${T.blue}30`,marginTop:8}}>
            <div style={{fontSize:12,fontWeight:700,color:T.blue,marginBottom:4}}>💡 이렇게 처리됩니다</div>
            <div style={{fontSize:12,color:T.textSub,lineHeight:1.7}}>1. 파일이 구글 드라이브에 저장됩니다.<br/>2. Claude가 정답지를 분석하여 정답을 추출합니다.<br/>3. 분석 완료 후 학생 앱에서 채점이 가능해집니다.</div>
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
          <div style={S.label}>메모 (선택사항)</div>
          <textarea style={S.textarea} placeholder="참고사항" value={memo} onChange={e=>setMemo(e.target.value)} rows={2}/>
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
  subBar:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:T.white,borderTop:`1px solid ${T.border}`,padding:"10px 16px",paddingBottom:"max(10px,env(safe-area-inset-bottom))",display:"flex",alignItems:"center",gap:10,zIndex:200},
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
