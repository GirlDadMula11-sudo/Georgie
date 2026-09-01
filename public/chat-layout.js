const drawer=document.querySelector('#workspaceDetails'),menu=document.querySelector('.menu-button'),wide=window.matchMedia('(min-width:900px)');
function sync(){if(wide.matches)drawer.open=true;else drawer.open=false}
menu?.addEventListener('click',event=>{event.preventDefault();drawer.open=!drawer.open});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!wide.matches)drawer.open=false});
document.addEventListener('pointerdown',event=>{if(!wide.matches&&drawer.open&&!drawer.contains(event.target)&&!menu?.contains(event.target))drawer.open=false});
wide.addEventListener?.('change',sync);sync();
