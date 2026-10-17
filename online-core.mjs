// Núcleo determinístico para a futura integração com o Firestore.
// Não habilitar gravações diretas no Firestore antes de validar as transições nas Security Rules.
export const ATTRIBUTES = ['Tecnologia','Armamento','Sabedoria','Economia'];
export function createCivilization(uid,name){
  if(typeof uid!=='string'||!uid||typeof name!=='string'||!name.trim())throw Error('Jogador inválido');
  return {uid,name:name.trim().slice(0,80),coins:3,attributes:Object.fromEntries(ATTRIBUTES.map(a=>[a,0])),hand:[],objectives:[],completed:[],dom:false,trade:false,protected:false};
}
export function initialMatch(members){
  if(!Array.isArray(members)||members.length<2||members.length>6)throw Error('São necessários 2 a 6 jogadores');
  if(new Set(members.map(m=>m.uid)).size!==members.length)throw Error('Jogadores repetidos');
  return {version:1,phase:'pre',round:1,turnIndex:0,turnNumber:1,players:members.map(m=>createCivilization(m.uid,m.name)),rolls:0,remaining:0,choice:null,winner:null,agreements:[],pendingOffers:[],hostilities:[]};
}
export function currentPlayer(state){return state.players[state.turnIndex]}
export function economyIncome(level){return level>=11?3:level>=6?2:1}
export function diceSides(level){return level>=11?6:level>=6?5:4}
export function handLimit(level){return level>=11?5:level>=6?4:3}
function requireTurn(s,uid){if(s.winner)throw Error('Partida encerrada');if(currentPlayer(s)?.uid!==uid)throw Error('Não é sua vez')}
function copy(s){return structuredClone(s)}
export function roll(state,uid,face){
  requireTurn(state,uid);const s=copy(state),p=currentPlayer(s);
  if(s.phase!=='pre'&&s.phase!=='after')throw Error('Lançamento indisponível');
  if(s.rolls>=3)throw Error('Limite de lançamentos');
  const sides=diceSides(p.attributes.Tecnologia);
  if(!Number.isInteger(face)||face<1||face>sides)throw Error('Resultado de dado inválido');
  if(s.rolls>0){if(p.coins<4)throw Error('Moedas insuficientes');p.coins-=4}
  s.rolls++;s.remaining=face;s.choice=null;s.phase='buy';return s;
}
export function buyLevel(state,uid,attribute){
  requireTurn(state,uid);const s=copy(state),p=currentPlayer(s);
  if(s.phase!=='buy'||s.remaining<1)throw Error('Compras indisponíveis');
  if(!ATTRIBUTES.includes(attribute))throw Error('Atributo inválido');
  if(s.choice==='card')throw Error('Não é possível misturar carta e nível neste lançamento');
  const cost=p.attributes[attribute]>=10?5:2;
  if(p.attributes[attribute]>=12||p.coins<cost)throw Error('Limite do atributo ou moedas insuficientes');
  p.coins-=cost;p.attributes[attribute]++;s.remaining--;s.choice='level';return s;
}
export function finishPurchase(state,uid){
  requireTurn(state,uid);if(state.phase!=='buy')throw Error('Não há compras em andamento');
  const s=copy(state);s.remaining=0;s.phase='after';return s;
}
export function endTurn(state,uid){
  requireTurn(state,uid);const s=copy(state);if(s.phase==='buy')throw Error('Encerre as compras primeiro');
  s.turnIndex=(s.turnIndex+1)%s.players.length;
  if(s.turnIndex===0)s.round++;
  s.turnNumber++;s.phase='pre';s.rolls=0;s.remaining=0;s.choice=null;
  const p=currentPlayer(s);p.coins+=economyIncome(p.attributes.Economia);p.protected=false;
  return s;
}

