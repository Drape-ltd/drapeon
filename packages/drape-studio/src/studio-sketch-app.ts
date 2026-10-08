import {attachBrief,canAttachToBrief,exportNative,native,pickNativeImage,proposeStylePlan,recoveredDraft,reviseOrder,revisingOrderVersion,saveDraft,saveLooks,savedLooks,startMode,storageNotice,workingFromOrderVersion} from './studio-host'
import {DEFAULT_LOOK,NOTE_KINDS,NOTE_LABELS,parseLook,snapshot,SKETCH_STROKE_LIMIT,type Cutout,type Look,type NoteKind,type SketchLine} from './studio-state'
import {photoColourAt,photoPalette} from './studio-photo'
import {briefHandoffNotes,renderTransferNotes} from './studio-sheet'
import {renderSketchSheet} from './studio-sketch-sheet'
import {LOOK_BANK,lookReference} from './studio-look-bank'

document.body.classList.toggle('native-studio',native)
const get=<T extends Element=HTMLElement>(id:string)=>document.getElementById(id) as unknown as T
const svg=get<SVGSVGElement>('canvas')
const orderVersion=revisingOrderVersion(),sourceVersion=workingFromOrderVersion()
const esc=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]!))
const safeName=(value:string)=>value.trim().slice(0,60)||'Untitled look'
const fresh=()=>({...snapshot(DEFAULT_LOOK),canvasMode:'paper' as const,wardrobeArt:'none' as const,outfit:'blank' as const,name:'Untitled look',sketch:[],sketchUnderlay:null,reference:null,inspirationLook:'',lookPalette:[]})
function onPad(value:Look):Look {
  const next=snapshot(value)
  if(next.canvasMode==='figure'&&next.wardrobeArt!=='none'&&!next.inspirationLook)next.inspirationLook=next.wardrobeArt==='occasion-teal'?'teal-occasion':next.wardrobeArt
  // Older saved looks can retain an image while losing its placement marker.
  // The sketch editor only draws pinned images, so restore a sensible default.
  if(next.reference&&!next.cutouts.photo)next.cutouts.photo={x:412,y:128,scale:1,rotation:-4.5}
  if(next.inspirationLook&&!next.cutouts.look)next.cutouts.look={x:90,y:132,scale:1,rotation:5}
  next.canvasMode='paper';next.wardrobeArt='none';next.outfit='blank'
  return next
}
let look=onPad(recoveredDraft()??fresh()),saved=savedLooks(),undo:Look[]=[],redo:Look[]=[],tool:'pen'|'erase'|'note'='pen',mirror=false,croquis:CroquisBuild|null=null,drawing:SketchLine|null=null,erasing=false,pendingNote:SketchLine|null=null,noteKind:NoteKind='detail',dragging:{kind:CutoutKind;from:Point;origin:{x:number;y:number};moved:boolean}|null=null,chosenCutout:CutoutKind|null=null
const ERASER_RADII={fine:5,medium:12,broad:24} as const
type EraserSize=keyof typeof ERASER_RADII
let eraserSize:EraserSize='medium',eraseStart:Look|null=null,lastErasePoint:Point|null=null
let cutoutMenuOpen=false,cutoutHold:ReturnType<typeof setTimeout>|undefined
let draftTimer:ReturnType<typeof setTimeout>|undefined,draftSaving=false,draftAgain=false
function status(message:string){get('status').textContent=message}
function scheduleDraft(){if(draftTimer)clearTimeout(draftTimer);draftTimer=setTimeout(()=>void persistDraft(),650)}
async function persistDraft(){if(draftSaving){draftAgain=true;return}draftSaving=true;try{await saveDraft(snapshot(look));status(orderVersion?'Update saved on this device. Send it to share with your tailor.':sourceVersion?'Working copy saved on this device.':'Draft saved on this device.')}catch{status('Draft could not save. Use My looks to keep a named copy.')}finally{draftSaving=false;if(draftAgain){draftAgain=false;void persistDraft()}}}
function commit(change:(state:Look)=>void){const before=snapshot(look);change(look);if(JSON.stringify(before)===JSON.stringify(look))return;undo.push(before);if(undo.length>60)undo.shift();redo=[];render();scheduleDraft()}
function point(event:PointerEvent){const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const matrix=svg.getScreenCTM();if(!matrix)return null;const p=point.matrixTransform(matrix.inverse());return {x:Math.max(0,Math.min(500,Math.round(p.x*10)/10)),y:Math.max(0,Math.min(740,Math.round(p.y*10)/10))}}
type Point={x:number;y:number}
const PAD_WIDTH=500
const reflect=(line:SketchLine):SketchLine=>({...line,points:line.points.map(p=>({x:PAD_WIDTH-p.x,y:p.y}))})
/** A mirrored stroke is stored once and drawn twice, so both halves share one
 *  undo step and the pad never holds a copy that can drift out of alignment. */
// Notes never mirror: a reflected label reads backwards and a garment needs one
// instruction, not a matching pair.
const withMirror=(line:SketchLine)=>line.mirror&&line.tool!=='note'?[line,reflect(line)]:[line]
/** One ink per callout type, so a sheet can be read at a glance before any of
 *  the words are. */
const NOTE_INK:Record<NoteKind,string>={length:'#2f6d57',fit:'#8a5a2b',fabric:'#3c5c86',detail:'#6c5675',keep:'#7a3b3b'}

/** Quadratic segments through the midpoints of a finger-drawn polyline. The
 *  stored points are unchanged — this only decides how they are drawn — but it
 *  turns a shaky hand into one confident line, which is most of what separates
 *  an amateur sketch from a designer's. */
function strokePath(points:Point[]){
 if(points.length<3)return points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join('')
 let d=`M${points[0]!.x} ${points[0]!.y}`
 for(let i=1;i<points.length-1;i++){const p=points[i]!,next=points[i+1]!;d+=`Q${p.x} ${p.y} ${(p.x+next.x)/2} ${(p.y+next.y)/2}`}
 const last=points[points.length-1]!
 return `${d}L${last.x} ${last.y}`
}

/** A callout is a leader line from the detail to a label that sits clear of it.
 *  The label flips to whichever side of the pad has room, so it never runs off
 *  the paper. */
