import {everydayPiecePresent,EVERYDAY_VARIANT_COLOURS,isEveryday,resetEveryday,type EverydayPieces} from './studio-everyday-state'
import type {Look} from './studio-state'
import hoopArt from '../assets/wardrobe/easy-everyday/v4/hoop.png'
import necklaceArt from '../assets/wardrobe/easy-everyday/v4/necklace.png'
import sunglassesArt from '../assets/wardrobe/easy-everyday/v4/sunglasses.png'

type PieceField='colour'|'lowerColour'|'shoeColour'|'accentColour'
type Hooks={read:()=>Look;commit:(fn:(look:Look)=>void)=>void;select:(field:PieceField)=>void;selected:()=>string;status:(text:string)=>void}
const pieces:[PieceField,string][]=[['colour','Top'],['lowerColour','Bottom'],['shoeColour','Shoes'],['accentColour','Bag']]
export function mountEveryday(h:Hooks){
 const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
 let accessoryMode=false
 const choose=(field:PieceField,change:(look:Look)=>void)=>{accessoryMode=false;h.commit(change);h.select(field)}
 get<HTMLSelectElement>('everydayTop').onchange=()=>{const value=get<HTMLSelectElement>('everydayTop').value as EverydayPieces['top'];choose('colour',s=>{s.everydayPieces.top=value;if(value!=='none'){s.colour=EVERYDAY_VARIANT_COLOURS[value]!;delete s.colourNames.colour}})}
 get<HTMLSelectElement>('everydayBottom').onchange=()=>{const value=get<HTMLSelectElement>('everydayBottom').value as EverydayPieces['bottom'];choose('lowerColour',s=>{s.everydayPieces.bottom=value;if(value!=='none'){s.lowerColour=EVERYDAY_VARIANT_COLOURS[value]!;delete s.colourNames.lowerColour}})}
 get<HTMLSelectElement>('everydayShoes').onchange=()=>{const value=get<HTMLSelectElement>('everydayShoes').value as EverydayPieces['shoes'];choose('shoeColour',s=>{s.everydayPieces.shoes=value;if(value!=='none'){s.shoeColour=EVERYDAY_VARIANT_COLOURS[value]!;delete s.colourNames.shoeColour}})}
 get<HTMLSelectElement>('everydayBag').onchange=()=>{const value=get<HTMLSelectElement>('everydayBag').value as 'none'|'crossbody'|'tote'|'shoulder';choose('accentColour',s=>{s.bag=value;if(value!=='none'){s.bagColour=EVERYDAY_VARIANT_COLOURS[value]!;delete s.colourNames.bagColour}})}
 const reset=(restore:boolean)=>{h.commit(s=>resetEveryday(s,restore));h.select('colour');h.status(restore?'Easy everyday restored. All four pieces are fitted to the model.':'Fresh canvas ready. The same model stays; add a top, bottom, shoes or bag.')}
 get('everydayFresh').onclick=()=>reset(false);get('everydayRestore').onclick=()=>reset(true)
 const showAccessories=()=>{accessoryMode=true;const inspector=document.querySelector<HTMLElement>('.inspector');if(inspector)inspector.dataset.mode='shape';get('editShape').setAttribute('aria-pressed','true');get('editColour').setAttribute('aria-pressed','false');h.select('accentColour')}
 for(const [id,key] of [['everydayEarrings','earrings'],['everydayNecklace','beads'],['everydaySunglasses','sunglasses']] as const)get<HTMLButtonElement>(id).onclick=()=>{accessoryMode=true;h.commit(s=>{s[key]=!s[key]});showAccessories()}
 get<HTMLButtonElement>('everydayClearAccessories').onclick=()=>{accessoryMode=true;h.commit(s=>{s.earrings=false;s.beads=false;s.sunglasses=false});showAccessories();h.status('Everyday accessories cleared. Undo brings them back.')}
 return {sync(){
  const look=h.read(),active=isEveryday(look),field=h.selected()
  document.body.classList.toggle('everyday-pilot',active)
  get('everydayControls').hidden=!active;get('everydayAccessories').hidden=!active;get('editColour').hidden=false;get('everydayBaseNote').hidden=!active;get('figureGeometry').hidden=active;get('familyLaunch').hidden=active
  get('editShape').textContent=active?'Pieces':'Shape & details';get('editColour').textContent=active?'Colour':'Colour & fabric'
  get('colourTarget').hidden=active;document.querySelector<HTMLLabelElement>('label[for="colourTarget"]')!.hidden=active
  get('placementEmpty').textContent=active?'Add a piece below to start arranging.':'Add an outfit from Wardrobe to arrange its pieces.'
  get('figureHeading').innerHTML=active?'Your Easy<br>everyday model.':'A figure that<br>feels like you.'
  get('figureIntro').textContent=active?'Dress this model one piece at a time.':'An illustration guide for your ideas.'
  get('blankFigure').textContent=active?'Start fresh on this model':'Clear outfit on figure'
  if(!active){accessoryMode=false;return}
  get<HTMLSelectElement>('everydayTop').value=look.everydayPieces.top;get<HTMLSelectElement>('everydayBottom').value=look.everydayPieces.bottom;get<HTMLSelectElement>('everydayShoes').value=look.everydayPieces.shoes;get<HTMLSelectElement>('everydayBag').value=look.bag==='none'?'none':look.bag==='tote'?'tote':look.bag==='shoulder'?'shoulder':'crossbody'
  for(const id of ['mainControls','bottomControls','outerControls','headControls','shoeControls','accessoryControls','jumpsuitControls','proportionControls','fabricControls'])get(id).hidden=true
  const present=everydayPiecePresent(look,field),label=accessoryMode?'Accessories':pieces.find(([key])=>key===field)?.[1]??'Top'
  get('pieceTitle').textContent=`Your ${label.toLowerCase()}`;get('pieceDescription').textContent=present?'Choose a piece, change its colour, or move it on the model.':`No ${label.toLowerCase()} selected. Add one from the choices below.`
  get('everydayControls').hidden=accessoryMode;get('everydayAccessories').hidden=!accessoryMode;get('editColour').hidden=accessoryMode
  get('colourSection').hidden=accessoryMode||!present;get('removePiece').hidden=accessoryMode||!present;get('removePiece').textContent=`Remove ${label.toLowerCase()}`
  for(const [id,key,art]of [['everydayEarrings','earrings',hoopArt],['everydayNecklace','beads',necklaceArt],['everydaySunglasses','sunglasses',sunglassesArt]] as const){const button=get<HTMLButtonElement>(id);button.setAttribute('aria-pressed',String(look[key]));const img=button.querySelector('img');if(img)img.src=art}
  if(accessoryMode){get('pieceTitle').textContent='Finishing touches';get('pieceDescription').textContent='Keep accessories on deck. Tap to add or remove them from the model.'}
  if(look.reference)get('referenceStatus').textContent='Reference ready. Tap the image to sample a colour; describe the changes in Review.'
  get('stageLabel').textContent='EASY EVERYDAY · DRESS YOUR MODEL';get('artworkNote').hidden=true
  get('currentColourCode').textContent=`${label}: ${(field==='accentColour'?look.bagColour:look[field as 'colour'|'lowerColour'|'shoeColour']).toUpperCase()}`
  const bar=get('pieceBar');bar.hidden=false;bar.replaceChildren()
  for(const [key,name]of pieces){const button=document.createElement('button'),on=everydayPiecePresent(look,key);button.type='button';button.setAttribute('aria-pressed',String(!accessoryMode&&key===field));button.setAttribute('aria-label',`${name}${on?'':', not selected'}. Edit ${name.toLowerCase()}.`);const dot=document.createElement('span');dot.className='piece-dot';dot.style.background=on?(key==='accentColour'?look.bagColour:look[key]):'transparent';button.append(dot,document.createTextNode(name+(on?'':' +')));button.onclick=()=>{accessoryMode=false;h.select(key)};bar.append(button)
   // Keep finishing touches next to the first clothing control so this entry
   // remains visible before users have to scroll the mobile piece rail.
   if(key==='colour'){const accessories=document.createElement('button');accessories.type='button';accessories.setAttribute('aria-pressed',String(accessoryMode));accessories.setAttribute('aria-label',`Accessories${look.earrings||look.beads||look.sunglasses?' selected':''}. Edit finishing touches.`);accessories.append(document.createTextNode(`Accessories${look.earrings||look.beads||look.sunglasses?' ·':''}`));accessories.onclick=showAccessories;bar.append(accessories)}
  }
 }}
}
