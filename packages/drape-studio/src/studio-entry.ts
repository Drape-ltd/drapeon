import { connect } from './studio-host'
const cover = document.createElement('div')
cover.id = 'host-loading'
cover.textContent = 'Opening Sketch Room…'
cover.style.cssText =
  'position:fixed;inset:0;z-index:1000;background:#faf8f2;display:grid;place-items:center;padding:30px;'
document.body.append(cover)
connect()
  .then(() => import('./studio-sketch-app'))
  .then(() => cover.remove())
  .catch((error) => {
    cover.textContent = error instanceof Error ? error.message : 'Sketch Room could not open.'
  })