function noteMarkup(line:SketchLine){
 const start=line.points[0],end=line.points[line.points.length-1]
 if(!start||!end)return ''
 const kind=line.kind??'detail',ink=NOTE_INK[kind]
 const caption=line.text?`${NOTE_LABELS[kind]} · ${line.text}`:NOTE_LABELS[kind]
 const width=Math.min(236,caption.length*6.2+18),height=19
 const toLeft=end.x>PAD_WIDTH/2
 const left=Math.max(6,Math.min(PAD_WIDTH-width-6,toLeft?end.x-width-8:end.x+8))
 const top=Math.max(6,Math.min(734-height,end.y-height/2))
 return `<g data-note="${kind}">`
  +`<path d="M${start.x} ${start.y}L${end.x} ${end.y}" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="4 3"/>`
  +`<circle cx="${start.x}" cy="${start.y}" r="3" fill="${ink}"/>`
  +`<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="9" fill="#fffdf8" stroke="${ink}" stroke-opacity=".55"/>`
  +`<text x="${left+9}" y="${top+13.5}" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="11" fill="${ink}">${esc(caption)}</text>`
  +`</g>`
}

function lineMarkup(line:SketchLine){
 if(line.tool==='note')return noteMarkup(line)
 const start=line.points[0],end=line.points[line.points.length-1]
 const stroke=`fill="none" stroke="${esc(line.colour)}" stroke-width="${line.width}" stroke-linecap="round" stroke-linejoin="round"`
 const head=line.tool==='arrow'&&start&&end&&Math.hypot(end.x-start.x,end.y-start.y)>2?(()=>{const angle=Math.atan2(end.y-start.y,end.x-start.x),size=7+line.width*1.2,left={x:end.x-Math.cos(angle-.55)*size,y:end.y-Math.sin(angle-.55)*size},right={x:end.x-Math.cos(angle+.55)*size,y:end.y-Math.sin(angle+.55)*size};return `<path d="M${left.x} ${left.y}L${end.x} ${end.y}L${right.x} ${right.y}" ${stroke}/>`})():''
 return `<path d="${strokePath(line.points)}" ${stroke}/>${head}`
}

/** A nine-head fashion croquis, as half-widths down the silhouette at each
 *  landmark height. Proportion is the thing untrained hands get wrong, and
 *  tracing fixes it without teaching anything.
 *
 *  Builds share their y values, so switching changes the body while the
 *  landmark lines stay put: shoulder, bust/chest, waist, hip, then the leg
 *  taper. One body shape would have quietly told most people this was not
 *  drawn for them. */
const CROQUIS_BUILDS={
 feminine:{headRx:21,half:[[160,56],[190,47],[220,39],[250,34],[282,41],[312,54],[352,50],[402,41],[444,32],[498,24],[546,18],[582,14],[608,16]]},
 masculine:{headRx:23,half:[[160,67],[190,61],[220,54],[250,49],[282,48],[312,51],[352,49],[402,41],[444,33],[498,26],[546,20],[582,16],[608,18]]},
 fuller:{headRx:22,half:[[160,63],[190,59],[220,55],[250,53],[282,60],[312,71],[352,65],[402,53],[444,42],[498,32],[546,24],[582,19],[608,21]]},
} as const satisfies Record<string,{headRx:number;half:readonly (readonly [number,number])[]}>
type CroquisBuild=keyof typeof CROQUIS_BUILDS
const CROQUIS_ORDER=['feminine','masculine','fuller'] as const
const CROQUIS_LABELS:Record<CroquisBuild,string>={feminine:'Feminine',masculine:'Masculine',fuller:'Fuller'}

function croquisMarkup(build:CroquisBuild){
 const cx=PAD_WIDTH/2,{half,headRx}=CROQUIS_BUILDS[build],shoulder=half[0]![1]
 const side=(sign:1|-1)=>strokePath(half.map(([y,w])=>({x:cx+sign*w,y})))
 // Arms are derived from the shoulder rather than fixed: drawn at the torso's
 // own width they sat exactly on the silhouette and read as one thick line, and
 // a broader build needs them further out again.
 const arm=(sign:1|-1)=>strokePath([[.98,164],[1.21,212],[1.25,252],[1.18,300],[1.12,338]].map(([k,y])=>({x:cx+sign*shoulder*k!,y:y!})))
 // No labels on purpose. The lines read as proportion on their own, and type
 // this small on a phone-width pad would be unreadable anyway.
 const landmarks=[160,190,250,312,444,582]
 return `<g pointer-events="none" fill="none" stroke="#8fa394" stroke-opacity=".52" stroke-linecap="round">`
  +`<ellipse cx="${cx}" cy="101" rx="${headRx}" ry="30"/>`
  +`<path d="M${cx-9} 127L${cx-11} 159M${cx+9} 127L${cx+11} 159M${cx-shoulder} 161H${cx+shoulder}"/>`
  +`<path d="${side(1)}"/><path d="${side(-1)}"/><path d="${arm(1)}"/><path d="${arm(-1)}"/>`
  +`<path d="M${cx} 316V608" stroke-dasharray="4 6" stroke-opacity=".3"/>`
  +landmarks.map(y=>`<path d="M44 ${y}H456" stroke-width=".8" stroke-dasharray="3 7" stroke-opacity=".32"/>`).join('')
  +`</g>`
}

/** References sit on the paper as cut-outs: a white paper margin, a strip of
 *  tape, a few degrees of tilt and a soft shadow. `slice` crops the photo to
 *  the window, which is what makes an arbitrary snapshot read as something
 *  trimmed with scissors rather than a thumbnail in a box. */
/** Sticker-sized on purpose. At album scale a reference dominates the paper and
 *  the sketch becomes the sidekick; small enough to tuck in a corner, it stays
 *  a reference. Roughly a sixth of the pad width. */
const CUTOUT_SIZES={photo:{w:82,h:98},look:{w:74,h:90}} as const
type CutoutKind=keyof typeof CUTOUT_SIZES
/** Cuts around the figure rather than around a rectangle — the white edge should
 *  follow the silhouette, the way a magazine cutting does.
 *
 *  The alpha row of the colour matrix drops near-white pixels (studio
 *  backgrounds), feMorphology fattens what survives, and flooding that dilated
 *  alpha with paper gives the hand-cut border. A photo with a busy background
 *  knocks nothing out and simply keeps its rectangle with a white edge, which is
 *  the right thing to degrade to. */