// O sorteio deve ser feito por mecanismo confiável antes de chamar estas transições.
// O navegador do jogador não deve poder escolher o resultado do dado nem a carta.
export const ACTION_CARDS = Object.freeze([
  ['Roubo',4,'steal'],['Investimento',4,'invest'],['Crise Econômica',3,'crisis'],
  ['Imposto',3,'tax'],['Sabotagem Tecnológica',3,'techdown'],['Ataque Militar',3,'armdown'],
  ['Crise Educacional',3,'wisdown'],['Sabotagem Econômica',3,'ecodown'],
  ['Descoberta Científica',2,'techup'],['Treinamento Militar',2,'armup'],
  ['Revolução Intelectual',2,'wisup'],['Crescimento Econômico',2,'ecoup'],
  ['Domínio',2,'dominate'],['Roubo de Carta',2,'cardsteal'],['Proteção',2,'shield']
]);
export function cardPool(){return ACTION_CARDS.flatMap((card,i)=>Array(card[1]).fill(i))}
export function buyCard(state,uid,cardId){
  requireTurn(state,uid);
  const s=copy(state),p=currentPlayer(s);
  if(s.phase!=='buy'||s.remaining<1)throw Error('Compras indisponíveis');
  if(s.choice==='level')throw Error('Não é possível misturar carta e nível neste lançamento');
  if(p.coins<1)throw Error('Moedas insuficientes');
  if(p.hand.length>=handLimit(p.attributes.Sabedoria))throw Error('Limite de cartas atingido');
  if(!Number.isInteger(cardId)||cardId<0||cardId>=ACTION_CARDS.length)throw Error('Carta inválida');
  p.coins--;p.hand.push(cardId);s.remaining--;s.choice='card';return s;
}
export function playSelfCard(state,uid,handIndex){
  requireTurn(state,uid);const s=copy(state),p=currentPlayer(s);
  if(s.phase!=='pre')throw Error('Cartas de ação só podem ser usadas antes do dado');
  if(!Number.isInteger(handIndex)||handIndex<0||handIndex>=p.hand.length)throw Error('Carta não encontrada');
  const id=p.hand[handIndex],type=ACTION_CARDS[id]?.[2];
  const boosts={techup:'Tecnologia',armup:'Armamento',wisup:'Sabedoria',ecoup:'Economia'};
  if(type==='invest')p.coins+=3;
  else if(type==='shield')p.protected=true;
  else if(boosts[type])p.attributes[boosts[type]]=Math.min(12,p.attributes[boosts[type]]+1);
  else throw Error('Esta carta requer ação contra outro jogador ou tratamento específico');
  p.hand.splice(handIndex,1);return s;
}

// Cartas ofensivas com efeitos inequívocos. Não inclui Domínio, Roubo,
// Roubo de Carta nem acordos: suas transições exigem regras adicionais.
export function playTargetCard(state,uid,handIndex,targetUid){
  requireTurn(state,uid);
  const s=copy(state),actor=currentPlayer(s);
  if(s.phase!=='pre')throw Error('Cartas de ação só podem ser usadas antes do dado');
  if(!Number.isInteger(handIndex)||handIndex<0||handIndex>=actor.hand.length)throw Error('Carta não encontrada');
  if(typeof targetUid!=='string'||targetUid===uid)throw Error('Alvo inválido');
  const target=s.players.find(p=>p.uid===targetUid);
  if(!target)throw Error('Jogador alvo não encontrado');
  const id=actor.hand[handIndex],type=ACTION_CARDS[id]?.[2];
  const debuffs={techdown:'Tecnologia',armdown:'Armamento',wisdown:'Sabedoria',ecodown:'Economia'};
  if(!(type in debuffs)&&type!=='crisis')throw Error('Carta exige outra mecânica');
  if(target.protected)throw Error('Jogador protegido contra ações hostis');
  if(isNonAggressionActive(s,uid,targetUid))throw Error('Acordo de não agressão vigente');
  if(type==='crisis')target.coins=Math.max(0,target.coins-3);
  else target.attributes[debuffs[type]]=Math.max(0,target.attributes[debuffs[type]]-1);
  actor.hand.splice(handIndex,1);
  s.hostilities.push({attacker:uid,target:targetUid,turn:s.turnNumber});
  return s;
}

// Imposto: efeito coletivo. Se algum adversário estiver protegido,
// ele não paga; o autor recebe somente o valor efetivamente retirado.
export function playTaxCard(state,uid,handIndex){
  requireTurn(state,uid);
  const s=copy(state),actor=currentPlayer(s);
  if(s.phase!=='pre')throw Error('Cartas de ação só podem ser usadas antes do dado');
  if(!Number.isInteger(handIndex)||handIndex<0||handIndex>=actor.hand.length)throw Error('Carta não encontrada');
  if(ACTION_CARDS[actor.hand[handIndex]]?.[2]!=='tax')throw Error('Esta carta não é Imposto');
  for(const p of s.players){
    if(p.uid!==uid&&!p.protected&&!isNonAggressionActive(s,uid,p.uid)&&p.coins>0){p.coins--;actor.coins++}
  }
  actor.hand.splice(handIndex,1);
  return s;
}

