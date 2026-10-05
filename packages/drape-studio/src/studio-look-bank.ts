import everyday from '../assets/wardrobe/look-cards/easy-everyday.jpg'
import tailoring from '../assets/wardrobe/look-cards/soft-tailoring.jpg'
import afterHours from '../assets/wardrobe/look-cards/after-hours.jpg'
import longLine from '../assets/wardrobe/look-cards/long-line.jpg'
import celebration from '../assets/wardrobe/look-cards/celebration.jpg'
import cityLayers from '../assets/wardrobe/look-cards/city-layers.jpg'
import onePiece from '../assets/wardrobe/look-cards/one-piece-ease.jpg'
import gathered from '../assets/wardrobe/look-cards/light-gathered.jpg'
import weekend from '../assets/wardrobe/look-cards/weekend-light.jpg'
import softVolume from '../assets/wardrobe/look-cards/soft-volume.jpg'
import cleanLines from '../assets/wardrobe/look-cards/clean-lines.jpg'
import teal from '../assets/wardrobe/look-cards/teal-occasion.jpg'
import adire from '../assets/wardrobe/look-cards/adire-ensemble.jpg'
import sari from '../assets/wardrobe/look-cards/sari-drape.jpg'

export type LookReference = {id:string;name:string;group:'Everyday'|'Occasion'|'Cultural clothing';detail:string;image:string}
export const LOOK_BANK:LookReference[] = [
  {id:'easy-everyday',name:'Easy everyday',group:'Everyday',detail:'Relaxed shirt · wide trousers',image:everyday},
  {id:'soft-tailoring',name:'Soft tailoring',group:'Everyday',detail:'Jacket · easy trousers',image:tailoring},
  {id:'long-line',name:'The long line',group:'Everyday',detail:'Tunic · trousers',image:longLine},
  {id:'city-layers',name:'City layers',group:'Everyday',detail:'Coat · easy layers',image:cityLayers},
  {id:'one-piece-ease',name:'One-piece ease',group:'Everyday',detail:'A flowing jumpsuit',image:onePiece},
  {id:'light-gathered',name:'Light & gathered',group:'Everyday',detail:'Blouse · A-line skirt',image:gathered},
  {id:'weekend-light',name:'Weekend light',group:'Everyday',detail:'Tee · shorts',image:weekend},
  {id:'after-hours',name:'After hours',group:'Occasion',detail:'Flared evening dress',image:afterHours},
  {id:'soft-volume',name:'Soft volume',group:'Occasion',detail:'Bell sleeves · soft skirt',image:softVolume},
  {id:'clean-lines',name:'Clean lines',group:'Occasion',detail:'Defined midi dress',image:cleanLines},
  {id:'celebration',name:'Celebration agbada',group:'Cultural clothing',detail:'Agbada · fila · beads',image:celebration},
  {id:'teal-occasion',name:'Teal occasion',group:'Cultural clothing',detail:'A-line gown · gele',image:teal},
  {id:'adire-ensemble',name:'Adire ensemble',group:'Cultural clothing',detail:'Bùbá · ìró · indigo cloth',image:adire},
  {id:'sari-drape',name:'Sari drape',group:'Cultural clothing',detail:'Silk pleats · pallu',image:sari},
]
export const lookReference=(id:string)=>LOOK_BANK.find(item=>item.id===id)