const CUT_FILTER=`<filter id="drapeCut" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">`
 // The ramp alone would turn everything outside the photo opaque black: there
 // the source is transparent, so RGB are 0 and the alpha row collapses to its
 // own offset. Compositing `in` the source clips it back to the photo.
 +`<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -2.99 -5.87 -1.14 0 8.8" result="ramp"/>`
 +`<feComposite in="ramp" in2="SourceGraphic" operator="in" result="cut"/>`
 +`<feMorphology in="cut" operator="dilate" radius="2.4" result="fat"/>`
 +`<feFlood flood-color="#fffdf8" result="paper"/>`
 +`<feComposite in="paper" in2="fat" operator="in" result="border"/>`
 +`<feMerge><feMergeNode in="border"/><feMergeNode in="cut"/></feMerge>`
 +`<feDropShadow dx="1.1" dy="1.9" stdDeviation="1.5" flood-color="#2b3a31" flood-opacity=".32"/>`
 +`</filter>`
function cutoutMarkup(kind:CutoutKind,href:string,pin:Cutout,selected:boolean){
 const {w,h}=CUTOUT_SIZES[kind]
 // The ring sits outside the cut filter so it stays a clean rectangle rather
 // than being chewed through by the silhouette knockout.
 const ring=selected?`<rect x="${-w/2-7}" y="${-h/2-7}" width="${w+14}" height="${h+14}" fill="none" stroke="#245b48" stroke-opacity=".75" stroke-width="${1.6/pin.scale}" stroke-dasharray="${6/pin.scale} ${4/pin.scale}"/>`:''
 return `<g data-cutout="${kind}" transform="translate(${pin.x} ${pin.y}) rotate(${pin.rotation}) scale(${pin.scale})" style="cursor:grab">`
  +`<image href="${href}" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMin slice" filter="url(#drapeCut)"/>`
  +ring
  +`</g>`
}
const cutoutHref=(value:Look,kind:CutoutKind)=>kind==='photo'?value.reference?.image:lookReference(value.inspirationLook)?.image
function cutoutsMarkup(value:Look,chosen:CutoutKind|null){
 const cuttings=(['look','photo'] as const).map(kind=>{
  const pin=value.cutouts[kind],href=cutoutHref(value,kind)
  return pin&&href?cutoutMarkup(kind,href,pin,kind===chosen):''
 }).join('')
 return cuttings?`<defs>${CUT_FILTER}</defs>${cuttings}`:''
}
const CUTOUT_LABELS:Record<CutoutKind,string>={photo:'Your photo',look:'Look cutting'}
const CUTOUT_STEP=1.18,CUTOUT_MIN=.45,CUTOUT_MAX=2.2

/** Guides are editing aids, so they default off and the exported sheet never
 *  asks for them — tracing paper must not end up in the tailor's copy. Cut-outs
 *  are the opposite: they are part of the idea, so they do get exported. */
export function paperMarkup(value:Look,preview?:SketchLine|null,guides:{axis?:boolean;croquis?:CroquisBuild|null;chosen?:CutoutKind|null}={}){
 const source=value.sketchUnderlay
 const underlay=source?.visible?`<image href="${source.image}" x="15" y="15" width="470" height="710" preserveAspectRatio="xMidYMid ${source.framing==='fill'?'slice':'meet'}" style="filter:contrast(${source.contrast})" opacity="${source.opacity}" pointer-events="none"/>`:''
 const figure=guides.croquis?croquisMarkup(guides.croquis):''
 const axis=guides.axis?`<line x1="${PAD_WIDTH/2}" y1="18" x2="${PAD_WIDTH/2}" y2="722" stroke="#245b48" stroke-opacity=".28" stroke-width="1" stroke-dasharray="5 7" pointer-events="none"/>`:''
 const strokes=[...value.sketch,...(preview?[preview]:[])].flatMap(withMirror).map(lineMarkup).join('')
 return underlay+figure+cutoutsMarkup(value,guides.chosen??null)+axis+strokes
}

/** Ramer–Douglas–Peucker. A traced line arrives with far more points than it
 *  needs; dropping the redundant ones is what makes a 200-stroke pad small
 *  enough to keep saving as a draft. Rendering smooths the survivors, so the
 *  line looks the same. */
function simplify(points:Point[],tolerance=.7):Point[]{
 if(points.length<3)return points
 const keep=new Array<boolean>(points.length).fill(false)
 keep[0]=keep[points.length-1]=true
 const spans:[number,number][]=[[0,points.length-1]]
 while(spans.length){
  const [first,last]=spans.pop()!
  const a=points[first]!,b=points[last]!,dx=b.x-a.x,dy=b.y-a.y,span=Math.hypot(dx,dy)
  let index=-1,furthest=tolerance
  for(let i=first+1;i<last;i++){
   const p=points[i]!
   const distance=span===0?Math.hypot(p.x-a.x,p.y-a.y):Math.abs(dy*p.x-dx*p.y+b.x*a.y-b.y*a.x)/span
   if(distance>furthest){furthest=distance;index=i}
  }
  if(index>=0){keep[index]=true;spans.push([first,index],[index,last])}
 }
 return points.filter((_,i)=>keep[i]!)
}