// Acordos: proponente paga 1 moeda no momento da proposta, mesmo se recusada.
// Ao aceitar, destinatário recebe essa moeda; se recusar, a moeda fica consumida.
// O aceite impede o destinatário de atacar o proponente por duas rodadas completas
// e o proponente de atacar o destinatário até encerrar seu turno atual.
export function isNonAggressionActive(state,attackerUid,targetUid){
  return (state.agreements||[]).some(a=>
    (a.proposer===attackerUid&&a.recipient===targetUid&&state.turnNumber<=a.proposerUntilTurn) ||
    (a.recipient===attackerUid&&a.proposer===targetUid&&state.round<=a.recipientUntilRound));
}
export function proposeAgreement(state,uid,targetUid){
  requireTurn(state,uid);const s=copy(state),p=currentPlayer(s);
  if(s.phase!=='pre')throw Error('Acordos somente antes do dado');
  if(uid===targetUid||!s.players.some(x=>x.uid===targetUid))throw Error('Destinatário inválido');
  if(p.coins<1)throw Error('Moedas insuficientes');
  if((s.pendingOffers||[]).some(x=>x.proposer===uid&&x.recipient===targetUid))throw Error('Proposta já pendente');
  if((s.hostilities||[]).some(x=>x.attacker===uid&&x.target===targetUid&&x.turn===s.turnNumber))throw Error('Não pode propor após atacar o destinatário');
  p.coins--;s.pendingOffers.push({proposer:uid,recipient:targetUid,turn:s.turnNumber});return s;
}
export function respondAgreement(state,uid,proposerUid,accept){
  const s=copy(state);if(s.winner)throw Error('Partida encerrada');
  const i=(s.pendingOffers||[]).findIndex(x=>x.proposer===proposerUid&&x.recipient===uid);
  if(i<0)throw Error('Proposta não encontrada');
  if(typeof accept!=='boolean')throw Error('Resposta inválida');
  s.pendingOffers.splice(i,1);
  if(accept){
    s.players.find(p=>p.uid===uid).coins++;
    s.players.find(p=>p.uid===proposerUid).trade=true;s.players.find(p=>p.uid===uid).trade=true;
    s.agreements.push({proposer:proposerUid,recipient:uid,proposerUntilTurn:s.turnNumber,recipientUntilRound:s.round+2});
  }
  return s;
}
// Domínio consome carta especial; a escolha de recompensa é explícita e validada.
// 'coins': até cinco moedas do alvo; 'levels': dois níveis transferidos,
// indicados por dois atributos; 'cards': até duas cartas escolhidas por índices.
// No online, índices/cartas privados exigirão um protocolo protegido separado.
export function playDomination(state,uid,handIndex,targetUid,reward){
  requireTurn(state,uid);const s=copy(state),actor=currentPlayer(s);
  if(s.phase!=='pre')throw Error('Domínio somente antes do dado');
  if(!Number.isInteger(handIndex)||handIndex<0||handIndex>=actor.hand.length||ACTION_CARDS[actor.hand[handIndex]]?.[2]!=='dominate')throw Error('Carta Domínio necessária');
  const target=s.players.find(p=>p.uid===targetUid);
  if(!target||target.uid===uid)throw Error('Alvo inválido');
  if(target.protected||isNonAggressionActive(s,uid,targetUid))throw Error('Jogador protegido ou acordo vigente');
  if(actor.attributes.Armamento<target.attributes.Armamento+2)throw Error('Armamento insuficiente para Domínio');
  if(!reward||typeof reward!=='object')throw Error('Recompensa inválida');
  if(reward.type==='coins'){
    const n=Math.min(5,target.coins);target.coins-=n;actor.coins+=n;
  }else if(reward.type==='levels'){
    if(!Array.isArray(reward.attributes)||reward.attributes.length!==2||reward.attributes.some(a=>!ATTRIBUTES.includes(a)))throw Error('Selecione dois níveis');
    for(const a of reward.attributes){
      if(target.attributes[a]<1||actor.attributes[a]>=12)throw Error('Transferência de nível impossível');
      target.attributes[a]--;actor.attributes[a]++;
    }
  }else if(reward.type==='cards'){
    const ids=reward.indices;
    if(!Array.isArray(ids)||ids.length!==2||new Set(ids).size!==2||ids.some(i=>!Number.isInteger(i)||i<0||i>=target.hand.length))throw Error('Escolha duas cartas válidas');
    if(actor.hand.length-1+2>handLimit(actor.attributes.Sabedoria))throw Error('Mão sem espaço');
    const chosen=ids.map(i=>target.hand[i]);target.hand=target.hand.filter((_,i)=>!ids.includes(i));actor.hand.push(...chosen);
  }else throw Error('Tipo de recompensa inválido');
  actor.hand.splice(handIndex,1);actor.dom=true;
  s.hostilities.push({attacker:uid,target:targetUid,turn:s.turnNumber});return s;
}

