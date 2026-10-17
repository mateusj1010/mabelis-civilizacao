import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,getDoc,onSnapshot,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
const cfg={apiKey:'AIzaSyABVeSs1KA16YXDsqhTJpJavyWF-K0NKeY',authDomain:'mabelis-civilizacao.firebaseapp.com',projectId:'mabelis-civilizacao',storageBucket:'mabelis-civilizacao.firebasestorage.app',messagingSenderId:'1077152274878',appId:'1:1077152274878:web:5277faf0224490d4fcc1ef'};
const roomId=new URLSearchParams(location.search).get('sala');
if(roomId){
 const app=initializeApp(cfg,'mabelis-casual-board'),auth=getAuth(app),db=getFirestore(app);
 const roomRef=doc(db,'rooms',roomId),gameRef=doc(db,'casualGames',roomId);
 let previousState=null,notificationsInitialized=false,toastQueue=[],toastTimer=null;
 let user=null,room=null,remoteRev=-1,pending=false,applying=false,ready=false,localUidOrder=[],lastJSON='',stopGame=null,stopRoom=null,stopPlayer=null;
 const curtain=document.createElement('div');curtain.id='online-curtain';curtain.style.cssText='position:fixed;inset:0;z-index:999998;background:#142533ee;color:white;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:18px system-ui';document.body.append(curtain);
 const notice=t=>{curtain.textContent=t;curtain.style.display='flex'};
 // Avisos individuais, temporários e sem histórico compartilhado.
 const alertBox=document.createElement('div');alertBox.id='mabelis-alerts';
 alertBox.style.cssText='position:fixed;top:12px;right:12px;z-index:999997;max-width:min(350px,calc(100vw - 24px));display:flex;flex-direction:column;gap:8px;pointer-events:none';
 document.body.append(alertBox);
 function toast(title,body,important=false){
  const el=document.createElement('div');el.setAttribute('role','status');
  el.style.cssText='pointer-events:auto;background:#1b2b3a;color:#fff;border:1px solid #d2b576;border-radius:12px;padding:12px 15px;box-shadow:0 6px 25px #0008;font:14px system-ui;line-height:1.4';
  const heading=document.createElement('strong');heading.textContent=title;heading.style.color='#f1d58b';el.append(heading);
  const description=document.createElement('div');description.textContent=body;description.style.marginTop='5px';el.append(description);
  const close=document.createElement('button');close.textContent='✕';close.setAttribute('aria-label','Fechar notificação');close.style.cssText='float:right;background:transparent;border:0;color:white;cursor:pointer;margin-top:-40px';close.onclick=()=>el.remove();el.append(close);
  alertBox.prepend(el);while(alertBox.childElementCount>3)alertBox.lastElementChild.remove();
  if(!important)setTimeout(()=>el.remove(),8500);
 }
 function receiveNotifications(oldState,nextState){
  const i=localUidOrder.indexOf(user?.uid);if(i<0)return;
  const old=oldState?.players?.[i],now=nextState?.players?.[i];if(!old||!now)return;
  const actor=nextState.players?.[oldState.turn]?.name||'Outro jogador';
  if(now.coins<old.coins && oldState.turn!==i)toast('🪙 Moedas reduzidas',`Sua civilização perdeu ${old.coins-now.coins} moeda(s).`);
  for(const a of ['Tecnologia','Armamento','Sabedoria','Economia'])if(oldState.turn!==i&&(now.a?.[a]??0)<(old.a?.[a]??0))toast('⚠️ Ação recebida',`Seu nível de ${a} diminuiu de ${old.a[a]} para ${now.a[a]}.`);
  if((now.hand?.length??0)<(old.hand?.length??0)&&oldState.turn!==i)toast('🃏 Cartas alteradas','Sua civilização perdeu carta(s). Confira sua mão.');
  if(old.shield&&!now.shield&&oldState.turn!==i)toast('🛡️ Proteção encerrada','Sua proteção não está mais ativa.');
  const was=oldState.pendingAgreement,has=nextState.pendingAgreement;
  if(has?.acceptor===i&&(!was||was.proposer!==has.proposer||was.acceptor!==has.acceptor))toast('🤝 Proposta de acordo',`${nextState.players[has.proposer]?.name||'Um jogador'} propôs um acordo. Responda na notificação de acordo.`,true);
  if(was?.acceptor===i&&!has)toast('🤝 Acordo respondido','Sua proposta recebida foi resolvida.');
 }
 const agreementBox=document.createElement('div');agreementBox.id='mabelis-agreement';
 agreementBox.style.cssText='position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:999999;background:#203248;border:2px solid #e6c780;border-radius:14px;color:white;padding:15px;max-width:440px;width:calc(100vw - 24px);box-shadow:0 8px 32px #000a;font:15px system-ui;display:none;text-align:center';
 document.body.append(agreementBox);
 function showPendingAgreement(state){
  const a=state?.pendingAgreement,i=localUidOrder.indexOf(user?.uid);
  if(!a||a.acceptor!==i||room?.status!=='playing'){agreementBox.style.display='none';return}
  agreementBox.style.display='block';agreementBox.replaceChildren();
  const h=document.createElement('strong');h.textContent='🤝 PROPOSTA DE ACORDO';h.style.color='#f3d58b';agreementBox.append(h);
  const p=document.createElement('p');p.textContent=`${state.players[a.proposer]?.name||'Um jogador'} propôs um acordo. Se aceitar, você recebe 1 moeda e ambos ficam impedidos de atacar um ao outro por duas rodadas.`;agreementBox.append(p);
  for(const [label,accept] of [['ACEITAR',true],['RECUSAR',false]]){
   const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:5px;padding:9px 16px;border:0;border-radius:7px;background:'+(accept?'#527b58':'#794c4c')+';color:white;font-weight:bold;cursor:pointer';
   b.onclick=()=>answerRemoteAgreement(accept);agreementBox.append(b)
  }
 }
 async function answerRemoteAgreement(accept){
  if(!user||pending)return;
  agreementBox.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await runTransaction(db,async tx=>{
   const snap=await tx.get(gameRef);if(!snap.exists())throw Error('Partida não encontrada.');
   const g=snap.data(),state=structuredClone(g.state),a=state.pendingAgreement;
   const i=localUidOrder.indexOf(user.uid);
   if(!a||a.acceptor!==i)throw Error('Esta proposta já foi respondida.');
   if(accept){state.players[a.acceptor].coins++;
    state.players[a.proposer].trade=true;
    state.agreements??=[];state.agreements.push({...a,remaining:2});
   }
   state.pendingAgreement=null;
   tx.update(gameRef,{state,revision:g.revision+1,turnUid:g.turnUid,updatedAt:serverTimestamp()});
  });
  }catch(e){toast('Não foi possível responder',e.message,true)}finally{showPendingAgreement(window.mabelisCurrentState?.())}
 }
 function lock(){if(!window.mabelisCurrentState?.()||!room)return true;return !ready||room.status!=='playing'||localUidOrder[window.mabelisCurrentState().turn]!==user?.uid}
 function showLock(){if(!ready){notice('Conectando à partida...');return}const state=window.mabelisCurrentState?.();const viewer=localUidOrder.indexOf(user?.uid);window.mabelisViewerIndex=viewer;window.mabelisSpectatorMode=!!state&&viewer>=0&&state.turn!==viewer;if(window.mabelisSpectatorMode)window.mabelisSpectatorRefresh?.();else if(state)window.mabelisSpectatorRefresh?.();curtain.style.display='none'}
 function setState(state,rev){applying=true;try{
  state.agreements??=[];state.attackedThisTurn??=[];
  if(notificationsInitialized&&previousState)receiveNotifications(previousState,state);
  previousState=structuredClone(state);notificationsInitialized=true;
  remoteRev=rev;lastJSON=JSON.stringify(state);
  window.mabelisSetState(state,rev);ready=true;showLock();showPendingAgreement(state);
  if(!state.pendingAgreement&&document.getElementById('mt')?.textContent?.startsWith('Aguardando resposta de '))document.getElementById('overlay')?.classList.add('hidden');
 }finally{applying=false}}
 // Existing global `let S` is a global lexical binding, not window.S. Use a controlled bridge installed below.
 window.MABELIS_ONLINE={afterRemote:rev=>{},save:state=>{if(applying||!ready||pending||!room||!user||localUidOrder[JSON.parse(lastJSON).turn]!==user.uid)return;const json=JSON.stringify(state);if(json===lastJSON)return;pending=true;runTransaction(db,async tx=>{const snap=await tx.get(gameRef);if(!snap.exists()||snap.data().revision!==remoteRev)throw Error('A partida mudou em outro aparelho.');if(snap.data().turnUid!==user.uid)throw Error('Não é seu turno.');tx.update(gameRef,{state:JSON.parse(json),revision:remoteRev+1,turnUid:localUidOrder[state.turn],updatedAt:serverTimestamp()})}).catch(e=>{notice('Jogada não sincronizada: '+e.message+' Atualize a página.');ready=false}).finally(()=>pending=false)},getRoom:()=>room};
 // Bridge to the original script lexical S, using a small explicit global adapter.
 const wait=async u=>{user=u;previousState=null;notificationsInitialized=false;agreementBox.style.display='none';alertBox.replaceChildren();if(stopRoom)stopRoom();if(stopGame)stopGame();if(stopPlayer)stopPlayer();if(!u){notice('Entre com sua conta Google. Clique para fazer login.');curtain.onclick=()=>signInWithPopup(auth,new GoogleAuthProvider());return}
  const player=await getDoc(doc(db,'players',u.uid));if(u.uid!=='f14sjW0rsHU0avm3m7LPYfAIIRF3'&&player.data()?.status!=='approved'){notice('Sua conta não está aprovada.');return}
  stopPlayer=onSnapshot(doc(db,'players',u.uid),p=>{if(u.uid!=='f14sjW0rsHU0avm3m7LPYfAIIRF3'&&p.data()?.status!=='approved'){ready=false;notice('Acesso bloqueado.')}});
  stopRoom=onSnapshot(roomRef,async snap=>{if(!snap.exists()){ready=false;agreementBox.style.display='none';notice('Sala encerrada.');return}room=snap.data();if(!Object.hasOwn(room.members||{},u.uid)||room.status!=='playing'){ready=false;agreementBox.style.display='none';notice('Você saiu desta sala. Volte ao menu principal.');curtain.onclick=()=>location.assign('index.html');return}localUidOrder=room.playerOrder||Object.keys(room.members).sort();if(!stopGame){stopGame=onSnapshot(gameRef,snap=>{if(!snap.exists()){if(room.hostUid===u.uid){notice('Iniciando tabuleiro...');createGame().catch(e=>notice('Erro ao iniciar: '+e.message))}else notice('Aguardando o criador preparar o tabuleiro.');return}const d=snap.data();if(d.revision===remoteRev)return;setState(d.state,d.revision);},e=>notice('Erro na leitura: '+e.message))}showLock()},e=>notice('Erro na sala: '+e.message));
 };
 async function createGame(){await runTransaction(db,async tx=>{const r=await tx.get(roomRef),g=await tx.get(gameRef);if(g.exists())return;if(!r.exists()||r.data().hostUid!==user.uid||r.data().status!=='playing')throw Error('Sala inválida');const ids=r.data().playerOrder||Object.keys(r.data().members).sort();const names=ids.map(id=>r.data().members[id]);const state=window.mabelisNewState(names);tx.set(gameRef,{state,revision:0,turnUid:ids[0],hostUid:user.uid,createdAt:serverTimestamp()})})}
 onAuthStateChanged(auth,u=>wait(u).catch(e=>notice('Falha na autenticação: '+e.message)));
}