function distanceToStroke(line:SketchLine,at:Point){
 let best=Infinity
 for(const points of withMirror(line).map(part=>part.points))
  for(let i=1;i<points.length;i++){
   const a=points[i-1]!,b=points[i]!,dx=b.x-a.x,dy=b.y-a.y,lengthSquared=dx*dx+dy*dy
   const t=lengthSquared===0?0:Math.max(0,Math.min(1,((at.x-a.x)*dx+(at.y-a.y)*dy)/lengthSquared))
   best=Math.min(best,Math.hypot(at.x-(a.x+t*dx),at.y-(a.y+t*dy)))
  }
 return best
}
function closeTools(){get('tools').classList.remove('open');get('openTools').setAttribute('aria-expanded','false')}
function openTools(){get('tools').classList.add('open');get('openTools').setAttribute('aria-expanded','true')}
get('openTools').onclick=openTools;get('closeTools').onclick=closeTools
function render(){svg.innerHTML=paperMarkup(look,drawing,{axis:mirror,croquis,chosen:chosenCutout});get('lookTitle').textContent=look.name;get<HTMLInputElement>('lookName').value=look.name;get('emptyHint').hidden=!!(look.sketch.length||look.sketchUnderlay||croquis||look.cutouts.photo||look.cutouts.look);get<HTMLButtonElement>('undo').disabled=undo.length===0;get<HTMLButtonElement>('redo').disabled=redo.length===0;get<HTMLButtonElement>('clearSketch').disabled=look.sketch.length===0;
 const source=look.sketchUnderlay;get('sketchSourceControls').hidden=!source;get<HTMLInputElement>('sketchOpacity').value=String((source?.opacity??.4)*100);get<HTMLInputElement>('sketchContrast').value=String((source?.contrast??1)*100);get<HTMLSelectElement>('sketchFraming').value=source?.framing??'fit';get('toggleSketchSource').textContent=source?.visible?'Hide original':'Show original';
 const photo=look.reference;
 if(chosenCutout&&!look.cutouts[chosenCutout])chosenCutout=null
 const chosenPin=chosenCutout?look.cutouts[chosenCutout]:null
 get('cutoutBar').hidden=!chosenPin||!cutoutMenuOpen
 if(chosenCutout&&chosenPin){
  get('cutoutLabel').textContent=`${CUTOUT_LABELS[chosenCutout]} · ${Math.round(chosenPin.scale*100)}%`
  get<HTMLButtonElement>('cutoutSmaller').disabled=chosenPin.scale<=CUTOUT_MIN+.001
  get<HTMLButtonElement>('cutoutBigger').disabled=chosenPin.scale>=CUTOUT_MAX-.001
  get<HTMLButtonElement>('cutoutMinimum').disabled=chosenPin.scale<=CUTOUT_MIN+.001
  get<HTMLButtonElement>('cutoutMaximum').disabled=chosenPin.scale>=CUTOUT_MAX-.001
 }
 get('referenceSourceControls').hidden=!photo;get<HTMLInputElement>('referenceUrl').value=photo?.sourceUrl??'';for(const [id,key] of [['directionKeep','keep'],['directionChange','change'],['directionRemove','remove'],['directionConfirm','confirm']] as const){const field=get<HTMLTextAreaElement>(id);if(document.activeElement!==field)field.value=look.directions[key]}const notes=get<HTMLTextAreaElement>('notes');if(document.activeElement!==notes)notes.value=look.notes;
 const palette=get('sampledColours');palette.replaceChildren();for(const [sourceName,colours] of [['look',look.lookPalette],['photo',photo?.palette??[]]] as const)for(const [i,hex]of colours.entries()){const button=document.createElement('button');button.style.background=hex;button.title=`${sourceName} colour ${i+1}: ${hex}`;button.setAttribute('aria-label',button.title);button.onclick=()=>{get<HTMLInputElement>('inkColour').value=hex;status(`Drawing ink set to ${hex.toUpperCase()}. Fabric colour still needs confirmation.`)};palette.append(button)}
 for(const [id,on] of [['penTool',tool==='pen'],['noteTool',tool==='note'],['eraseTool',tool==='erase'],['mirrorTool',mirror],['croquisTool',!!croquis]] as const){get(id).classList.toggle('selected',on);get(id).setAttribute('aria-pressed',String(on))}
 get<HTMLButtonElement>('eraseTool').disabled=look.sketch.length===0
 get('eraserSizes').hidden=tool!=='erase'
 document.querySelectorAll<HTMLButtonElement>('[data-eraser-size]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.eraserSize===eraserSize)))
 get('croquisTool').setAttribute('data-build',croquis??'off')
 get('croquisTool').textContent=croquis?CROQUIS_LABELS[croquis]:'Figure'
 get('croquisTool').setAttribute('aria-label',croquis?`Figure guide: ${CROQUIS_LABELS[croquis]}. Tap for the next build.`:'Figure guide off. Tap to trace over a figure.')
 document.querySelectorAll<HTMLButtonElement>('.look-card').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.id===look.inspirationLook)))
}
const TOOL_HINT={pen:'Draw with a finger, pen or mouse.',erase:'Rub across a mark to erase only the part beneath your finger.',note:'Tap a detail to add a note, or drag to place its label.'} as const
function setTool(next:'pen'|'erase'|'note'){tool=next;render();status(TOOL_HINT[next])}
get('penTool').onclick=()=>setTool('pen');get('eraseTool').onclick=()=>setTool('erase');get('noteTool').onclick=()=>setTool('note')
document.querySelectorAll<HTMLButtonElement>('[data-eraser-size]').forEach(button=>button.onclick=()=>{eraserSize=button.dataset.eraserSize as EraserSize;render();status(`${button.textContent} eraser selected. Rub across marks to remove them.`)})
// Tracing paper. Off by default and never exported.
get('croquisTool').onclick=()=>{
 const at=croquis?CROQUIS_ORDER.indexOf(croquis):-1
 croquis=at+1<CROQUIS_ORDER.length?CROQUIS_ORDER[at+1]!:null
 render()
 status(croquis?`${CROQUIS_LABELS[croquis]} figure guide. Tap again for the next build — it never leaves the pad.`:'Figure guide off.')
}
// Garments are almost entirely symmetric, so drawing one half and getting the
// other is the single biggest assist for someone who cannot draw.
get('mirrorTool').onclick=()=>{mirror=!mirror;render();status(mirror?'Mirror on. Draw one half and the other side follows.':'Mirror off.')}
for(const hex of ['#264c40','#ad684f','#365875','#9a6944','#6c5675']){const button=document.createElement('button');button.style.background=hex;button.title=`Use ${hex}`;button.setAttribute('aria-label',button.title);button.onclick=()=>{get<HTMLInputElement>('inkColour').value=hex;status(`Ink set to ${hex.toUpperCase()}`)};get('inkPresets').append(button)}
function eraseStrokeParts(line:SketchLine,at:Point,radius:number):SketchLine[]{
 if(line.tool==='note'||line.tool==='arrow')return []
 const samples:Point[]=[]
 for(let i=1;i<line.points.length;i++){
  const a=line.points[i-1]!,b=line.points[i]!,steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/2))
  for(let step=i===1?0:1;step<=steps;step++)samples.push({x:a.x+(b.x-a.x)*step/steps,y:a.y+(b.y-a.y)*step/steps})
 }
 const kept:SketchLine[]=[],run:Point[]=[]
 const flush=()=>{if(run.length>=2&&Math.hypot(run[0]!.x-run[run.length-1]!.x,run[0]!.y-run[run.length-1]!.y)>1)kept.push({...line,points:simplify(run.splice(0),.7)});else run.length=0}
 for(const sample of samples){
  const hit=Math.hypot(sample.x-at.x,sample.y-at.y)<=radius||!!line.mirror&&Math.hypot(PAD_WIDTH-sample.x-at.x,sample.y-at.y)<=radius
  if(hit)flush();else run.push(sample)
 }
 flush()
 return kept
}
function eraseAt(at:Point){
 let changed=false
 for(let index=look.sketch.length-1;index>=0;index--){
  const line=look.sketch[index]!
  const radius=ERASER_RADII[eraserSize]+line.width/2
  if(distanceToStroke(line,at)<=radius){
   const parts=eraseStrokeParts(line,at,radius)
   look.sketch.splice(index,1,...parts.slice(0,SKETCH_STROKE_LIMIT-look.sketch.length+1))
   changed=true
  }
 }
 return changed
}
function eraseThrough(from:Point,to:Point){
 const distance=Math.hypot(to.x-from.x,to.y-from.y)
 const steps=Math.max(1,Math.ceil(distance/Math.max(2,ERASER_RADII[eraserSize]/2)))
 let changed=false
 for(let step=1;step<=steps;step++)changed=eraseAt({x:from.x+(to.x-from.x)*step/steps,y:from.y+(to.y-from.y)*step/steps})||changed
 if(changed)render()
}
function finishErase(){
 if(!erasing)return false
 erasing=false;lastErasePoint=null
 const before=eraseStart;eraseStart=null
 if(before&&JSON.stringify(before)!==JSON.stringify(look)){
  undo.push(before);if(undo.length>60)undo.shift();redo=[]
  render();scheduleDraft();status('Marks erased. Undo restores the whole gesture.')
 }
 return true
}
/** Reads the colour under a tap on a cut-out. The photo is drawn with `slice`,
 *  so undoing the tilt, the scale and the crop offset is what turns a point on
 *  the paper back into a pixel in the original image. */