// Objetivos extraídos da tabela `raw` do index.html original (30 cartas).
// A atribuição deve ser aleatória e confiável, fora do controle do jogador.
export const OBJECTIVES = Object.freeze([["Carros Voadores","Tecnologia",{"Tecnologia":8,"Economia":4},20],["Inteligência Artificial","Tecnologia",{"Tecnologia":9,"Sabedoria":6},18],["Colonização Espacial","Tecnologia",{"Tecnologia":11,"Economia":5},15],["Revolução Energética","Tecnologia",{"Tecnologia":8,"Sabedoria":5},22],["Rede de Transporte Global","Tecnologia",{"Tecnologia":9,"Economia":6},18],["Cidade Automatizada","Tecnologia",{"Tecnologia":10,"Sabedoria":6},16],["Império Dominante","Militar",{"Tecnologia":7},19,"dom"],["Supremacia Militar","Militar",{"Armamento":10,"Tecnologia":6},18],["Conquista Territorial","Militar",{"Economia":7},20,"dom"],["Fortaleza Impenetrável","Militar",{"Armamento":8,"Tecnologia":6},20],["Potência Militar Mundial","Militar",{"Armamento":11,"Economia":5},15],["Domínio Estratégico","Militar",{"Sabedoria":8},19,"dom"],["Centro Financeiro Mundial","Economia",{"Economia":8,"Sabedoria":5},25],["Revolução Industrial","Economia",{"Economia":9,"Tecnologia":6},20],["Império Comercial","Economia",{"Economia":8,"Tecnologia":5},28],["Potência Econômica","Economia",{"Economia":11,"Sabedoria":5},15],["Mercado Internacional","Economia",{"Economia":8,"Sabedoria":6},20,"trade"],["Megacorporação","Economia",{"Economia":10,"Tecnologia":6},18],["Universidade Mundial","Sabedoria",{"Sabedoria":8,"Economia":5},22],["Sociedade Iluminada","Sabedoria",{"Sabedoria":9,"Tecnologia":6},20],["Biblioteca Universal","Sabedoria",{"Sabedoria":8,"Tecnologia":5},25],["Era do Conhecimento","Sabedoria",{"Sabedoria":11,"Economia":5},15],["Academia de Estratégia","Sabedoria",{"Sabedoria":9,"Armamento":6},20],["Conselho das Civilizações","Sabedoria",{"Sabedoria":8,"Economia":6},20,"trade"],["Civilização Autossuficiente","Multidisciplinar",{"Economia":8,"Tecnologia":8},18],["Metrópole Futurista","Multidisciplinar",{"Tecnologia":9,"Economia":7},20],["Império do Conhecimento","Multidisciplinar",{"Sabedoria":8,"Tecnologia":7,"Economia":5},18],["Superpotência Global","Multidisciplinar",{"Armamento":8,"Tecnologia":7,"Economia":5},18],["Era da Prosperidade","Multidisciplinar",{"Economia":8,"Sabedoria":8},18],["Civilização Suprema","Multidisciplinar",{"Tecnologia":8,"Sabedoria":7,"Armamento":6},18]]);
export function assignObjectives(state, assignments){
  const s=copy(state);
  if(s.turnNumber!==1||s.phase!=='pre'||s.players.some(p=>p.objectives.length||p.completed.length))throw Error('Objetivos já distribuídos ou partida iniciada');
  if(!assignments||typeof assignments!=='object'||Object.keys(assignments).length!==s.players.length)throw Error('Distribuição incompleta');
  const all=[];
  for(const p of s.players){
    const ids=assignments[p.uid];
    if(!Array.isArray(ids)||ids.length!==2||ids.some(id=>!Number.isInteger(id)||id<0||id>=OBJECTIVES.length))throw Error('Objetivos inválidos');
    if(ids[0]===ids[1]||OBJECTIVES[ids[0]][1]===OBJECTIVES[ids[1]][1])throw Error('Objetivos precisam ter categorias diferentes');
    p.objectives=[...ids];all.push(...ids);
  }
  if(new Set(all).size!==all.length)throw Error('Objetivos duplicados entre jogadores');
  return s;
}
export function canCompleteObjective(state,uid,objectiveId){
  const p=state.players.find(x=>x.uid===uid);
  if(!p||!p.objectives.includes(objectiveId)||p.completed.includes(objectiveId))return false;
  const objective=OBJECTIVES[objectiveId];if(!objective)return false;
  const [,category,required,cost,special]=objective;
  if(p.coins<cost||Object.entries(required).some(([attribute,level])=>p.attributes[attribute]<level))return false;
  if(special==='dom'&&!p.dom)return false;
  if(special==='trade'&&!p.trade)return false;
  return true;
}
export function completeObjective(state,uid,objectiveId){
  requireTurn(state,uid);
  if(!canCompleteObjective(state,uid,objectiveId))throw Error('Requisitos do objetivo não atendidos');
  const s=copy(state),p=currentPlayer(s);
  p.coins-=OBJECTIVES[objectiveId][3];p.completed.push(objectiveId);
  if(p.completed.length===2)s.winner=uid;
  return s;
}
