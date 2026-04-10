import { useState, useCallback } from "react";

/* ============================================================
   채움학원 — 선생님용 시험 등록 (직접입력 + 파일업로드 통합)
   ============================================================ */

const SHEETS_URL = "https://script.google.com/macros/s/AKfycbzablzeV_gVdLoUG-Oh4s02vNmncvteesBn3875WDF3lO176nc4YzAKj7B6zOJVECQO/exec";
const SUBJECTS=["영어","국어","수학"];
const GRADES=["초3","초4","초5","초6","중1","중2","중3","고1","고2","고3"];
const LEVELS=["SB","B","I","A","SA"];
const EXAM_TYPES=["단어시험","문법시험","종합시험","모의고사","수학테스트","Daily Test","해석테스트","WEEKLY TEST","MONTHLY TEST","기타"];

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
  // 화면 상태
  const[screen,setScreen]=useState("home"); // home, setup, direct, upload, saving, done

  // 반 추가
  const[ts,setTs]=useState("");const[tg,setTg]=useState("");const[tl,setTl]=useState("");const[tcl,setTcl]=useState("");
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

  // 상태
  const[saving,setSaving]=useState(false);const[done,setDone]=useState(false);const[error,setError]=useState("");

  const dateStr=examDate.replace(/-/g,".")+" "+examTime;

  // 반 추가
  const addClass=()=>{
    if(!ts)return alert("과목을 선택하세요.");if(!tg)return alert("학년을 선택하세요.");
    const lv=tl==="custom"?tcl:tl;if(!lv)return alert("레벨을 선택하세요.");
    const name=`${ts} ${tg} ${lv}반`;
    if(classes.some(c=>c.name===name))return alert("이미 추가된 반입니다.");
    setClasses(p=>[...p,{subject:ts,grade:tg,level:lv,name}]);setTl("");setTcl("");
  };

  // 시험정보 확인 → 모드 선택
  const goToMode=()=>{
    if(classes.length===0)return alert("반을 1개 이상 추가하세요.");
    if(!examType)return alert("시험 종류를 선택하세요.");
    setScreen("modeSelect");
  };

  // 직접입력 시작
  const startDirect=()=>{setAnswers(Array(qc).fill(null));setTypes(Array(qc).fill("obj"));setSubAns({});setScreen("direct");};

  // 답 입력
  const hAns=useCallback((i,v)=>{setAnswers(p=>{const n=[...p];n[i]=p[i]===v?null:v;return n;});},[]);
  const hType=useCallback(i=>{setTypes(p=>{const n=[...p];n[i]=p[i]==="obj"?"sub":"obj";return n;});setAnswers(p=>{const n=[...p];n[i]=null;return n;});setSubAns(p=>{const n={...p};delete n[i];return n;});},[]);
  const hSub=useCallback((i,v)=>{setSubAns(p=>({...p,[i]:v}));setAnswers(p=>{const n=[...p];n[i]=v;return n;});},[]);

  const filled=answers.filter(a=>a!==null&&a!=="").length;

  // 직접입력 저장
  const saveDirect=async()=>{
    if(filled===0)return alert("최소 1문항 이상 정답을 입력하세요.");
    setSaving(true);setError("");
    try{
      for(const cls of classes){
        await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"save_answer_key",subject:cls.subject,grade:cls.grade,level:cls.level,examType,round:"",totalQuestions:qc,answers,types})});
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
        body:JSON.stringify({action:"upload_exam",classes:classes.map(c=>({subject:c.subject,grade:c.grade,level:c.level})),classNames:classes.map(c=>c.name).join(", "),examType,date:dateStr,memo,answerFiles:aData,examFiles:eData})});
      setDone(true);setScreen("done");
    }catch(e){setError("업로드 실패. 다시 시도해주세요.");}
    setSaving(false);
  };

  const reset=()=>{setScreen("home");setTs("");setTg("");setTl("");setTcl("");setClasses([]);setExamType("");setExamFiles([]);setAnswerFiles([]);setMemo("");setAnswers([]);setTypes([]);setSubAns({});setDone(false);setError("");setTotalQ(50);setCustomQ("");
    const d=new Date();setExamDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);setExamTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`);};

  return(
    <div style={S.app}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}body{font-family:'Noto Sans KR',-apple-system,sans-serif;background:${T.bg}}input:focus,textarea:focus{outline:none;border-color:${T.gold}!important;box-shadow:0 0 0 3px ${T.goldLight}!important}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes spin{to{transform:rotate(360deg)}}.fade-up{animation:fadeUp .3s ease-out}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}`}</style>

      <header style={S.hdr}><div style={S.hdrIn}><div style={S.logoR}><div style={S.logoM}>채움</div><div><div style={S.hdrT}>채움학원</div><div style={S.hdrS}>시험 등록 (선생님용)</div></div></div></div></header>

      {/* ═══ 홈: 시험 정보 설정 ═══ */}
      {screen==="home"&&(<div style={S.wrap} className="fade-up">
        <div style={{textAlign:"center",padding:"20px 0 12px"}}><div style={{fontSize:36,marginBottom:4}}>📋</div><h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:4}}>시험 등록</h1><p style={{fontSize:13,color:T.textMuted}}>시험 대상 반과 정보를 설정하세요</p></div>

        <div style={S.card}>
          <div style={S.secLabel}>시험 대상 반 추가</div>
          <Chip label="과목" req opts={SUBJECTS} val={ts} onChange={setTs}/>
          <Chip label="학년" req opts={GRADES} val={tg} onChange={setTg}/>
          <div style={{marginBottom:14}}>
            <div style={S.label}>레벨 <span style={{color:T.danger}}>*</span></div>
            <div style={S.cw}>
              {LEVELS.map(lv=>(<button key={lv} onClick={()=>{setTl(lv);setTcl("");}} style={{...S.ch,background:tl===lv?T.goldDark:T.white,color:tl===lv?T.white:T.textSub,borderColor:tl===lv?T.goldDark:T.border,fontWeight:tl===lv?700:500}}>{lv}</button>))}
              <button onClick={()=>setTl("custom")} style={{...S.ch,background:tl==="custom"?T.goldDark:T.white,color:tl==="custom"?T.white:T.textSub,borderColor:tl==="custom"?T.goldDark:T.border,fontWeight:tl==="custom"?700:500}}>기타</button>
            </div>
            {tl==="custom"&&<input style={{...S.inp,marginTop:6}} placeholder="레벨 직접 입력" value={tcl} onChange={e=>setTcl(e.target.value)}/>}
          </div>
          {ts&&tg&&(tl&&tl!=="custom"||tcl)&&(<div style={S.addRow}>
            <div style={{fontSize:14,fontWeight:700,color:T.goldDark}}>{ts} {tg} {tl==="custom"?tcl:tl}반</div>
            <button onClick={addClass} style={S.addBtn}>+ 반 추가</button>
          </div>)}
          {classes.length>0&&(<div style={{marginTop:12}}>
            <div style={{fontSize:12,fontWeight:600,color:T.textMuted,marginBottom:6}}>추가된 반 ({classes.length}개)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{classes.map((c,i)=>(<div key={i} style={S.tag}><span>{c.name}</span><button onClick={()=>setClasses(p=>p.filter((_,j)=>j!==i))} style={S.tagX}>×</button></div>))}</div>
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

      {/* ═══ 모드 선택 ═══ */}
      {screen==="modeSelect"&&(<div style={S.wrap} className="fade-up">
        <div style={{textAlign:"center",padding:"20px 0 16px"}}><h2 style={{fontSize:20,fontWeight:800,color:T.text,marginBottom:8}}>정답 등록 방식 선택</h2>
          <p style={{fontSize:13,color:T.textMuted}}>어떤 방식으로 정답을 등록할까요?</p></div>

        {/* 미리보기 */}
        <div style={{...S.card,background:T.goldPale,border:`1px solid ${T.goldMuted}`}}>
          <div style={{fontSize:12,color:T.textMuted}}>등록 대상</div>
          <div style={{fontSize:14,fontWeight:700,color:T.goldDark,marginTop:2}}>{classes.map(c=>c.name).join(", ")}</div>
          <div style={{fontSize:12,color:T.textMuted,marginTop:6}}>시험 종류</div>
          <div style={{fontSize:14,fontWeight:700,color:T.goldDark,marginTop:2}}>{examType} · {dateStr}</div>
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

      {/* ═══ 직접입력: 문항수 설정 ═══ */}
      {screen==="directSetup"&&(<div style={S.wrap} className="fade-up">
        <div style={S.card}>
          <div style={S.secLabel}>문항 수 설정</div>
          <div style={S.cw}>
            {[30,50,72,100,200,300].map(n=>(<button key={n} onClick={()=>{setTotalQ(n);setCustomQ("");}} style={{...S.ch,background:!customQ&&totalQ===n?T.goldDark:T.white,color:!customQ&&totalQ===n?T.white:T.textSub,borderColor:!customQ&&totalQ===n?T.goldDark:T.border,fontWeight:!customQ&&totalQ===n?700:500}}>{n}</button>))}
            <input style={S.chInp} placeholder="직접" value={customQ} onChange={e=>setCustomQ(e.target.value.replace(/[^0-9]/g,""))} onFocus={()=>setTotalQ(0)}/>
          </div>
          <button style={{...S.btnG,marginTop:16}} onClick={startDirect}>정답 입력 시작 →</button>
          <button style={{...S.btnO,width:"100%",marginTop:8}} onClick={()=>setScreen("modeSelect")}>← 뒤로</button>
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

        <div style={{padding:"8px 10px 100px"}}>
          {Array.from({length:qc},(_,i)=>{const isObj=types[i]==="obj";const sel=answers[i];const fi=sel!==null&&sel!=="";
            return(<div key={i} style={{...S.qRow,borderLeft:fi?`3px solid ${isObj?T.gold:T.accent}`:`3px solid transparent`,background:fi?(isObj?T.goldPale:T.accentLight+"66"):T.white}}>
              <div style={{...S.qNum,background:fi?(isObj?T.gold:T.accent):T.borderLight,color:fi?T.white:T.textMuted}}>{i+1}</div>
              <button onClick={()=>hType(i)} style={{padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:700,border:`1px solid ${isObj?T.border:T.accent}`,cursor:"pointer",fontFamily:"inherit",background:isObj?T.white:T.accentLight,color:isObj?T.textMuted:T.accent,flex:"0 0 auto"}}>{isObj?"객":"주"}</button>
              {isObj?(<div style={{display:"flex",gap:4,flex:1}}>{[1,2,3,4,5].map(v=>{const p=sel===v;return(<button key={v} onClick={()=>hAns(i,v)} style={{...S.cBtn,background:p?T.goldDark:T.white,color:p?T.white:T.text,borderColor:p?T.goldDark:T.border,fontWeight:p?700:400}}>{v}</button>);})}</div>
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
            <div style={S.resRow}><span>대상 반</span><span style={{fontWeight:600}}>{classes.map(c=>c.name).join(", ")}</span></div>
            <div style={S.resRow}><span>시험 종류</span><span style={{fontWeight:600}}>{examType}</span></div>
            <div style={S.resRow}><span>날짜/시간</span><span style={{fontWeight:600}}>{dateStr}</span></div>
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
};