function sampleCutout(kind:CutoutKind,at:Point){
 const pin=look.cutouts[kind],href=cutoutHref(look,kind)
 if(!pin||!href)return
 const {w,h}=CUTOUT_SIZES[kind],radians=-pin.rotation*Math.PI/180
 const dx=(at.x-pin.x)/pin.scale,dy=(at.y-pin.y)/pin.scale
 const localX=dx*Math.cos(radians)-dy*Math.sin(radians),localY=dx*Math.sin(radians)+dy*Math.cos(radians)
 const image=new Image()
 image.onload=()=>{
  const fill=Math.max(w/image.naturalWidth,h/image.naturalHeight)
  const x=(image.naturalWidth-w/fill)/2+(localX+w/2)/fill
  const y=(image.naturalHeight-h/fill)/2+(localY+h/2)/fill
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight
  const context=canvas.getContext('2d');if(!context)return
  context.drawImage(image,0,0)
  const colour=photoColourAt(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,x,y)
  if(!colour)return
  commit(state=>{
   if(kind==='photo'&&state.reference)state.reference.palette=[colour,...state.reference.palette.filter(v=>v!==colour)].slice(0,5)
   if(kind==='look')state.lookPalette=[colour,...state.lookPalette.filter(v=>v!==colour)].slice(0,5)
  })
  get<HTMLInputElement>('inkColour').value=colour
  status(`Sampled ${colour.toUpperCase()} from the cut-out. It is a reference colour, not an approved fabric.`)
 }
 image.src=href
}
svg.addEventListener('pointerdown',event=>{
 const start=point(event);if(!start)return
 event.preventDefault()
 // A cut-out takes the pointer before any tool does: drag moves it, a tap
 // samples its colour.
 const host=(event.target as Element|null)?.closest?.('[data-cutout]')
 if(host){
  const kind=host.getAttribute('data-cutout') as CutoutKind,pin=look.cutouts[kind]
  if(pin){
   svg.setPointerCapture(event.pointerId);dragging={kind,from:start,origin:{x:pin.x,y:pin.y},moved:false}
   if(cutoutHold)clearTimeout(cutoutHold)
   cutoutHold=setTimeout(()=>{if(dragging&&!dragging.moved){chosenCutout=kind;cutoutMenuOpen=true;render();status('Sticker options open. Move, resize, turn or remove it.')}},550)
   return
  }
 }
 if(chosenCutout){chosenCutout=null;cutoutMenuOpen=false;render()}
 if(tool==='erase'){svg.setPointerCapture(event.pointerId);erasing=true;eraseStart=snapshot(look);lastErasePoint=start;if(eraseAt(start))render();return}
 if(drawing)return
 if(look.sketch.length>=SKETCH_STROKE_LIMIT){status(`This pad has reached ${SKETCH_STROKE_LIMIT} marks. Erase or clear a few to keep drawing.`);return}
 svg.setPointerCapture(event.pointerId)
 drawing={tool,colour:get<HTMLInputElement>('inkColour').value,width:Number(get<HTMLInputElement>('strokeWidth').value),points:[start,start],mirror}
 render()
})
svg.addEventListener('pointermove',event=>{
 if(dragging||erasing||drawing)event.preventDefault()
 if(dragging){
  const at=point(event);if(!at)return
  const pin=look.cutouts[dragging.kind];if(!pin)return
  const dx=at.x-dragging.from.x,dy=at.y-dragging.from.y
  if(Math.hypot(dx,dy)>3){dragging.moved=true;if(cutoutHold){clearTimeout(cutoutHold);cutoutHold=undefined}}
  pin.x=Math.max(16,Math.min(484,dragging.origin.x+dx));pin.y=Math.max(16,Math.min(724,dragging.origin.y+dy))
  svg.innerHTML=paperMarkup(look,drawing,{axis:mirror,croquis,chosen:chosenCutout})
  return
 }
 if(erasing){const at=point(event);if(at){eraseThrough(lastErasePoint??at,at);lastErasePoint=at}return}if(!drawing)return;const next=point(event);if(!next)return;if(drawing.tool==='arrow'||drawing.tool==='note')drawing.points=[drawing.points[0]!,next];else if(drawing.points.length<500&&Math.hypot(next.x-drawing.points[drawing.points.length-1]!.x,next.y-drawing.points[drawing.points.length-1]!.y)>1)drawing.points.push(next);svg.innerHTML=paperMarkup(look,drawing,{axis:mirror,croquis,chosen:chosenCutout})})
/** Returns whether this pointer-up belonged to a cut-out drag. It must report
 *  false when nothing was being dragged, or finishStroke() returns early and no
 *  stroke is ever committed. */
