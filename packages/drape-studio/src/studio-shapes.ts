import type {Look} from './studio-state'
export const waistY=(l:Look)=>l.waist==='high'?267:l.waist==='low'?338:305
export const hemY=(l:Look)=>l.length==='short'?438:l.length==='midi'?554:642
export function skirtPath(l:Look,top=330,cut=l.skirtShape){const y=hemY(l),half=cut==='flare'?115:cut==='aline'?83:cut==='pencil'?40:59;return `M208 ${top}L292 ${top}Q300 ${top+45} ${250+half} ${y}Q250 ${y+21} ${250-half} ${y}Q200 ${top+45} 208 ${top}Z`}
export function mainPath(l:Look){const waist=waistY(l),ease=l.fit==='relaxed'?18:l.fit==='fitted'?-8:0;const left=214-ease,right=286+ease;
 const shoulder=`M194 177Q211 170 227 174Q250 182 273 174Q289 170 306 177`;
 if(l.outfit==='dress'){const y=hemY(l),w=l.cut==='flare'?115:l.cut==='aline'?83:l.cut==='pencil'?40:l.cut==='mermaid'?88:59;
 const tail=l.cut==='mermaid'?`Q305 ${waist+70} 282 ${y-139}L338 ${y}Q250 ${y+21} 162 ${y}L218 ${y-139}Q195 ${waist+70} ${left} ${waist}`:`L${250+w} ${y}Q250 ${y+21} ${250-w} ${y}L${left} ${waist}`;
 return shoulder+`L${right} ${waist}`+tail+'L194 177Z'}
 if(l.outfit==='jumpsuit'){const y=l.length==='short'?463:l.length==='midi'?588:680,w=l.bottom==='wide'?61:l.bottom==='bootcut'?57:l.bottom==='tapered'?45:49;return shoulder+`L${right} ${waist}Q298 358 294 405L${250+w} ${y}H258L250 430L242 ${y}H${250-w}L206 405Q202 358 ${left} ${waist}Z`}
 const h=l.top==='cropped'&&l.outfit==='separates'?285:l.top==='tunic'||l.outfit!=='separates'?(l.length==='short'?393:l.length==='midi'?450:490):l.length==='short'?315:l.length==='midi'?342:366;
 const vol=l.top==='blouse'?13:0;return shoulder+`Q${right+vol} 257 ${right+vol} ${h}Q250 ${h+20} ${left-vol} ${h}Q${left-vol} 257 194 177Z`
}
export function bottomPath(l:Look){if(l.bottom==='skirt')return skirtPath({...l,length:l.bottomLength});if(l.bottom==='shorts')return 'M208 330H292L303 447H263L250 391L237 447H197Z';const y=l.bottomLength==='short'?575:l.bottomLength==='midi'?627:680;const wide=l.bottom==='wide',boot=l.bottom==='bootcut';return `M208 330H292L${boot?281:wide?303:286} 530L${wide?310:boot?307:l.bottom==='tapered'?295:299} ${y}H${wide||boot?262:266}L250 428L${wide||boot?238:234} ${y}H${wide?190:boot?193:l.bottom==='tapered'?205:201}L${boot?219:wide?197:214} 530Z`}
export function sleevePath(style:Look['sleeve'],bent=false){if(style==='none')return '';const end=style==='cap'?214:style==='short'||style==='puff'?251:style==='elbow'?289:style==='threequarter'?322:356;
 if(bent){
 if(style==='cap'||style==='short'||style==='puff')return `M304 178Q329 181 347 222L${style==='cap'?337:355} ${style==='cap'?218:246}L${style==='cap'?315:330} ${style==='cap'?234:260}L307 222L284 194Z`;
 if(style==='elbow')return 'M304 178Q330 182 349 226L365 274L342 292L319 245L284 194Z';
 const x=style==='threequarter'?325:306,y=style==='threequarter'?307:319,w=style==='bishop'||style==='bell'?10:0;
 return `M304 178Q333 179 351 223L${372+w} 281Q${374+w} 295 ${x+10} ${y+20}L${x-8} ${y+1}L338 283L316 244L284 194Z`;
 }
 if(style==='puff')return 'M196 178Q154 174 151 210Q148 242 178 252L194 237L216 194Z';
 if(style==='bishop')return 'M196 178Q170 180 163 219Q141 288 146 336Q150 350 157 353L157 364L178 369L180 354Q202 336 194 285L216 194Z';
 const x=style==='cap'?168:style==='bell'?137:style==='short'?160:150;const inner=style==='bell'?191:style==='cap'?194:176;return `M196 178Q177 180 167 217L${x} ${end}Q${(x+inner)/2} ${end+10} ${inner} ${end+6}L199 254L216 194Z`
}
export function construction(l:Look){const y=waistY(l),main=l.outfit!=='blank';if(!main)return '';return `<g data-piece="colour">${l.collar==='pointed'?`<path d="M229 175L250 196L238 222L217 190ZM271 175L250 196L262 222L283 190Z" fill="${l.colour}" stroke="#333" stroke-opacity=".3"/>`:l.collar==='stand'?`<path d="M226 163Q250 178 274 163L277 184Q250 199 223 184Z" fill="${l.colour}" stroke="#333" stroke-opacity=".3"/>`:''}<g clip-path="url(#topTrimClip)">${l.buttons?`<path d="M250 210V${Math.min(y+42,330)}" stroke="#222" opacity=".25"/>`+[220,243,266,289].filter(v=>v<y+42).map(v=>`<circle cx="250" cy="${v}" r="2.5" fill="url(#gold)"/>`).join(''):''}${l.pockets?`<path d="M207 ${y+36}l18 4 -3 24 -18 -4ZM275 ${y+40}l18 -4 3 24 -18 4Z" fill="none" stroke="#252e29" stroke-opacity=".45" stroke-width="1.5"/>`:''}</g></g>`}