function finishDrag(){
 if(cutoutHold){clearTimeout(cutoutHold);cutoutHold=undefined}
 const drag=dragging;dragging=null
 if(!drag)return false
 const pin=look.cutouts[drag.kind]
 if(!pin){render();return true}
 if(!drag.moved){
  const already=chosenCutout===drag.kind
  chosenCutout=drag.kind;cutoutMenuOpen=true;render()
  if(already)sampleCutout(drag.kind,drag.from)
  else status(`${CUTOUT_LABELS[drag.kind]} selected. Use the controls to resize, turn or remove it; drag to move.`)
  return true
 }
 // The live drag already moved the pin, so undo records where it started.
 const before=snapshot(look)
 before.cutouts[drag.kind]={...pin,x:drag.origin.x,y:drag.origin.y}
 undo.push(before);if(undo.length>60)undo.shift();redo=[]
 render();scheduleDraft();status('Cut-out moved.')
 return true
}
function finishStroke(){
 if(finishDrag())return
 if(finishErase())return
 if(!drawing)return
 const line=drawing;drawing=null
 // Measured along the path, not start-to-end: the old check discarded any
 // stroke that finished near where it began, which silently threw away every
 // closed shape — a collar, a cuff, a pocket, a button.
 const travelled=line.points.reduce((sum,p,i)=>i?sum+Math.hypot(p.x-line.points[i-1]!.x,p.y-line.points[i-1]!.y):0,0)
 if(line.tool==='note'&&travelled<2){
  const anchor=line.points[0]!
  line.points=[anchor,{x:Math.max(8,Math.min(PAD_WIDTH-8,anchor.x+(anchor.x>PAD_WIDTH/2?-22:22))),y:Math.max(8,anchor.y-18)}]
 }
 else if(line.points.length<2||travelled<2){render();return}
 if(line.tool==='note'){pendingNote=line;openNoteDialog();return}
 if(line.tool!=='arrow')line.points=simplify(line.points)
 commit(state=>{state.sketch.push(line)})
}
svg.addEventListener('pointerup',finishStroke);svg.addEventListener('pointercancel',()=>{if(cutoutHold)clearTimeout(cutoutHold);cutoutHold=undefined;drawing=null;finishErase();dragging=null;render()})
/** Sizing and turning live in a bar rather than in corner handles or a pinch:
 *  a 74-unit sticker on a phone has no room for a grab handle, and a hidden
 *  gesture is a feature nobody finds. */
function adjustCutout(change:(pin:Cutout)=>void,message:string){
 const kind=chosenCutout;if(!kind)return
 commit(state=>{const pin=state.cutouts[kind];if(pin)change(pin)})
 status(message)
}
get('cutoutSmaller').onclick=()=>adjustCutout(pin=>{pin.scale=Math.max(CUTOUT_MIN,Number((pin.scale/CUTOUT_STEP).toFixed(3)))},'Cut-out made smaller.')
get('cutoutBigger').onclick=()=>adjustCutout(pin=>{pin.scale=Math.min(CUTOUT_MAX,Number((pin.scale*CUTOUT_STEP).toFixed(3)))},'Cut-out made bigger.')
get('cutoutMinimum').onclick=()=>adjustCutout(pin=>{pin.scale=CUTOUT_MIN},'Cut-out minimized.')
get('cutoutMaximum').onclick=()=>adjustCutout(pin=>{pin.scale=CUTOUT_MAX},'Cut-out maximized.')
get('cutoutTurn').onclick=()=>adjustCutout(pin=>{pin.rotation=((pin.rotation+7+28)%56)-28},'Cut-out turned.')
get('cutoutRemove').onclick=()=>{
 const kind=chosenCutout;if(!kind)return
 chosenCutout=null
 commit(state=>{
  state.cutouts[kind]=null
  if(kind==='photo')state.reference=null
  else {state.inspirationLook='';state.lookPalette=[]}
 })
 status('Cut-out taken off your pad. Undo brings it back.')
}
get('cutoutDone').onclick=()=>{cutoutMenuOpen=false;chosenCutout=null;render();status('Cut-out placed.')}
get('clearSketch').onclick=()=>{if(!look.sketch.length)return;commit(state=>state.sketch=[]);status('Marks cleared. Undo brings them back.')}
get('undo').onclick=()=>{const previous=undo.pop();if(!previous)return;redo.push(snapshot(look));look=previous;render();scheduleDraft();status('Undone')};get('redo').onclick=()=>{const next=redo.pop();if(!next)return;undo.push(snapshot(look));look=next;render();scheduleDraft();status('Redone')}
async function imageData(source:File|string,maxEdge:number){
 if(source instanceof File&&(!['image/jpeg','image/png','image/webp'].includes(source.type)||source.size>15_000_000))throw Error('Choose a JPEG, PNG or WebP under 15 MB.')
 const url=typeof source==='string'?source:URL.createObjectURL(source)
 try{
  const photo=await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('This image could not open.'));image.src=url})
  const scale=Math.min(1,maxEdge/Math.max(photo.naturalWidth,photo.naturalHeight)),canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(photo.naturalWidth*scale));canvas.height=Math.max(1,Math.round(photo.naturalHeight*scale))
  const context=canvas.getContext('2d');if(!context)throw Error('This image could not open.')
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(photo,0,0,canvas.width,canvas.height)
  const image=[.85,.65,.45].map(q=>canvas.toDataURL('image/jpeg',q)).find(src=>src.length<=300000)
  if(!image)throw Error('Try a smaller copy of this image.')
  return {image,canvas,context}
 }finally{if(typeof source!=='string')URL.revokeObjectURL(url)}
}
async function chosenImage(inputId:string){
 if(native)return pickNativeImage()
 return new Promise<File|null>(resolve=>{const input=get<HTMLInputElement>(inputId);input.onchange=()=>{const file=input.files?.[0]??null;input.value='';resolve(file)};input.click()})
}
get('uploadSketch').onclick=async()=>{try{const source=await chosenImage('sketchFile');if(!source)return;status('Adding paper sketch…');const {image}=await imageData(source,1000);commit(state=>state.sketchUnderlay={image,opacity:.4,visible:true,contrast:1,framing:'fit'});closeTools();status('Paper sketch added beneath your marks.')}catch(error){status(error instanceof Error?error.message:'Sketch could not open.')}}
get<HTMLInputElement>('sketchOpacity').oninput=()=>commit(state=>{if(state.sketchUnderlay)state.sketchUnderlay.opacity=Number(get<HTMLInputElement>('sketchOpacity').value)/100});get<HTMLInputElement>('sketchContrast').oninput=()=>commit(state=>{if(state.sketchUnderlay)state.sketchUnderlay.contrast=Number(get<HTMLInputElement>('sketchContrast').value)/100});get<HTMLSelectElement>('sketchFraming').onchange=()=>commit(state=>{if(state.sketchUnderlay)state.sketchUnderlay.framing=get<HTMLSelectElement>('sketchFraming').value as 'fit'|'fill'});get('toggleSketchSource').onclick=()=>commit(state=>{if(state.sketchUnderlay)state.sketchUnderlay.visible=!state.sketchUnderlay.visible});get('removeSketchSource').onclick=()=>commit(state=>state.sketchUnderlay=null)
get('uploadReference').onclick=async()=>{try{const source=await chosenImage('referenceFile');if(!source)return;status('Adding reference photo…');const {image,canvas,context}=await imageData(source,700),palette=photoPalette(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);commit(state=>{state.reference={image,palette,sourceUrl:'',keep:'',change:''};state.cutouts.photo={x:412,y:128,scale:1,rotation:-4.5}});closeTools();status('Photo pinned to your pad. Tap it for resize and turn controls, or drag it anywhere.')}catch(error){status(error instanceof Error?error.message:'Photo could not open.')}}
get('removeReference').onclick=()=>commit(state=>{state.reference=null;state.cutouts.photo=null})
get<HTMLInputElement>('referenceUrl').onchange=()=>commit(state=>{if(state.reference){const value=get<HTMLInputElement>('referenceUrl').value.trim();state.reference.sourceUrl=/^https?:\/\//i.test(value)?value.slice(0,500):''}})
async function sampleImage(image:HTMLImageElement,event:MouseEvent,from:'photo'|'look'){if(!image.complete||!image.naturalWidth)return;const rect=image.getBoundingClientRect(),scale=Math.max(rect.width/image.naturalWidth,rect.height/image.naturalHeight),shownWidth=image.naturalWidth*scale,shownHeight=image.naturalHeight*scale,x=(event.clientX-rect.left+(shownWidth-rect.width)/2)/scale,y=(event.clientY-rect.top+(shownHeight-rect.height)/2)/scale;const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');if(!context)return;context.drawImage(image,0,0);const colour=photoColourAt(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,x,y);if(!colour)return;commit(state=>{if(from==='photo'&&state.reference)state.reference.palette=[colour,...state.reference.palette.filter(v=>v!==colour)].slice(0,5);if(from==='look')state.lookPalette=[colour,...state.lookPalette.filter(v=>v!==colour)].slice(0,5)});get<HTMLInputElement>('inkColour').value=colour;status(`Sampled ${colour.toUpperCase()} from the ${from==='photo'?'photo':'look'}. It is a reference colour, not an approved fabric.`)}
function fillLooks(){const q=get<HTMLInputElement>('lookSearch').value.trim().toLowerCase(),group=get<HTMLSelectElement>('lookGroup').value,items=LOOK_BANK.filter(item=>(group==='all'||item.group===group)&&`${item.name} ${item.group} ${item.detail}`.toLowerCase().includes(q)),host=get('lookCards');host.replaceChildren();get('lookEmpty').hidden=items.length>0;for(const item of items){const button=document.createElement('button');button.className='look-card';button.dataset.id=item.id;button.setAttribute('aria-pressed',String(item.id===look.inspirationLook));button.setAttribute('aria-label',`Use ${item.name} as a reference`);const image=document.createElement('img');image.src=item.image;image.alt='';const text=document.createElement('span');const name=document.createElement('strong');name.textContent=item.name;const detail=document.createElement('small');detail.textContent=item.detail;text.append(name,detail);button.append(image,text);button.onclick=()=>{const on=look.inspirationLook===item.id;commit(state=>{state.inspirationLook=on?'':item.id;state.lookPalette=[];state.cutouts.look=on?null:{x:90,y:132,scale:1,rotation:5}});closeTools();status(on?`${item.name} taken off your pad.`:`${item.name} pinned to your pad. Drag it anywhere; your marks stay as they are.`)};host.append(button)}}
get<HTMLInputElement>('lookSearch').oninput=fillLooks;get<HTMLSelectElement>('lookGroup').onchange=fillLooks
for(const [id,key] of [['directionKeep','keep'],['directionChange','change'],['directionRemove','remove'],['directionConfirm','confirm']] as const)get<HTMLTextAreaElement>(id).oninput=()=>{const value=get<HTMLTextAreaElement>(id).value;commit(state=>{state.directions[key]=value;if(state.reference&&(key==='keep'||key==='change'))state.reference[key]=value})};get<HTMLTextAreaElement>('notes').oninput=()=>{const value=get<HTMLTextAreaElement>('notes').value;commit(state=>state.notes=value)}
function openDialog(id:string){get<HTMLDialogElement>(id).showModal()}function closeDialog(id:string){get<HTMLDialogElement>(id).close()}document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button=>button.onclick=()=>closeDialog(button.dataset.close!))
function positionNoteAboveKeyboard(){
 const dialog=get<HTMLDialogElement>('noteDialog'),viewport=window.visualViewport
 if(!dialog.open||!viewport)return
 const obscured=Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)
 dialog.style.setProperty('--note-keyboard-offset',`${Math.round(obscured)}px`)
 dialog.style.setProperty('--note-visible-height',`${Math.round(viewport.height)}px`)
}
window.visualViewport?.addEventListener('resize',positionNoteAboveKeyboard)
window.visualViewport?.addEventListener('scroll',positionNoteAboveKeyboard)
function openNoteDialog(){
 const list=get('noteKinds');list.replaceChildren()
 for(const kind of NOTE_KINDS){
  const button=document.createElement('button');button.type='button';button.dataset.kind=kind;button.textContent=NOTE_LABELS[kind]
  button.setAttribute('aria-pressed',String(kind===noteKind))
  button.onclick=()=>{noteKind=kind;list.querySelectorAll('button').forEach(other=>other.setAttribute('aria-pressed',String(other===button)))}
  list.append(button)
 }
 const field=get<HTMLInputElement>('noteText');field.value=''
 openDialog('noteDialog');positionNoteAboveKeyboard();field.focus({preventScroll:true})
}
function saveNote(){
 const line=pendingNote;pendingNote=null
 if(!line){closeDialog('noteDialog');return}
 line.kind=noteKind;line.text=get<HTMLInputElement>('noteText').value.trim().slice(0,60)
 closeDialog('noteDialog')
 commit(state=>{state.sketch.push(line)})
 status(`${NOTE_LABELS[noteKind]} callout added.`)
}
get('noteSave').onclick=saveNote
get<HTMLInputElement>('noteText').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();saveNote()}}
// Escape, the backdrop or Cancel all land here, so an abandoned drag leaves no
// half-made callout behind.
get<HTMLDialogElement>('noteDialog').addEventListener('close',()=>{const dialog=get<HTMLDialogElement>('noteDialog');dialog.style.removeProperty('--note-keyboard-offset');dialog.style.removeProperty('--note-visible-height');if(pendingNote){pendingNote=null;render()}})
function listSaved(){const host=get('savedList');host.replaceChildren();if(!saved.length){const p=document.createElement('p');p.className='small';p.textContent='No named looks yet. Your current sketch still recovers on this device.';host.append(p)}for(const design of saved){const button=document.createElement('button');button.textContent=`Open ${design.name}`;button.onclick=()=>{commit(state=>Object.assign(state,onPad(design)));closeDialog('savedDialog');status(`Opened ${design.name} on the sketch pad.`)};host.append(button)}}
get('openSaved').onclick=()=>{listSaved();openDialog('savedDialog')};get('saveLook').onclick=async()=>{const name=safeName(get<HTMLInputElement>('lookName').value);commit(state=>state.name=name);const next=[snapshot(look),...saved.filter(item=>item.name!==name)].slice(0,12);try{const warning=await saveLooks(next);saved=next;listSaved();closeDialog('savedDialog');status(warning||`Saved ${name} to your account and this device.`)}catch(error){status(error instanceof Error?error.message:'Look could not save.')}}
get('mobileSaved').onclick=()=>{closeTools();get('openSaved').click()}
function download(contents:string,mime:string,extension:string,name:string,base64=false){if(native){void exportNative(contents,mime,extension,base64).then(()=>status('Saved to your chosen folder.')).catch(error=>status(error.message));return}const url=base64?`data:${mime};base64,${contents}`:URL.createObjectURL(new Blob([contents],{type:mime}));const link=document.createElement('a');link.href=url;link.download=`${name}.${extension}`;link.click();if(!base64)setTimeout(()=>URL.revokeObjectURL(url),10000)}
get('downloadDesign').onclick=()=>download(JSON.stringify(look,null,2),'application/json','json','drapeon-studio-sketch');get('importDesign').onclick=()=>get<HTMLInputElement>('designFile').click();get<HTMLInputElement>('designFile').onchange=async()=>{const input=get<HTMLInputElement>('designFile'),file=input.files?.[0];input.value='';if(!file)return;try{if(file.size>1_000_000)throw Error('Choose a design file under 1 MB.');const value=onPad(parseLook(JSON.parse(await file.text())));commit(state=>Object.assign(state,value));closeDialog('savedDialog');status('Design opened on the sketch pad.')}catch(error){status(error instanceof Error?error.message:'Design could not open.')}}
function sheetSVG(){return renderSketchSheet(look,paperMarkup(look))}
async function sheetPNG(){const url=URL.createObjectURL(new Blob([sheetSVG()],{type:'image/svg+xml'}));try{const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('Look sheet could not render.'));image.src=url});const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');if(!context)throw Error('Image export is unavailable.');context.drawImage(image,0,0);const data=canvas.toDataURL('image/png');if(data.length>9_000_000)throw Error('This sheet is too large. Remove an image and try again.');return data}finally{URL.revokeObjectURL(url)}}
function review(){const image=get<HTMLImageElement>('reviewSheet');image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(sheetSVG());get('reviewName').textContent=look.name;get('reviewDirections').innerHTML=(['keep','change','remove','confirm'] as const).map(key=>`<dt>${{keep:'Keep',change:'Change',remove:'Remove',confirm:'Confirm together'}[key]}</dt><dd>${esc(look.directions[key]||'Not specified')}</dd>`).join('');openDialog('reviewDialog')}
get('review').onclick=review;get('backToPad').onclick=()=>closeDialog('reviewDialog');get('savePng').onclick=async()=>{try{const data=await sheetPNG();download(data.split(',')[1]!,'image/png','png','drapeon-design-sheet',true)}catch(error){status(error instanceof Error?error.message:'Sheet could not save.')}};get('downloadNotes').onclick=()=>download(renderTransferNotes(look),'text/plain','txt','drapeon-design-directions')
get<HTMLButtonElement>('attachToBrief').hidden=!canAttachToBrief();get<HTMLButtonElement>('reviseOrder').hidden=!orderVersion;get('orderRevisionFields').hidden=!orderVersion;get<HTMLButtonElement>('proposeStylePlan').hidden=!sourceVersion;get('tailorProposalFields').hidden=!sourceVersion
get('attachToBrief').onclick=async()=>{const button=get<HTMLButtonElement>('attachToBrief');button.disabled=true;try{attachBrief(await sheetPNG(),briefHandoffNotes(look),`${look.name} — Sketch Room sheet`,snapshot(look));status('Sketch attached to your brief.')}catch(error){button.disabled=false;status(error instanceof Error?error.message:'Sketch could not attach.')}}
get('reviseOrder').onclick=async()=>{const note=get<HTMLTextAreaElement>('orderRevisionNote').value.trim();if(note.length<5){status('Describe what changed before sending.');return}const button=get<HTMLButtonElement>('reviseOrder');button.disabled=true;try{await reviseOrder(await sheetPNG(),snapshot(look),note);status('Updated sketch sent to the order.')}catch(error){button.disabled=false;status(error instanceof Error?error.message:'Update could not send.')}}
get('proposeStylePlan').onclick=async()=>{const note=get<HTMLTextAreaElement>('tailorProposalNote').value.trim();if(note.length<10){status('Explain your style plan before sending.');return}const button=get<HTMLButtonElement>('proposeStylePlan');button.disabled=true;try{await proposeStylePlan(await sheetPNG(),note);status('Style plan sent for customer approval.')}catch(error){button.disabled=false;status(error instanceof Error?error.message:'Style plan could not send.')}}
if(orderVersion){get('workspaceEyebrow').textContent=`REVISING ORDER DESIGN · VERSION ${orderVersion}`;get('reviewEyebrow').textContent=`ORDER DESIGN · VERSION ${orderVersion}`;get('reviewTitle').textContent='Review this update before sending.'}else if(sourceVersion){get('workspaceEyebrow').textContent=`TAILOR WORKING COPY · CUSTOMER VERSION ${sourceVersion}`;get('reviewEyebrow').textContent=`WORKING COPY · CUSTOMER VERSION ${sourceVersion}`;get('reviewTitle').textContent='Review your style plan before sharing.'}
if(startMode()==='saved')openDialog('savedDialog');if(startMode()==='reference'){openTools();get('lookShelf').setAttribute('open','')}if(storageNotice())status(storageNotice());else if(recoveredDraft())status('Your latest sketch is back.');
fillLooks();render()
